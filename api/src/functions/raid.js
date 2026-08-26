const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/raid/{projectId}/{id?}/{action?}
//
// GET    /{projectId} -> list RAID items for the project. Optional
//           ?type=RISK|ISSUE|DEPENDENCY|ASSUMPTION|ACTION and
//           ?status=CODE filters. Each item includes a computed
//           `ageDays` (RaisedDate -> ClosedDate, or -> today if
//           still open) - derived, not stored (see D023).
// POST   /{projectId} -> create (itemTypeCode + title required;
//           description, statusCode (defaults OPEN), severityCode,
//           probabilityCode, ownerName, raisedDate, dueDate,
//           relatedTaskId, relatedMilestoneId, notes optional).
//           RaidItemCode is generated from the Numbering rule
//           matching the item type (Risk/Issue/Dependency/
//           Assumption/ActionItem all feed the same column).
// PUT    /{projectId}/{id} -> update
// DELETE /{projectId}/{id} -> archive
// POST   /{projectId}/{id}/escalate -> sets IsEscalated, stamps
//           EscalatedDate/EscalatedToName, StatusValueId -> ESCALATED
//
// /api/ppm/raid-rollup/{scope}/{id}  (scope = 'portfolio' | 'program')
// GET -> aggregate counts by type/status across every project under
//           that Portfolio or Program (Module 26-30's explicit
//           "project/program/portfolio rollups" requirement).
//           Derived report, no stored table (D023).

function getConfig() {
  const { DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT } = process.env;
  const missing = ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    const err = new Error(`MISSING_CONFIG:${missing.join(',')}`);
    err.category = 'CONFIG_MISSING';
    throw err;
  }
  return {
    server: DB_SERVER, database: DB_DATABASE, user: DB_USER, password: DB_PASSWORD,
    port: Number(DB_PORT) || 1433,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 15000, requestTimeout: 15000,
  };
}

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(getConfig()).catch((err) => { poolPromise = null; throw err; });
  }
  return poolPromise;
}

function classifyError(err) {
  if (err.category === 'CONFIG_MISSING') return { error: 'CONFIG_MISSING', detail: 'Required Application Settings are missing.' };
  if (err.category === 'VALIDATION') return { error: 'VALIDATION_FAILED', detail: err.message };
  if (err.category === 'NOT_FOUND') return { error: 'NOT_FOUND', detail: err.message };
  const code = err.code || '';
  if (code === 'ELOGIN') return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  if (code === 'ETIMEOUT' || code === 'ESOCKET') return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  if (/Invalid object name.*RaidItems/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.RaidItems does not exist yet. Run migration 012_raid.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A RAID item with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

// Maps a RaidItemType ValueCode to the EntityType string used by
// cfg.NumberingRules, since Action Items use "ActionItem" (no space)
// while the RaidItemType ValueCode is "ACTION".
const NUMBERING_ENTITY_TYPE = {
  RISK: 'Risk', ISSUE: 'Issue', DEPENDENCY: 'Dependency', ASSUMPTION: 'Assumption', ACTION: 'ActionItem',
};

async function generateCode(transaction, entityType) {
  const result = await new sql.Request(transaction)
    .input('entityType', sql.NVarChar, entityType)
    .query(`
      UPDATE cfg.NumberingRules
      SET CurrentSequence = CurrentSequence + 1
      OUTPUT INSERTED.CurrentSequence, INSERTED.Prefix, INSERTED.Suffix, INSERTED.Separator, INSERTED.SequenceLength
      WHERE EntityType = @entityType AND IsActive = 1;
    `);
  if (result.recordset.length === 0) {
    const err = new Error(`No active numbering rule for EntityType "${entityType}". Configure one under Administration -> Numbering.`);
    err.category = 'VALIDATION';
    throw err;
  }
  const rule = result.recordset[0];
  const padded = String(rule.CurrentSequence).padStart(rule.SequenceLength, '0');
  return [rule.Prefix, padded, rule.Suffix].filter(Boolean).join(rule.Separator || '-');
}

async function lookupConfigValueId(executor, categoryCode, valueCode) {
  const result = await executor
    .input('cat', sql.NVarChar, categoryCode)
    .input('val', sql.NVarChar, valueCode)
    .query(`
      SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
      JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
      WHERE cc.CategoryCode = @cat AND cv.ValueCode = @val
    `);
  if (result.recordset.length === 0) {
    const err = new Error(`"${valueCode}" is not a valid value for ${categoryCode}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].ConfigValueId;
}

async function lookupDefaultValueId(executor, categoryCode) {
  const result = await executor.input('cat', sql.NVarChar, categoryCode).query(`
    SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
    JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = @cat AND cv.IsDefault = 1
  `);
  return result.recordset.length ? result.recordset[0].ConfigValueId : null;
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

const SELECT_ITEM = `
  SELECT ri.*,
         itv.ValueCode AS ItemTypeCode, itv.ValueLabel AS ItemTypeLabel,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel,
         sev.ValueCode AS SeverityCode, sev.ValueLabel AS SeverityLabel,
         pv.ValueCode AS ProbabilityCode, pv.ValueLabel AS ProbabilityLabel,
         DATEDIFF(day, ri.RaisedDate, ISNULL(ri.ClosedDate, CAST(SYSUTCDATETIME() AS DATE))) AS AgeDays
  FROM ppm.RaidItems ri
  LEFT JOIN cfg.ConfigValues itv ON itv.ConfigValueId = ri.ItemTypeValueId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ri.StatusValueId
  LEFT JOIN cfg.ConfigValues sev ON sev.ConfigValueId = ri.SeverityValueId
  LEFT JOIN cfg.ConfigValues pv ON pv.ConfigValueId = ri.ProbabilityValueId
`;

async function handleList(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const typeFilter = request.query.get('type');
  const statusFilter = request.query.get('status');
  const req = pool.request().input('projectId', sql.Int, projectId);
  let query = `${SELECT_ITEM} WHERE ri.ProjectId = @projectId AND ri.IsActive = 1`;
  if (typeFilter) { query += ' AND itv.ValueCode = @type'; req.input('type', sql.NVarChar, typeFilter); }
  if (statusFilter) { query += ' AND sv.ValueCode = @status'; req.input('status', sql.NVarChar, statusFilter); }
  query += ' ORDER BY ri.RaisedDate DESC, ri.CreatedDate DESC;';
  const result = await req.query(query);
  return { jsonBody: { success: true, count: result.recordset.length, items: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_ITEM} WHERE ri.RaidItemId = @id AND ri.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`RAID item ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const {
    itemTypeCode, title, description, statusCode, severityCode, probabilityCode,
    ownerName, raisedDate, dueDate, relatedTaskId, relatedMilestoneId, notes,
  } = body || {};
  if (!itemTypeCode || !title) {
    const err = new Error('itemTypeCode and title are required.');
    err.category = 'VALIDATION';
    throw err;
  }
  if (!NUMBERING_ENTITY_TYPE[itemTypeCode]) {
    const err = new Error(`"${itemTypeCode}" is not a valid RAID item type.`);
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const itemTypeId = await lookupConfigValueId(new sql.Request(transaction), 'RaidItemType', itemTypeCode);
    const code = await generateCode(transaction, NUMBERING_ENTITY_TYPE[itemTypeCode]);
    const statusId = statusCode
      ? await lookupConfigValueId(new sql.Request(transaction), 'RaidStatus', statusCode)
      : await lookupDefaultValueId(new sql.Request(transaction), 'RaidStatus');
    const severityId = severityCode ? await lookupConfigValueId(new sql.Request(transaction), 'RaidSeverity', severityCode) : null;
    const probabilityId = probabilityCode ? await lookupConfigValueId(new sql.Request(transaction), 'RaidProbability', probabilityCode) : null;

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('projectId', sql.Int, projectId)
      .input('itemTypeId', sql.Int, itemTypeId)
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description ?? null)
      .input('statusId', sql.Int, statusId)
      .input('severityId', sql.Int, severityId)
      .input('probabilityId', sql.Int, probabilityId)
      .input('ownerName', sql.NVarChar, ownerName ?? null)
      .input('raisedDate', sql.Date, raisedDate ?? null)
      .input('dueDate', sql.Date, dueDate ?? null)
      .input('relatedTaskId', sql.Int, relatedTaskId ?? null)
      .input('relatedMilestoneId', sql.Int, relatedMilestoneId ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.RaidItems (
          RaidItemCode, ProjectId, ItemTypeValueId, Title, Description, StatusValueId, SeverityValueId,
          ProbabilityValueId, OwnerName, RaisedDate, DueDate, RelatedTaskId, RelatedMilestoneId, Notes
        )
        OUTPUT INSERTED.RaidItemId
        VALUES (
          @code, @projectId, @itemTypeId, @title, @description, @statusId, @severityId,
          @probabilityId, @ownerName, @raisedDate, @dueDate, @relatedTaskId, @relatedMilestoneId, @notes
        );
      `);

    await transaction.commit();
    return { status: 201, jsonBody: { success: true, item: await getOne(pool, projectId, result.recordset[0].RaidItemId) } };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();

  const statusId = body.statusCode !== undefined
    ? (body.statusCode === null ? null : await lookupConfigValueId(pool.request(), 'RaidStatus', body.statusCode))
    : row.StatusValueId;
  const severityId = body.severityCode !== undefined
    ? (body.severityCode === null ? null : await lookupConfigValueId(pool.request(), 'RaidSeverity', body.severityCode))
    : row.SeverityValueId;
  const probabilityId = body.probabilityCode !== undefined
    ? (body.probabilityCode === null ? null : await lookupConfigValueId(pool.request(), 'RaidProbability', body.probabilityCode))
    : row.ProbabilityValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('title', sql.NVarChar, body.title ?? row.Title)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('statusId', sql.Int, statusId)
    .input('severityId', sql.Int, severityId)
    .input('probabilityId', sql.Int, probabilityId)
    .input('ownerName', sql.NVarChar, body.ownerName ?? row.OwnerName)
    .input('raisedDate', sql.Date, body.raisedDate ?? row.RaisedDate)
    .input('dueDate', sql.Date, body.dueDate ?? row.DueDate)
    .input('closedDate', sql.Date, body.closedDate ?? row.ClosedDate)
    .input('relatedTaskId', sql.Int, body.relatedTaskId ?? row.RelatedTaskId)
    .input('relatedMilestoneId', sql.Int, body.relatedMilestoneId ?? row.RelatedMilestoneId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.RaidItems
      SET Title = @title, Description = @description, StatusValueId = @statusId, SeverityValueId = @severityId,
          ProbabilityValueId = @probabilityId, OwnerName = @ownerName, RaisedDate = @raisedDate, DueDate = @dueDate,
          ClosedDate = @closedDate, RelatedTaskId = @relatedTaskId, RelatedMilestoneId = @relatedMilestoneId,
          IsActive = @isActive, Notes = @notes, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE RaidItemId = @id;
    `);

  return { jsonBody: { success: true, item: await getOne(pool, projectId, id) } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.RaidItems SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE RaidItemId = @id;
  `);
  return { jsonBody: { success: true, message: `RAID item ${id} archived.` } };
}

async function handleEscalate(pool, projectId, id, request) {
  await getOne(pool, projectId, id);
  const body = await request.json().catch(() => ({}));
  const escalatedStatusId = await lookupConfigValueId(pool.request(), 'RaidStatus', 'ESCALATED');

  await pool.request()
    .input('id', sql.Int, id)
    .input('statusId', sql.Int, escalatedStatusId)
    .input('escalatedTo', sql.NVarChar, body.escalatedToName ?? null)
    .query(`
      UPDATE ppm.RaidItems
      SET IsEscalated = 1, EscalatedDate = SYSUTCDATETIME(), EscalatedToName = @escalatedTo, StatusValueId = @statusId,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE RaidItemId = @id;
    `);

  return { jsonBody: { success: true, item: await getOne(pool, projectId, id) } };
}

// ---- Rollup (Module 26-30's explicit project/program/portfolio requirement) ----

async function handleRollup(pool, scope, id) {
  const scopeColumn = scope === 'portfolio' ? 'p.PortfolioId' : 'p.ProgramId';
  const result = await pool.request().input('id', sql.Int, id).query(`
    SELECT itv.ValueCode AS ItemType, sv.ValueCode AS Status, COUNT(*) AS ItemCount
    FROM ppm.RaidItems ri
    JOIN ppm.Projects p ON p.ProjectId = ri.ProjectId
    LEFT JOIN cfg.ConfigValues itv ON itv.ConfigValueId = ri.ItemTypeValueId
    LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ri.StatusValueId
    WHERE ${scopeColumn} = @id AND ri.IsActive = 1
    GROUP BY itv.ValueCode, sv.ValueCode;
  `);

  const overdue = await pool.request().input('id', sql.Int, id).query(`
    SELECT COUNT(*) AS OverdueCount
    FROM ppm.RaidItems ri
    JOIN ppm.Projects p ON p.ProjectId = ri.ProjectId
    LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ri.StatusValueId
    WHERE ${scopeColumn} = @id AND ri.IsActive = 1 AND sv.ValueCode <> 'CLOSED'
      AND ri.DueDate IS NOT NULL AND ri.DueDate < CAST(SYSUTCDATETIME() AS DATE);
  `);

  const totalOpen = result.recordset.filter((r) => r.Status !== 'CLOSED').reduce((sum, r) => sum + r.ItemCount, 0);
  const totalEscalated = result.recordset.filter((r) => r.Status === 'ESCALATED').reduce((sum, r) => sum + r.ItemCount, 0);
  const totalClosed = result.recordset.filter((r) => r.Status === 'CLOSED').reduce((sum, r) => sum + r.ItemCount, 0);

  return {
    jsonBody: {
      success: true,
      rollup: {
        scope, id, totalOpen, totalEscalated, totalClosed,
        totalOverdue: overdue.recordset[0].OverdueCount,
        byTypeAndStatus: result.recordset,
      },
    },
  };
}

app.http('raid', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/raid/{projectId}/{id?}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;
      const action = request.params.action;

      if (request.method === 'POST' && id && action === 'escalate') return await handleEscalate(pool, projectId, id, request);
      if (request.method === 'GET' && !id) return await handleList(pool, projectId, request);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid RAID request.' } };
    } catch (err) {
      context.error('RAID API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'RAID request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

app.http('raidRollup', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'ppm/raid-rollup/{scope}/{id}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const scope = request.params.scope;
      const id = Number(request.params.id);
      if (scope !== 'portfolio' && scope !== 'program') {
        return { status: 400, jsonBody: { success: false, message: 'scope must be "portfolio" or "program".' } };
      }
      return await handleRollup(pool, scope, id);
    } catch (err) {
      context.error('RAID Rollup API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'RAID rollup request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

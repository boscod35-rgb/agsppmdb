const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/corrective-actions/{projectId}/{id?}
// GET    /{projectId} -> list CAPA items for the project
// POST   /{projectId} -> create (title required; auto-generates
//           CorrectiveActionCode via Numbering, same transactional
//           pattern as every other coded entity). Optional
//           gapAssessmentResponseId links it back to the finding
//           that spawned it; description, ownerName, statusCode
//           (defaults OPEN), dueDate, notes optional.
// PUT    /{projectId}/{id} -> update
// DELETE /{projectId}/{id} -> archive

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
  if (/Invalid object name.*CorrectiveActions/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.CorrectiveActions does not exist yet. Run migration 013_gap_assessment.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A corrective action with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

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
  SELECT ca.*, sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel
  FROM ppm.CorrectiveActions ca
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ca.StatusValueId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_ITEM} WHERE ca.ProjectId = @projectId AND ca.IsActive = 1 ORDER BY ca.DueDate, ca.CreatedDate DESC;`);
  return { jsonBody: { success: true, count: result.recordset.length, items: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_ITEM} WHERE ca.CorrectiveActionId = @id AND ca.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Corrective action ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { title, description, gapAssessmentResponseId, ownerName, statusCode, dueDate, notes } = body || {};
  if (!title) {
    const err = new Error('title is required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const code = await generateCode(transaction, 'CorrectiveAction');
    const statusId = statusCode
      ? await lookupConfigValueId(new sql.Request(transaction), 'CorrectiveActionStatus', statusCode)
      : await lookupDefaultValueId(new sql.Request(transaction), 'CorrectiveActionStatus');

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('projectId', sql.Int, projectId)
      .input('responseId', sql.Int, gapAssessmentResponseId ?? null)
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description ?? null)
      .input('ownerName', sql.NVarChar, ownerName ?? null)
      .input('statusId', sql.Int, statusId)
      .input('dueDate', sql.Date, dueDate ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.CorrectiveActions (CorrectiveActionCode, ProjectId, GapAssessmentResponseId, Title, Description, OwnerName, StatusValueId, DueDate, Notes)
        OUTPUT INSERTED.CorrectiveActionId
        VALUES (@code, @projectId, @responseId, @title, @description, @ownerName, @statusId, @dueDate, @notes);
      `);

    await transaction.commit();
    return { status: 201, jsonBody: { success: true, item: await getOne(pool, projectId, result.recordset[0].CorrectiveActionId) } };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();
  const statusId = body.statusCode !== undefined
    ? (body.statusCode === null ? null : await lookupConfigValueId(pool.request(), 'CorrectiveActionStatus', body.statusCode))
    : row.StatusValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('title', sql.NVarChar, body.title ?? row.Title)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('ownerName', sql.NVarChar, body.ownerName ?? row.OwnerName)
    .input('statusId', sql.Int, statusId)
    .input('dueDate', sql.Date, body.dueDate ?? row.DueDate)
    .input('closedDate', sql.Date, body.closedDate ?? row.ClosedDate)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.CorrectiveActions
      SET Title = @title, Description = @description, OwnerName = @ownerName, StatusValueId = @statusId,
          DueDate = @dueDate, ClosedDate = @closedDate, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE CorrectiveActionId = @id;
    `);

  return { jsonBody: { success: true, item: await getOne(pool, projectId, id) } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.CorrectiveActions SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE CorrectiveActionId = @id;
  `);
  return { jsonBody: { success: true, message: `Corrective action ${id} archived.` } };
}

app.http('correctiveActions', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/corrective-actions/{projectId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && !id) return await handleList(pool, projectId);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid corrective action request.' } };
    } catch (err) {
      context.error('Corrective Actions API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Corrective action request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

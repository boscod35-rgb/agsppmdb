const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/deliverables/{projectId}/{id?}
// GET    /{projectId} -> list deliverables for the project
// POST   /{projectId} -> create (deliverableName required; ownerName,
//           plannedDate, milestoneId, acceptanceStatusCode, notes optional)
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
  if (/Invalid object name.*Deliverables/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Deliverables does not exist yet. Run migration 009_wbs_schedule_delivery.sql.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
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

async function lookupMilestoneId(executor, milestoneId, projectId) {
  const result = await executor.input('id', sql.Int, milestoneId).input('projectId', sql.Int, projectId)
    .query('SELECT MilestoneId FROM ppm.Milestones WHERE MilestoneId = @id AND ProjectId = @projectId');
  if (result.recordset.length === 0) {
    const err = new Error(`Milestone ${milestoneId} not found on this project.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].MilestoneId;
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

const SELECT_DELIVERABLE = `
  SELECT d.*, av.ValueCode AS AcceptanceStatusCode, av.ValueLabel AS AcceptanceStatusLabel, m.MilestoneName
  FROM ppm.Deliverables d
  LEFT JOIN cfg.ConfigValues av ON av.ConfigValueId = d.AcceptanceStatusValueId
  LEFT JOIN ppm.Milestones m ON m.MilestoneId = d.MilestoneId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_DELIVERABLE} WHERE d.ProjectId = @projectId AND d.IsActive = 1 ORDER BY d.PlannedDate, d.DeliverableName;`);
  return { jsonBody: { success: true, count: result.recordset.length, deliverables: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_DELIVERABLE} WHERE d.DeliverableId = @id AND d.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Deliverable ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { deliverableName, ownerName, plannedDate, milestoneId, acceptanceStatusCode, notes } = body || {};
  if (!deliverableName) {
    const err = new Error('deliverableName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const resolvedMilestoneId = milestoneId ? await lookupMilestoneId(pool.request(), milestoneId, projectId) : null;
  const statusId = acceptanceStatusCode
    ? await lookupConfigValueId(pool.request(), 'DeliverableAcceptanceStatus', acceptanceStatusCode)
    : await lookupDefaultValueId(pool.request(), 'DeliverableAcceptanceStatus');

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('name', sql.NVarChar, deliverableName)
    .input('owner', sql.NVarChar, ownerName ?? null)
    .input('plannedDate', sql.Date, plannedDate ?? null)
    .input('milestoneId', sql.Int, resolvedMilestoneId)
    .input('statusId', sql.Int, statusId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.Deliverables (ProjectId, DeliverableName, OwnerName, PlannedDate, MilestoneId, AcceptanceStatusValueId, Notes)
      OUTPUT INSERTED.DeliverableId
      VALUES (@projectId, @name, @owner, @plannedDate, @milestoneId, @statusId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, deliverableId: result.recordset[0].DeliverableId } };
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();
  const milestoneId = body.milestoneId !== undefined
    ? (body.milestoneId === null ? null : await lookupMilestoneId(pool.request(), body.milestoneId, projectId))
    : row.MilestoneId;
  const statusId = body.acceptanceStatusCode !== undefined
    ? (body.acceptanceStatusCode === null ? null : await lookupConfigValueId(pool.request(), 'DeliverableAcceptanceStatus', body.acceptanceStatusCode))
    : row.AcceptanceStatusValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.deliverableName ?? row.DeliverableName)
    .input('owner', sql.NVarChar, body.ownerName ?? row.OwnerName)
    .input('plannedDate', sql.Date, body.plannedDate ?? row.PlannedDate)
    .input('actualDate', sql.Date, body.actualDate ?? row.ActualDate)
    .input('milestoneId', sql.Int, milestoneId)
    .input('statusId', sql.Int, statusId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Deliverables
      SET DeliverableName = @name, OwnerName = @owner, PlannedDate = @plannedDate, ActualDate = @actualDate,
          MilestoneId = @milestoneId, AcceptanceStatusValueId = @statusId, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE DeliverableId = @id;
    `);
  return { jsonBody: { success: true, message: `Deliverable ${id} updated.` } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Deliverables SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE DeliverableId = @id;
  `);
  return { jsonBody: { success: true, message: `Deliverable ${id} archived.` } };
}

app.http('deliverables', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/deliverables/{projectId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && !id) return await handleList(pool, projectId);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid deliverable request.' } };
    } catch (err) {
      context.error('Deliverables API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Deliverable request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

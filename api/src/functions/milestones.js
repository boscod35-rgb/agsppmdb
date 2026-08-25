const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/milestones/{projectId}/{id?}/{action?}
//
// GET    /{projectId} -> list milestones for the project
// POST   /{projectId} -> create (milestoneName required; plannedDate,
//           isPhaseGate, lifecyclePhaseCode, statusCode, notes optional)
// PUT    /{projectId}/{id} -> update
// DELETE /{projectId}/{id} -> archive
// POST   /{projectId}/{id}/approve -> for phase-gate milestones: sets
//           ApprovedByName/ApprovedDate and StatusValueId to ACHIEVED
//           (same free-text-approver pattern as Charter approval)

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
  if (/Invalid object name.*Milestones/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Milestones does not exist yet. Run migration 009_wbs_schedule_delivery.sql.' };
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

async function lookupPhaseId(executor, phaseId) {
  // LifecyclePhases aren't code-addressed like most cfg tables (no
  // PhaseCode column - see migration 006), so the client passes the
  // numeric PhaseId directly rather than a code.
  const result = await executor.input('id', sql.Int, phaseId).query('SELECT PhaseId FROM cfg.LifecyclePhases WHERE PhaseId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Lifecycle Phase ${phaseId} does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].PhaseId;
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

const SELECT_MILESTONE = `
  SELECT m.*, sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel, lp.PhaseName
  FROM ppm.Milestones m
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = m.StatusValueId
  LEFT JOIN cfg.LifecyclePhases lp ON lp.PhaseId = m.LifecyclePhaseId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_MILESTONE} WHERE m.ProjectId = @projectId AND m.IsActive = 1 ORDER BY m.PlannedDate, m.MilestoneName;`);
  return { jsonBody: { success: true, count: result.recordset.length, milestones: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_MILESTONE} WHERE m.MilestoneId = @id AND m.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Milestone ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { milestoneName, plannedDate, isPhaseGate, lifecyclePhaseId, statusCode, notes } = body || {};
  if (!milestoneName) {
    const err = new Error('milestoneName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const phaseId = lifecyclePhaseId ? await lookupPhaseId(pool.request(), lifecyclePhaseId) : null;
  const statusId = statusCode
    ? await lookupConfigValueId(pool.request(), 'MilestoneStatus', statusCode)
    : await lookupDefaultValueId(pool.request(), 'MilestoneStatus');

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('name', sql.NVarChar, milestoneName)
    .input('plannedDate', sql.Date, plannedDate ?? null)
    .input('isPhaseGate', sql.Bit, isPhaseGate ?? false)
    .input('phaseId', sql.Int, phaseId)
    .input('statusId', sql.Int, statusId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.Milestones (ProjectId, MilestoneName, PlannedDate, IsPhaseGate, LifecyclePhaseId, StatusValueId, Notes)
      OUTPUT INSERTED.MilestoneId
      VALUES (@projectId, @name, @plannedDate, @isPhaseGate, @phaseId, @statusId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, milestoneId: result.recordset[0].MilestoneId } };
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();
  const phaseId = body.lifecyclePhaseId !== undefined
    ? (body.lifecyclePhaseId === null ? null : await lookupPhaseId(pool.request(), body.lifecyclePhaseId))
    : row.LifecyclePhaseId;
  const statusId = body.statusCode !== undefined
    ? (body.statusCode === null ? null : await lookupConfigValueId(pool.request(), 'MilestoneStatus', body.statusCode))
    : row.StatusValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.milestoneName ?? row.MilestoneName)
    .input('plannedDate', sql.Date, body.plannedDate ?? row.PlannedDate)
    .input('actualDate', sql.Date, body.actualDate ?? row.ActualDate)
    .input('isPhaseGate', sql.Bit, body.isPhaseGate ?? row.IsPhaseGate)
    .input('phaseId', sql.Int, phaseId)
    .input('statusId', sql.Int, statusId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Milestones
      SET MilestoneName = @name, PlannedDate = @plannedDate, ActualDate = @actualDate, IsPhaseGate = @isPhaseGate,
          LifecyclePhaseId = @phaseId, StatusValueId = @statusId, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE MilestoneId = @id;
    `);
  return { jsonBody: { success: true, message: `Milestone ${id} updated.` } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Milestones SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE MilestoneId = @id;
  `);
  return { jsonBody: { success: true, message: `Milestone ${id} archived.` } };
}

async function handleApprove(pool, projectId, id, request) {
  await getOne(pool, projectId, id);
  const body = await request.json().catch(() => ({}));
  const achievedStatusId = await lookupConfigValueId(pool.request(), 'MilestoneStatus', 'ACHIEVED');

  await pool.request()
    .input('id', sql.Int, id)
    .input('statusId', sql.Int, achievedStatusId)
    .input('approvedBy', sql.NVarChar, body.approvedByName ?? null)
    .query(`
      UPDATE ppm.Milestones
      SET StatusValueId = @statusId, ApprovedByName = @approvedBy, ApprovedDate = SYSUTCDATETIME(),
          ActualDate = ISNULL(ActualDate, CAST(SYSUTCDATETIME() AS DATE)),
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE MilestoneId = @id;
    `);
  return { jsonBody: { success: true, message: `Milestone ${id} approved.` } };
}

app.http('milestones', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/milestones/{projectId}/{id?}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;
      const action = request.params.action;

      if (request.method === 'POST' && id && action === 'approve') return await handleApprove(pool, projectId, id, request);
      if (request.method === 'GET' && !id) return await handleList(pool, projectId);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid milestone request.' } };
    } catch (err) {
      context.error('Milestones API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Milestone request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

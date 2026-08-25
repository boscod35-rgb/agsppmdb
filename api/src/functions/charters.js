const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/charters/{projectId?}/{action?}
//
// Charters are addressed by ProjectId (1:1 relationship), not their
// own CharterId - the URL always reads "the charter for this project."
//
// GET    /{projectId} -> the project's charter (404 if none created yet)
// POST   /{projectId} -> create the charter for this project (fails
//           if one already exists - UNIQUE constraint on ProjectId)
// PUT    /{projectId} -> update the charter
// POST   /{projectId}/approve -> sets ApprovalStatusValueId to
//           Approved, stamps ApprovedByName/ApprovedDate

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
  if (err.category === 'ALREADY_EXISTS') return { error: 'ALREADY_EXISTS', detail: err.message };
  const code = err.code || '';
  if (code === 'ELOGIN') return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  if (code === 'ETIMEOUT' || code === 'ESOCKET') return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  if (/Invalid object name.*ProjectCharters/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ProjectCharters does not exist yet. Run migration 008_intake_charter_templates.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'ALREADY_EXISTS', detail: 'This project already has a charter. Use PUT to update it.' };
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

async function lookupDefaultStatusId(executor, categoryCode) {
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

const SELECT_CHARTER = `
  SELECT ch.*, sv.ValueCode AS ApprovalStatusCode, sv.ValueLabel AS ApprovalStatusLabel
  FROM ppm.ProjectCharters ch
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ch.ApprovalStatusValueId
`;

async function handleGetOne(pool, projectId) {
  const result = await pool.request().input('projectId', sql.Int, projectId).query(`${SELECT_CHARTER} WHERE ch.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`No charter exists yet for project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, charter: result.recordset[0] } };
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);

  const existing = await pool.request().input('projectId', sql.Int, projectId).query('SELECT CharterId FROM ppm.ProjectCharters WHERE ProjectId = @projectId');
  if (existing.recordset.length > 0) {
    const err = new Error(`Project ${projectId} already has a charter. Use PUT to update it.`);
    err.category = 'ALREADY_EXISTS';
    throw err;
  }

  const body = await request.json();
  const { objectives, scope, assumptions, constraints, businessCase, notes } = body || {};
  const defaultStatusId = await lookupDefaultStatusId(pool.request(), 'CharterApprovalStatus');

  await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('objectives', sql.NVarChar, objectives ?? null)
    .input('scope', sql.NVarChar, scope ?? null)
    .input('assumptions', sql.NVarChar, assumptions ?? null)
    .input('constraints', sql.NVarChar, constraints ?? null)
    .input('businessCase', sql.NVarChar, businessCase ?? null)
    .input('statusId', sql.Int, defaultStatusId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ProjectCharters (ProjectId, Objectives, [Scope], Assumptions, Constraints, BusinessCase, ApprovalStatusValueId, Notes)
      VALUES (@projectId, @objectives, @scope, @assumptions, @constraints, @businessCase, @statusId, @notes);
    `);

  return await handleGetOne(pool, projectId);
}

async function handleUpdate(pool, projectId, request) {
  const existing = await pool.request().input('projectId', sql.Int, projectId).query('SELECT * FROM ppm.ProjectCharters WHERE ProjectId = @projectId');
  if (existing.recordset.length === 0) {
    const err = new Error(`No charter exists yet for project ${projectId}. Use POST to create one.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();

  const statusId = body.approvalStatusCode !== undefined
    ? (body.approvalStatusCode === null ? null : await lookupConfigValueId(pool.request(), 'CharterApprovalStatus', body.approvalStatusCode))
    : row.ApprovalStatusValueId;

  await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('objectives', sql.NVarChar, body.objectives ?? row.Objectives)
    .input('scope', sql.NVarChar, body.scope ?? row.Scope)
    .input('assumptions', sql.NVarChar, body.assumptions ?? row.Assumptions)
    .input('constraints', sql.NVarChar, body.constraints ?? row.Constraints)
    .input('businessCase', sql.NVarChar, body.businessCase ?? row.BusinessCase)
    .input('statusId', sql.Int, statusId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ProjectCharters
      SET Objectives = @objectives, [Scope] = @scope, Assumptions = @assumptions, Constraints = @constraints,
          BusinessCase = @businessCase, ApprovalStatusValueId = @statusId, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ProjectId = @projectId;
    `);

  return await handleGetOne(pool, projectId);
}

async function handleApprove(pool, projectId, request) {
  const existing = await pool.request().input('projectId', sql.Int, projectId).query('SELECT CharterId FROM ppm.ProjectCharters WHERE ProjectId = @projectId');
  if (existing.recordset.length === 0) {
    const err = new Error(`No charter exists yet for project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const body = await request.json().catch(() => ({}));
  const approvedStatusId = await lookupConfigValueId(pool.request(), 'CharterApprovalStatus', 'APPROVED');

  await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('statusId', sql.Int, approvedStatusId)
    .input('approvedBy', sql.NVarChar, body.approvedByName ?? null)
    .query(`
      UPDATE ppm.ProjectCharters
      SET ApprovalStatusValueId = @statusId, ApprovedByName = @approvedBy, ApprovedDate = SYSUTCDATETIME(),
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ProjectId = @projectId;
    `);

  return await handleGetOne(pool, projectId);
}

app.http('charters', {
  methods: ['GET', 'POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'ppm/charters/{projectId}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const action = request.params.action;

      if (request.method === 'POST' && action === 'approve') return await handleApprove(pool, projectId, request);
      if (request.method === 'GET') return await handleGetOne(pool, projectId);
      if (request.method === 'POST') return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT') return await handleUpdate(pool, projectId, request);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Charters API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'ALREADY_EXISTS' || safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Charter request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

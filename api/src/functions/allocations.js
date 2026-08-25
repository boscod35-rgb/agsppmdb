const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/allocations/{projectId}/{id?}
//
// Project-scoped: every allocation belongs to exactly one project,
// mirroring the milestones.js / deliverables.js pattern.
//
// GET    /{projectId} -> list allocations for the project, joined
//           with Resource name/code/type/role
// POST   /{projectId} -> create (resourceCode + plannedAllocationPercent
//           required; actualAllocationPercent, startDate, endDate,
//           statusCode, notes optional)
// PUT    /{projectId}/{id} -> update (this is how Planned vs Actual
//           gets reconciled over time - Module 18, Baseline vs Actual)
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
  if (/Invalid object name.*ResourceAllocations/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ResourceAllocations does not exist yet. Run migration 010_resource_rmg.sql.' };
  }
  if (/CK_ResourceAllocations/i.test(err.message || '')) {
    return { error: 'VALIDATION_FAILED', detail: 'Allocation percentages must be between 0 and 100.' };
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

async function lookupResourceId(executor, resourceCode) {
  const result = await executor.input('code', sql.NVarChar, resourceCode)
    .query('SELECT ResourceId FROM ppm.Resources WHERE ResourceCode = @code');
  if (result.recordset.length === 0) {
    const err = new Error(`Resource "${resourceCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].ResourceId;
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

const SELECT_ALLOCATION = `
  SELECT a.*, r.ResourceCode, r.ResourceName,
         rt.ValueCode AS ResourceTypeCode, rt.ValueLabel AS ResourceTypeLabel,
         rr.ValueCode AS ResourceRoleCode, rr.ValueLabel AS ResourceRoleLabel,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel
  FROM ppm.ResourceAllocations a
  JOIN ppm.Resources r ON r.ResourceId = a.ResourceId
  LEFT JOIN cfg.ConfigValues rt ON rt.ConfigValueId = r.ResourceTypeValueId
  LEFT JOIN cfg.ConfigValues rr ON rr.ConfigValueId = r.ResourceRoleValueId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = a.StatusValueId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_ALLOCATION} WHERE a.ProjectId = @projectId AND a.IsActive = 1 ORDER BY r.ResourceName;`);
  return { jsonBody: { success: true, count: result.recordset.length, allocations: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_ALLOCATION} WHERE a.AllocationId = @id AND a.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Allocation ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { resourceCode, plannedAllocationPercent, actualAllocationPercent, startDate, endDate, statusCode, notes } = body || {};
  if (!resourceCode || plannedAllocationPercent === undefined || plannedAllocationPercent === null) {
    const err = new Error('resourceCode and plannedAllocationPercent are required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const resourceId = await lookupResourceId(pool.request(), resourceCode);
  const statusId = statusCode
    ? await lookupConfigValueId(pool.request(), 'AllocationStatus', statusCode)
    : await lookupDefaultValueId(pool.request(), 'AllocationStatus');

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('resourceId', sql.Int, resourceId)
    .input('planned', sql.Decimal(5, 2), plannedAllocationPercent)
    .input('actual', sql.Decimal(5, 2), actualAllocationPercent ?? null)
    .input('startDate', sql.Date, startDate ?? null)
    .input('endDate', sql.Date, endDate ?? null)
    .input('statusId', sql.Int, statusId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ResourceAllocations (ProjectId, ResourceId, PlannedAllocationPercent, ActualAllocationPercent, StartDate, EndDate, StatusValueId, Notes)
      OUTPUT INSERTED.AllocationId
      VALUES (@projectId, @resourceId, @planned, @actual, @startDate, @endDate, @statusId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, allocationId: result.recordset[0].AllocationId } };
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();
  const resourceId = body.resourceCode !== undefined ? await lookupResourceId(pool.request(), body.resourceCode) : row.ResourceId;
  const statusId = body.statusCode !== undefined
    ? (body.statusCode === null ? null : await lookupConfigValueId(pool.request(), 'AllocationStatus', body.statusCode))
    : row.StatusValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('resourceId', sql.Int, resourceId)
    .input('planned', sql.Decimal(5, 2), body.plannedAllocationPercent ?? row.PlannedAllocationPercent)
    .input('actual', sql.Decimal(5, 2), body.actualAllocationPercent ?? row.ActualAllocationPercent)
    .input('startDate', sql.Date, body.startDate ?? row.StartDate)
    .input('endDate', sql.Date, body.endDate ?? row.EndDate)
    .input('statusId', sql.Int, statusId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ResourceAllocations
      SET ResourceId = @resourceId, PlannedAllocationPercent = @planned, ActualAllocationPercent = @actual,
          StartDate = @startDate, EndDate = @endDate, StatusValueId = @statusId, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE AllocationId = @id;
    `);
  return { jsonBody: { success: true, message: `Allocation ${id} updated.` } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.ResourceAllocations SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE AllocationId = @id;
  `);
  return { jsonBody: { success: true, message: `Allocation ${id} archived.` } };
}

app.http('allocations', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/allocations/{projectId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && !id) return await handleList(pool, projectId);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid allocation request.' } };
    } catch (err) {
      context.error('Allocations API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Allocation request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/config/values
// GET    ?category=ProjectType   -> list (unchanged from v0.5.0)
// POST                            -> create a new value
// PUT    /{id}                    -> update a value
// DELETE /{id}                    -> soft-delete (sets IsActive = 0;
//                                    never a hard DELETE, so history
//                                    is always recoverable)
//
// No secrets in any response. No auth yet, so CreatedBy/UpdatedBy
// reflect the SQL login (SUSER_SNAME()), not an individual user -
// consistent with the rest of this codebase until auth exists.

function getConfig() {
  const { DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT } = process.env;

  const missing = ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) {
    const err = new Error(`MISSING_CONFIG:${missing.join(',')}`);
    err.category = 'CONFIG_MISSING';
    throw err;
  }

  return {
    server: DB_SERVER,
    database: DB_DATABASE,
    user: DB_USER,
    password: DB_PASSWORD,
    port: Number(DB_PORT) || 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    connectionTimeout: 15000,
    requestTimeout: 15000,
  };
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(getConfig()).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

function classifyError(err) {
  if (err.category === 'CONFIG_MISSING') {
    return { error: 'CONFIG_MISSING', detail: 'Required Application Settings are missing on the Function App.' };
  }
  if (err.category === 'VALIDATION') {
    return { error: 'VALIDATION_FAILED', detail: err.message };
  }
  if (err.category === 'NOT_FOUND') {
    return { error: 'NOT_FOUND', detail: err.message };
  }
  const code = err.code || '';
  if (code === 'ELOGIN') {
    return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  }
  if (code === 'ETIMEOUT' || code === 'ESOCKET') {
    return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  }
  if (/Invalid object name.*ConfigValues/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cfg.ConfigValues does not exist yet. Run migration 003_config_engine.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_VALUE_CODE', detail: 'A value with this code already exists in this category.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function getCategoryId(pool, categoryCode) {
  const result = await pool.request()
    .input('categoryCode', sql.NVarChar, categoryCode)
    .query('SELECT CategoryId FROM cfg.ConfigCategories WHERE CategoryCode = @categoryCode');
  if (result.recordset.length === 0) {
    const err = new Error(`Category "${categoryCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].CategoryId;
}

async function clearDefaultInCategory(pool, categoryId, excludeValueId) {
  const req = pool.request().input('categoryId', sql.Int, categoryId);
  let query = 'UPDATE cfg.ConfigValues SET IsDefault = 0 WHERE CategoryId = @categoryId';
  if (excludeValueId) {
    req.input('excludeId', sql.Int, excludeValueId);
    query += ' AND ConfigValueId != @excludeId';
  }
  await req.query(query);
}

// ---- GET (list) — unchanged behavior from v0.5.0 ----
async function handleGet(request, pool) {
  const category = request.query.get('category');
  const sqlRequest = pool.request();

  let query = `
    SELECT
      cv.ConfigValueId, cv.CategoryId, cc.CategoryCode, cc.CategoryName,
      cv.ValueCode, cv.ValueLabel, cv.SortOrder, cv.IsActive, cv.IsDefault, cv.Notes,
      cv.CreatedDate, cv.CreatedBy, cv.UpdatedDate, cv.UpdatedBy
    FROM cfg.ConfigValues cv
    JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
  `;
  if (category) {
    query += ' WHERE cc.CategoryCode = @category';
    sqlRequest.input('category', sql.NVarChar, category);
  }
  query += ' ORDER BY cc.SortOrder, cv.SortOrder;';

  const result = await sqlRequest.query(query);
  return { jsonBody: { success: true, count: result.recordset.length, values: result.recordset } };
}

// ---- POST (create) ----
async function handleCreate(request, pool) {
  const body = await request.json();
  const { categoryCode, valueCode, valueLabel, sortOrder, isDefault, notes } = body || {};

  if (!categoryCode || !valueCode || !valueLabel) {
    const err = new Error('categoryCode, valueCode, and valueLabel are required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const categoryId = await getCategoryId(pool, categoryCode);

  if (isDefault) {
    await clearDefaultInCategory(pool, categoryId, null);
  }

  const result = await pool.request()
    .input('categoryId', sql.Int, categoryId)
    .input('valueCode', sql.NVarChar, valueCode)
    .input('valueLabel', sql.NVarChar, valueLabel)
    .input('sortOrder', sql.Int, sortOrder ?? 0)
    .input('isDefault', sql.Bit, isDefault ? 1 : 0)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes)
      OUTPUT INSERTED.*
      VALUES (@categoryId, @valueCode, @valueLabel, @sortOrder, @isDefault, @notes);
    `);

  return { status: 201, jsonBody: { success: true, value: result.recordset[0] } };
}

// ---- PUT (update) ----
async function handleUpdate(request, pool, id) {
  const body = await request.json();
  const { valueLabel, sortOrder, isActive, isDefault, notes } = body || {};

  const existing = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM cfg.ConfigValues WHERE ConfigValueId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Config value ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const categoryId = existing.recordset[0].CategoryId;

  if (isDefault) {
    await clearDefaultInCategory(pool, categoryId, id);
  }

  const result = await pool.request()
    .input('id', sql.Int, id)
    .input('valueLabel', sql.NVarChar, valueLabel ?? existing.recordset[0].ValueLabel)
    .input('sortOrder', sql.Int, sortOrder ?? existing.recordset[0].SortOrder)
    .input('isActive', sql.Bit, isActive ?? existing.recordset[0].IsActive)
    .input('isDefault', sql.Bit, isDefault ?? existing.recordset[0].IsDefault)
    .input('notes', sql.NVarChar, notes ?? existing.recordset[0].Notes)
    .query(`
      UPDATE cfg.ConfigValues
      SET ValueLabel = @valueLabel, SortOrder = @sortOrder, IsActive = @isActive,
          IsDefault = @isDefault, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      OUTPUT INSERTED.*
      WHERE ConfigValueId = @id;
    `);

  return { jsonBody: { success: true, value: result.recordset[0] } };
}

// ---- DELETE (soft-delete / deactivate) ----
async function handleDeactivate(request, pool, id) {
  const existing = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT ConfigValueId FROM cfg.ConfigValues WHERE ConfigValueId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Config value ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }

  await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE cfg.ConfigValues
      SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ConfigValueId = @id;
    `);

  return { jsonBody: { success: true, message: `Config value ${id} deactivated.` } };
}

app.http('configValues', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'config/values/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET') return await handleGet(request, pool);
      if (request.method === 'POST') return await handleCreate(request, pool);
      if (request.method === 'PUT' && id) return await handleUpdate(request, pool, id);
      if (request.method === 'DELETE' && id) return await handleDeactivate(request, pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Config values error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: {
          success: false,
          message: 'Config values request failed',
          error: safe.error,
          detail: safe.detail,
        },
      };
    }
  },
});

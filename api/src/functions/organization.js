const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/org/{resource}/{id?}
// resource is one of: business-units, departments, locations
//
// GET    -> list (departments supports ?businessUnit=CODE filter)
// POST   -> create
// PUT    /{id} -> update
// DELETE /{id} -> soft-delete (IsActive = 0, never a hard delete)
//
// Same conventions as configValues.js: no secrets in responses, no
// auth yet so CreatedBy/UpdatedBy reflect the SQL login.

const RESOURCES = {
  'business-units': {
    table: 'org.BusinessUnits',
    idCol: 'BusinessUnitId',
    codeCol: 'BusinessUnitCode',
    requiredOnCreate: ['code', 'name'],
  },
  departments: {
    table: 'org.Departments',
    idCol: 'DepartmentId',
    codeCol: 'DepartmentCode',
    requiredOnCreate: ['code', 'name', 'businessUnitCode'],
  },
  locations: {
    table: 'org.Locations',
    idCol: 'LocationId',
    codeCol: 'LocationCode',
    requiredOnCreate: ['code', 'name'],
  },
};

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
    options: { encrypt: true, trustServerCertificate: false },
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
  if (err.category === 'VALIDATION') return { error: 'VALIDATION_FAILED', detail: err.message };
  if (err.category === 'NOT_FOUND') return { error: 'NOT_FOUND', detail: err.message };
  const code = err.code || '';
  if (code === 'ELOGIN') return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  if (code === 'ETIMEOUT' || code === 'ESOCKET') return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  if (/Invalid object name.*org\./i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'org tables do not exist yet. Run migration 005_organization.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A record with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function handleList(pool, resource, request) {
  if (resource === 'departments') {
    const buFilter = request.query.get('businessUnit');
    const req = pool.request();
    let query = `
      SELECT d.*, bu.BusinessUnitCode, bu.BusinessUnitName
      FROM org.Departments d
      JOIN org.BusinessUnits bu ON bu.BusinessUnitId = d.BusinessUnitId
    `;
    if (buFilter) {
      query += ' WHERE bu.BusinessUnitCode = @bu';
      req.input('bu', sql.NVarChar, buFilter);
    }
    query += ' ORDER BY d.DepartmentName;';
    const result = await req.query(query);
    return { jsonBody: { success: true, count: result.recordset.length, departments: result.recordset } };
  }

  const cfg = RESOURCES[resource];
  const result = await pool.request().query(`SELECT * FROM ${cfg.table} ORDER BY ${cfg.codeCol};`);
  const key = resource === 'business-units' ? 'businessUnits' : 'locations';
  return { jsonBody: { success: true, count: result.recordset.length, [key]: result.recordset } };
}

async function handleCreate(pool, resource, request) {
  const body = await request.json();
  const cfg = RESOURCES[resource];

  if (resource === 'departments') {
    const { code, name, businessUnitCode, notes } = body || {};
    if (!code || !name || !businessUnitCode) {
      const err = new Error('code, name, and businessUnitCode are required.');
      err.category = 'VALIDATION';
      throw err;
    }
    const bu = await pool.request()
      .input('code', sql.NVarChar, businessUnitCode)
      .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code');
    if (bu.recordset.length === 0) {
      const err = new Error(`Business Unit "${businessUnitCode}" does not exist.`);
      err.category = 'NOT_FOUND';
      throw err;
    }
    const result = await pool.request()
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('buId', sql.Int, bu.recordset[0].BusinessUnitId)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO org.Departments (DepartmentCode, DepartmentName, BusinessUnitId, Notes)
        OUTPUT INSERTED.*
        VALUES (@code, @name, @buId, @notes);
      `);
    return { status: 201, jsonBody: { success: true, department: result.recordset[0] } };
  }

  const { code, name, notes, country, timeZone } = body || {};
  if (!code || !name) {
    const err = new Error('code and name are required.');
    err.category = 'VALIDATION';
    throw err;
  }

  if (resource === 'business-units') {
    const result = await pool.request()
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO org.BusinessUnits (BusinessUnitCode, BusinessUnitName, Notes)
        OUTPUT INSERTED.*
        VALUES (@code, @name, @notes);
      `);
    return { status: 201, jsonBody: { success: true, businessUnit: result.recordset[0] } };
  }

  // locations
  const result = await pool.request()
    .input('code', sql.NVarChar, code)
    .input('name', sql.NVarChar, name)
    .input('country', sql.NVarChar, country ?? null)
    .input('timeZone', sql.NVarChar, timeZone ?? null)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO org.Locations (LocationCode, LocationName, Country, TimeZone, Notes)
      OUTPUT INSERTED.*
      VALUES (@code, @name, @country, @timeZone, @notes);
    `);
  return { status: 201, jsonBody: { success: true, location: result.recordset[0] } };
}

async function handleUpdate(pool, resource, id, request) {
  const cfg = RESOURCES[resource];
  const body = await request.json();

  const existing = await pool.request().input('id', sql.Int, id)
    .query(`SELECT * FROM ${cfg.table} WHERE ${cfg.idCol} = @id`);
  if (existing.recordset.length === 0) {
    const err = new Error(`${resource} ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  const nameCol = resource === 'business-units' ? 'BusinessUnitName' : resource === 'departments' ? 'DepartmentName' : 'LocationName';
  const name = body.name ?? row[nameCol];
  const isActive = body.isActive ?? row.IsActive;
  const notes = body.notes ?? row.Notes;

  let extraSet = '';
  const req = pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, name)
    .input('isActive', sql.Bit, isActive)
    .input('notes', sql.NVarChar, notes);

  if (resource === 'locations') {
    extraSet = ', Country = @country, TimeZone = @timeZone';
    req.input('country', sql.NVarChar, body.country ?? row.Country);
    req.input('timeZone', sql.NVarChar, body.timeZone ?? row.TimeZone);
  }

  const result = await req.query(`
    UPDATE ${cfg.table}
    SET ${nameCol} = @name, IsActive = @isActive, Notes = @notes${extraSet},
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    OUTPUT INSERTED.*
    WHERE ${cfg.idCol} = @id;
  `);
  return { jsonBody: { success: true, [resource === 'business-units' ? 'businessUnit' : resource === 'departments' ? 'department' : 'location']: result.recordset[0] } };
}

async function handleDeactivate(pool, resource, id) {
  const cfg = RESOURCES[resource];
  const existing = await pool.request().input('id', sql.Int, id)
    .query(`SELECT ${cfg.idCol} FROM ${cfg.table} WHERE ${cfg.idCol} = @id`);
  if (existing.recordset.length === 0) {
    const err = new Error(`${resource} ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ${cfg.table}
    SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ${cfg.idCol} = @id;
  `);
  return { jsonBody: { success: true, message: `${resource} ${id} deactivated.` } };
}

app.http('organization', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'org/{resource}/{id?}',
  handler: async (request, context) => {
    try {
      const resource = request.params.resource;
      if (!RESOURCES[resource]) {
        return { status: 404, jsonBody: { success: false, message: `Unknown resource "${resource}".` } };
      }

      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET') return await handleList(pool, resource, request);
      if (request.method === 'POST') return await handleCreate(pool, resource, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, resource, id, request);
      if (request.method === 'DELETE' && id) return await handleDeactivate(pool, resource, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Organization API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Organization request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

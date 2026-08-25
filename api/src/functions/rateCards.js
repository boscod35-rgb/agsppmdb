const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/rate-cards/{id?}
// GET    -> list rate cards, joined with Role/Type/Location labels
// GET /{id} -> single rate card
// POST   -> create (rateCardCode + rateCardName + costRatePerHour
//           required; resourceRoleCode, resourceTypeCode,
//           locationCode, billRatePerHour, effectiveStartDate,
//           effectiveEndDate, notes optional)
// PUT    /{id} -> update
// DELETE /{id} -> archive

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
  if (/Invalid object name.*RateCards/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.RateCards does not exist yet. Run migration 011_finance_rate_billing.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A rate card with this code already exists.' };
  }
  if (/CK_RateCards/i.test(err.message || '')) {
    return { error: 'VALIDATION_FAILED', detail: 'Rates must be zero or positive.' };
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

async function lookupLocationId(executor, locationCode) {
  const result = await executor.input('code', sql.NVarChar, locationCode)
    .query('SELECT LocationId FROM org.Locations WHERE LocationCode = @code');
  if (result.recordset.length === 0) {
    const err = new Error(`Location "${locationCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].LocationId;
}

const SELECT_LIST = `
  SELECT rc.*, rv.ValueCode AS ResourceRoleCode, rv.ValueLabel AS ResourceRoleLabel,
         tv.ValueCode AS ResourceTypeCode, tv.ValueLabel AS ResourceTypeLabel,
         loc.LocationCode, loc.LocationName
  FROM ppm.RateCards rc
  LEFT JOIN cfg.ConfigValues rv ON rv.ConfigValueId = rc.ResourceRoleValueId
  LEFT JOIN cfg.ConfigValues tv ON tv.ConfigValueId = rc.ResourceTypeValueId
  LEFT JOIN org.Locations loc ON loc.LocationId = rc.LocationId
`;

async function handleList(pool) {
  const result = await pool.request().query(`${SELECT_LIST} ORDER BY rc.RateCardName;`);
  return { jsonBody: { success: true, count: result.recordset.length, rateCards: result.recordset } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_LIST} WHERE rc.RateCardId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Rate card ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, rateCard: result.recordset[0] } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const {
    rateCardCode, rateCardName, resourceRoleCode, resourceTypeCode, locationCode,
    costRatePerHour, billRatePerHour, effectiveStartDate, effectiveEndDate, notes,
  } = body || {};
  if (!rateCardCode || !rateCardName || costRatePerHour === undefined || costRatePerHour === null) {
    const err = new Error('rateCardCode, rateCardName, and costRatePerHour are required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const roleId = resourceRoleCode ? await lookupConfigValueId(pool.request(), 'ResourceRole', resourceRoleCode) : null;
  const typeId = resourceTypeCode ? await lookupConfigValueId(pool.request(), 'ResourceType', resourceTypeCode) : null;
  const locationId = locationCode ? await lookupLocationId(pool.request(), locationCode) : null;

  const result = await pool.request()
    .input('code', sql.NVarChar, rateCardCode)
    .input('name', sql.NVarChar, rateCardName)
    .input('roleId', sql.Int, roleId)
    .input('typeId', sql.Int, typeId)
    .input('locationId', sql.Int, locationId)
    .input('costRate', sql.Decimal(10, 2), costRatePerHour)
    .input('billRate', sql.Decimal(10, 2), billRatePerHour ?? null)
    .input('startDate', sql.Date, effectiveStartDate ?? null)
    .input('endDate', sql.Date, effectiveEndDate ?? null)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.RateCards (RateCardCode, RateCardName, ResourceRoleValueId, ResourceTypeValueId, LocationId, CostRatePerHour, BillRatePerHour, EffectiveStartDate, EffectiveEndDate, Notes)
      OUTPUT INSERTED.RateCardId
      VALUES (@code, @name, @roleId, @typeId, @locationId, @costRate, @billRate, @startDate, @endDate, @notes);
    `);
  return await handleGetOne(pool, result.recordset[0].RateCardId);
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.RateCards WHERE RateCardId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Rate card ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  const roleId = body.resourceRoleCode !== undefined
    ? (body.resourceRoleCode === null ? null : await lookupConfigValueId(pool.request(), 'ResourceRole', body.resourceRoleCode))
    : row.ResourceRoleValueId;
  const typeId = body.resourceTypeCode !== undefined
    ? (body.resourceTypeCode === null ? null : await lookupConfigValueId(pool.request(), 'ResourceType', body.resourceTypeCode))
    : row.ResourceTypeValueId;
  const locationId = body.locationCode !== undefined
    ? (body.locationCode === null ? null : await lookupLocationId(pool.request(), body.locationCode))
    : row.LocationId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.rateCardName ?? row.RateCardName)
    .input('roleId', sql.Int, roleId)
    .input('typeId', sql.Int, typeId)
    .input('locationId', sql.Int, locationId)
    .input('costRate', sql.Decimal(10, 2), body.costRatePerHour ?? row.CostRatePerHour)
    .input('billRate', sql.Decimal(10, 2), body.billRatePerHour ?? row.BillRatePerHour)
    .input('startDate', sql.Date, body.effectiveStartDate ?? row.EffectiveStartDate)
    .input('endDate', sql.Date, body.effectiveEndDate ?? row.EffectiveEndDate)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.RateCards
      SET RateCardName = @name, ResourceRoleValueId = @roleId, ResourceTypeValueId = @typeId, LocationId = @locationId,
          CostRatePerHour = @costRate, BillRatePerHour = @billRate, EffectiveStartDate = @startDate, EffectiveEndDate = @endDate,
          IsActive = @isActive, Notes = @notes, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE RateCardId = @id;
    `);
  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT RateCardId FROM ppm.RateCards WHERE RateCardId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Rate card ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.RateCards SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE RateCardId = @id;
  `);
  return { jsonBody: { success: true, message: `Rate card ${id} archived.` } };
}

app.http('rateCards', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/rate-cards/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Rate Cards API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Rate card request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

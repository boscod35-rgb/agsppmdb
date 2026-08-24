const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/portfolios/{id?}
//
// GET    -> list all portfolios (joined with Business Unit + Status label)
// GET /{id} -> single portfolio
// POST   -> create (auto-generates PortfolioCode from cfg.NumberingRules,
//           EntityType='Portfolio', inside the same transaction as the insert)
// PUT    /{id} -> update
// DELETE /{id} -> archive (IsActive = 0, never a hard delete)
//
// Same conventions as organization.js / configValues.js: no secrets
// in responses, no auth yet so CreatedBy/UpdatedBy reflect the SQL
// login.

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
  if (/Invalid object name.*ppm\.Portfolios/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Portfolios does not exist yet. Run migration 007_portfolio_program_project.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A portfolio with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

// Atomically increments cfg.NumberingRules.CurrentSequence for the
// given EntityType and returns the generated code, inside the
// caller's transaction so a failed insert never burns a sequence
// number.
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

const SELECT_LIST = `
  SELECT p.*, bu.BusinessUnitCode, bu.BusinessUnitName,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel
  FROM ppm.Portfolios p
  LEFT JOIN org.BusinessUnits bu ON bu.BusinessUnitId = p.BusinessUnitId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = p.StatusValueId
`;

async function handleList(pool) {
  const result = await pool.request().query(`${SELECT_LIST} ORDER BY p.PortfolioName;`);
  return { jsonBody: { success: true, count: result.recordset.length, portfolios: result.recordset } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_LIST} WHERE p.PortfolioId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Portfolio ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, portfolio: result.recordset[0] } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const { name, businessUnitCode, ownerName, statusCode, description, notes } = body || {};
  if (!name) {
    const err = new Error('name is required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const code = await generateCode(transaction, 'Portfolio');

    let businessUnitId = null;
    if (businessUnitCode) {
      const bu = await new sql.Request(transaction)
        .input('code', sql.NVarChar, businessUnitCode)
        .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code');
      if (bu.recordset.length === 0) {
        const err = new Error(`Business Unit "${businessUnitCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      businessUnitId = bu.recordset[0].BusinessUnitId;
    }

    let statusValueId = null;
    if (statusCode) {
      const sv = await new sql.Request(transaction)
        .input('code', sql.NVarChar, statusCode)
        .query(`
          SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
          JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
          WHERE cc.CategoryCode = 'PortfolioStatus' AND cv.ValueCode = @code
        `);
      if (sv.recordset.length === 0) {
        const err = new Error(`Portfolio status "${statusCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      statusValueId = sv.recordset[0].ConfigValueId;
    }

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('buId', sql.Int, businessUnitId)
      .input('owner', sql.NVarChar, ownerName ?? null)
      .input('statusId', sql.Int, statusValueId)
      .input('description', sql.NVarChar, description ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.Portfolios (PortfolioCode, PortfolioName, BusinessUnitId, OwnerName, StatusValueId, Description, Notes)
        OUTPUT INSERTED.PortfolioId
        VALUES (@code, @name, @buId, @owner, @statusId, @description, @notes);
      `);

    await transaction.commit();
    return await handleGetOne(pool, result.recordset[0].PortfolioId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.Portfolios WHERE PortfolioId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Portfolio ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  let businessUnitId = row.BusinessUnitId;
  if (body.businessUnitCode !== undefined) {
    if (body.businessUnitCode === null) {
      businessUnitId = null;
    } else {
      const bu = await pool.request().input('code', sql.NVarChar, body.businessUnitCode)
        .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code');
      if (bu.recordset.length === 0) {
        const err = new Error(`Business Unit "${body.businessUnitCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      businessUnitId = bu.recordset[0].BusinessUnitId;
    }
  }

  let statusValueId = row.StatusValueId;
  if (body.statusCode !== undefined) {
    if (body.statusCode === null) {
      statusValueId = null;
    } else {
      const sv = await pool.request().input('code', sql.NVarChar, body.statusCode)
        .query(`
          SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
          JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
          WHERE cc.CategoryCode = 'PortfolioStatus' AND cv.ValueCode = @code
        `);
      if (sv.recordset.length === 0) {
        const err = new Error(`Portfolio status "${body.statusCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      statusValueId = sv.recordset[0].ConfigValueId;
    }
  }

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.name ?? row.PortfolioName)
    .input('buId', sql.Int, businessUnitId)
    .input('owner', sql.NVarChar, body.ownerName ?? row.OwnerName)
    .input('statusId', sql.Int, statusValueId)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Portfolios
      SET PortfolioName = @name, BusinessUnitId = @buId, OwnerName = @owner, StatusValueId = @statusId,
          Description = @description, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE PortfolioId = @id;
    `);

  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT PortfolioId FROM ppm.Portfolios WHERE PortfolioId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Portfolio ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Portfolios SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE PortfolioId = @id;
  `);
  return { jsonBody: { success: true, message: `Portfolio ${id} archived.` } };
}

app.http('portfolios', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/portfolios/{id?}',
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
      context.error('Portfolios API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Portfolio request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

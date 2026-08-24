const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/programs/{id?}
//
// GET    -> list all programs (joined with Portfolio + Status label;
//           ?portfolio=PF-001 filters to that portfolio's code)
// GET /{id} -> single program
// POST   -> create (auto-generates ProgramCode from cfg.NumberingRules,
//           EntityType='Program'; portfolioCode is required)
// PUT    /{id} -> update
// DELETE /{id} -> archive (IsActive = 0, never a hard delete)

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
  if (/Invalid object name.*ppm\.Programs/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Programs does not exist yet. Run migration 007_portfolio_program_project.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A program with this code already exists.' };
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

async function lookupPortfolioId(executor, portfolioCode) {
  const result = await executor.input('pfCode', sql.NVarChar, portfolioCode)
    .query('SELECT PortfolioId FROM ppm.Portfolios WHERE PortfolioCode = @pfCode');
  if (result.recordset.length === 0) {
    const err = new Error(`Portfolio "${portfolioCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].PortfolioId;
}

const SELECT_LIST = `
  SELECT pg.*, pf.PortfolioCode, pf.PortfolioName,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel
  FROM ppm.Programs pg
  JOIN ppm.Portfolios pf ON pf.PortfolioId = pg.PortfolioId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = pg.StatusValueId
`;

async function handleList(pool, request) {
  const portfolioFilter = request.query.get('portfolio');
  const req = pool.request();
  let query = SELECT_LIST;
  if (portfolioFilter) {
    query += ' WHERE pf.PortfolioCode = @pf';
    req.input('pf', sql.NVarChar, portfolioFilter);
  }
  query += ' ORDER BY pg.ProgramName;';
  const result = await req.query(query);
  return { jsonBody: { success: true, count: result.recordset.length, programs: result.recordset } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_LIST} WHERE pg.ProgramId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Program ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, program: result.recordset[0] } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const { name, portfolioCode, programManagerName, statusCode, description, notes } = body || {};
  if (!name || !portfolioCode) {
    const err = new Error('name and portfolioCode are required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const portfolioId = await lookupPortfolioId(new sql.Request(transaction), portfolioCode);
    const code = await generateCode(transaction, 'Program');

    let statusValueId = null;
    if (statusCode) {
      const sv = await new sql.Request(transaction)
        .input('code', sql.NVarChar, statusCode)
        .query(`
          SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
          JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
          WHERE cc.CategoryCode = 'ProgramStatus' AND cv.ValueCode = @code
        `);
      if (sv.recordset.length === 0) {
        const err = new Error(`Program status "${statusCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      statusValueId = sv.recordset[0].ConfigValueId;
    }

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('pfId', sql.Int, portfolioId)
      .input('pm', sql.NVarChar, programManagerName ?? null)
      .input('statusId', sql.Int, statusValueId)
      .input('description', sql.NVarChar, description ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.Programs (ProgramCode, ProgramName, PortfolioId, ProgramManagerName, StatusValueId, Description, Notes)
        OUTPUT INSERTED.ProgramId
        VALUES (@code, @name, @pfId, @pm, @statusId, @description, @notes);
      `);

    await transaction.commit();
    return await handleGetOne(pool, result.recordset[0].ProgramId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.Programs WHERE ProgramId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Program ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  let portfolioId = row.PortfolioId;
  if (body.portfolioCode) {
    portfolioId = await lookupPortfolioId(pool.request(), body.portfolioCode);
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
          WHERE cc.CategoryCode = 'ProgramStatus' AND cv.ValueCode = @code
        `);
      if (sv.recordset.length === 0) {
        const err = new Error(`Program status "${body.statusCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      statusValueId = sv.recordset[0].ConfigValueId;
    }
  }

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.name ?? row.ProgramName)
    .input('pfId', sql.Int, portfolioId)
    .input('pm', sql.NVarChar, body.programManagerName ?? row.ProgramManagerName)
    .input('statusId', sql.Int, statusValueId)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Programs
      SET ProgramName = @name, PortfolioId = @pfId, ProgramManagerName = @pm, StatusValueId = @statusId,
          Description = @description, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ProgramId = @id;
    `);

  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT ProgramId FROM ppm.Programs WHERE ProgramId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Program ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Programs SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ProgramId = @id;
  `);
  return { jsonBody: { success: true, message: `Program ${id} archived.` } };
}

app.http('programs', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/programs/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool, request);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Programs API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Program request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

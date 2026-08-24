const { app } = require('@azure/functions');
const sql = require('mssql');

// GET /api/config/values?category=ProjectType
// Returns the Configuration Engine's picklist values (Module 05).
// Read-only, no secrets in the response.

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
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

app.http('configValues', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config/values',
  handler: async (request, context) => {
    try {
      const category = request.query.get('category'); // CategoryCode, e.g. ProjectType

      const pool = await getPool();
      const sqlRequest = pool.request();

      let query = `
        SELECT
          cv.ConfigValueId, cv.CategoryId, cc.CategoryCode, cc.CategoryName,
          cv.ValueCode, cv.ValueLabel, cv.SortOrder, cv.IsActive, cv.IsDefault, cv.Notes
        FROM cfg.ConfigValues cv
        JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
      `;

      if (category) {
        query += ' WHERE cc.CategoryCode = @category';
        sqlRequest.input('category', sql.NVarChar, category);
      }

      query += ' ORDER BY cc.SortOrder, cv.SortOrder;';

      const result = await sqlRequest.query(query);

      return {
        jsonBody: {
          success: true,
          count: result.recordset.length,
          values: result.recordset,
        },
      };
    } catch (err) {
      context.error('Config values query error:', err.message);
      const safe = classifyError(err);
      return {
        status: 500,
        jsonBody: {
          success: false,
          message: 'Failed to load configuration values',
          error: safe.error,
          detail: safe.detail,
        },
      };
    }
  },
});

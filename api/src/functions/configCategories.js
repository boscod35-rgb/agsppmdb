const { app } = require('@azure/functions');
const sql = require('mssql');

// GET /api/config/categories
// Returns the Configuration Engine's picklist categories (Module 05).
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
  if (/Invalid object name.*ConfigCategories/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cfg.ConfigCategories does not exist yet. Run migration 003_config_engine.sql.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

app.http('configCategories', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config/categories',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT CategoryId, CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder
        FROM cfg.ConfigCategories
        ORDER BY SortOrder, CategoryName;
      `);

      return {
        jsonBody: {
          success: true,
          count: result.recordset.length,
          categories: result.recordset,
        },
      };
    } catch (err) {
      context.error('Config categories query error:', err.message);
      const safe = classifyError(err);
      return {
        status: 500,
        jsonBody: {
          success: false,
          message: 'Failed to load configuration categories',
          error: safe.error,
          detail: safe.detail,
        },
      };
    }
  },
});

const { app } = require('@azure/functions');
const sql = require('mssql');

// GET /api/db-test
// Connects to Azure SQL (PPM_DEV) using credentials from Function App
// Application Settings and runs a trivial read-only query. Never returns
// passwords, connection strings, or tokens - only a safe error category.

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
      encrypt: true, // required for Azure SQL
      trustServerCertificate: false,
    },
    connectionTimeout: 15000,
    requestTimeout: 15000,
  };
}

// Reuse a single connection pool across invocations (the Function App host
// process stays warm between calls, so this avoids reconnecting every time).
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

// Map raw driver/config errors to a small set of safe, non-sensitive
// categories the frontend already knows how to display.
function classifyError(err) {
  if (err.category === 'CONFIG_MISSING') {
    return {
      error: 'CONFIG_MISSING',
      detail: 'One or more required Application Settings are missing on the Function App (DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD).',
    };
  }

  const code = err.code || '';
  if (code === 'ELOGIN') {
    return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed. Check DB_USER / DB_PASSWORD in Application Settings.' };
  }
  if (code === 'ETIMEOUT' || code === 'ESOCKET') {
    return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server. Check Azure SQL firewall rules and DB_SERVER/DB_PORT.' };
  }

  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error. Check Function App logs for details.' };
}

app.http('dbTest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'db-test',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .query('SELECT DB_NAME() AS databaseName, GETUTCDATE() AS serverTime;');

      const row = result.recordset[0];

      return {
        jsonBody: {
          success: true,
          database: row.databaseName,
          serverTime: row.serverTime,
        },
      };
    } catch (err) {
      // Full detail goes to Function App logs only, never to the response.
      context.error('Database connection error:', err.message);

      const safe = classifyError(err);
      return {
        status: 500,
        jsonBody: {
          success: false,
          message: 'Database connection failed',
          error: safe.error,
          detail: safe.detail,
        },
      };
    }
  },
});

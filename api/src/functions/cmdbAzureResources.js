const { app } = require('@azure/functions');
const sql = require('mssql');

// GET /api/cmdb/azure-resources?environment=DEV
// Returns the CMDB's Azure Info records (Section 107). Read-only,
// no secrets in the response - AdminLogin is a username, never a
// password or connection string.

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
  if (/Invalid object name.*AzureResources/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cmdb.AzureResources does not exist yet. Run migration 002_cmdb.sql.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

app.http('cmdbAzureResources', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cmdb/azure-resources',
  handler: async (request, context) => {
    try {
      const environment = request.query.get('environment'); // DEV | TEST | PROD | null

      const pool = await getPool();
      const sqlRequest = pool.request();

      let query = `
        SELECT
          ResourceId, ResourceCode, Environment, ResourceType,
          ResourceName, ResourceGroup, Region, Endpoint, AdminLogin,
          ParentResourceId, Status, Notes, CreatedDate, LastVerifiedDate
        FROM cmdb.AzureResources
      `;

      if (environment) {
        query += ' WHERE Environment = @environment';
        sqlRequest.input('environment', sql.NVarChar, environment);
      }

      query += ' ORDER BY Environment, ResourceId;';

      const result = await sqlRequest.query(query);

      return {
        jsonBody: {
          success: true,
          count: result.recordset.length,
          resources: result.recordset,
        },
      };
    } catch (err) {
      context.error('CMDB query error:', err.message);
      const safe = classifyError(err);
      return {
        status: 500,
        jsonBody: {
          success: false,
          message: 'Failed to load CMDB data',
          error: safe.error,
          detail: safe.detail,
        },
      };
    }
  },
});

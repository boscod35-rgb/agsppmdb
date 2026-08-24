const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/config/numbering/{id?}
// GET    -> list all rules
// POST   -> create a rule
// PUT    /{id} -> update a rule
// DELETE /{id} -> soft-delete (IsActive = 0)
// GET    /{id}/preview -> preview what the next generated code
//         would look like, WITHOUT incrementing CurrentSequence
//         (a real increment only happens once real entities exist
//         to consume it - out of scope for this chunk)

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
  if (/Invalid object name.*NumberingRules/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cfg.NumberingRules does not exist yet. Run migration 006.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_ENTITY_TYPE', detail: 'A rule for this EntityType already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

function buildPreview(rule) {
  const nextSeq = rule.CurrentSequence + 1;
  const padded = String(nextSeq).padStart(rule.SequenceLength, '0');
  const parts = [rule.Prefix, padded, rule.Suffix].filter(Boolean);
  return parts.join(rule.Separator || '-');
}

app.http('numbering', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'config/numbering/{id?}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;
      const action = request.params.action;

      if (request.method === 'GET' && id && action === 'preview') {
        const result = await pool.request().input('id', sql.Int, id)
          .query('SELECT * FROM cfg.NumberingRules WHERE NumberingRuleId = @id');
        if (result.recordset.length === 0) {
          const err = new Error(`Numbering rule ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        return { jsonBody: { success: true, preview: buildPreview(result.recordset[0]) } };
      }

      if (request.method === 'GET') {
        const result = await pool.request().query('SELECT * FROM cfg.NumberingRules ORDER BY EntityType;');
        const rules = result.recordset.map((r) => ({ ...r, PreviewNext: buildPreview(r) }));
        return { jsonBody: { success: true, count: rules.length, rules } };
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const { entityType, prefix, suffix, separator, sequenceLength, startingNumber, resetRule, notes } = body || {};
        if (!entityType) {
          const err = new Error('entityType is required.');
          err.category = 'VALIDATION';
          throw err;
        }
        const result = await pool.request()
          .input('entityType', sql.NVarChar, entityType)
          .input('prefix', sql.NVarChar, prefix ?? '')
          .input('suffix', sql.NVarChar, suffix ?? '')
          .input('separator', sql.NVarChar, separator ?? '-')
          .input('sequenceLength', sql.Int, sequenceLength ?? 5)
          .input('startingNumber', sql.Int, startingNumber ?? 1)
          .input('resetRule', sql.NVarChar, resetRule ?? 'Never')
          .input('notes', sql.NVarChar, notes ?? null)
          .query(`
            INSERT INTO cfg.NumberingRules (EntityType, Prefix, Suffix, Separator, SequenceLength, StartingNumber, ResetRule, Notes)
            OUTPUT INSERTED.*
            VALUES (@entityType, @prefix, @suffix, @separator, @sequenceLength, @startingNumber, @resetRule, @notes);
          `);
        return { status: 201, jsonBody: { success: true, rule: result.recordset[0] } };
      }

      if (request.method === 'PUT' && id) {
        const body = await request.json();
        const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM cfg.NumberingRules WHERE NumberingRuleId = @id');
        if (existing.recordset.length === 0) {
          const err = new Error(`Numbering rule ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        const row = existing.recordset[0];
        const result = await pool.request()
          .input('id', sql.Int, id)
          .input('prefix', sql.NVarChar, body.prefix ?? row.Prefix)
          .input('suffix', sql.NVarChar, body.suffix ?? row.Suffix)
          .input('separator', sql.NVarChar, body.separator ?? row.Separator)
          .input('sequenceLength', sql.Int, body.sequenceLength ?? row.SequenceLength)
          .input('resetRule', sql.NVarChar, body.resetRule ?? row.ResetRule)
          .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
          .input('notes', sql.NVarChar, body.notes ?? row.Notes)
          .query(`
            UPDATE cfg.NumberingRules
            SET Prefix = @prefix, Suffix = @suffix, Separator = @separator, SequenceLength = @sequenceLength,
                ResetRule = @resetRule, IsActive = @isActive, Notes = @notes,
                UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
            OUTPUT INSERTED.*
            WHERE NumberingRuleId = @id;
          `);
        return { jsonBody: { success: true, rule: result.recordset[0] } };
      }

      if (request.method === 'DELETE' && id) {
        const existing = await pool.request().input('id', sql.Int, id).query('SELECT NumberingRuleId FROM cfg.NumberingRules WHERE NumberingRuleId = @id');
        if (existing.recordset.length === 0) {
          const err = new Error(`Numbering rule ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        await pool.request().input('id', sql.Int, id).query(`
          UPDATE cfg.NumberingRules SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
          WHERE NumberingRuleId = @id;
        `);
        return { jsonBody: { success: true, message: `Numbering rule ${id} deactivated.` } };
      }

      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Numbering API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Numbering request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

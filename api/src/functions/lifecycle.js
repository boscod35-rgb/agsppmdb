const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/config/lifecycle/{id?}
// GET  (no id)     -> list lifecycles, each with its phases nested
// GET  /{id}        -> single lifecycle with phases
// POST              -> create a lifecycle (optionally with an initial phases array)
// PUT  /{id}         -> update lifecycle-level fields (name, isActive, notes)
// DELETE /{id}        -> soft-delete the lifecycle (does not touch its phases' IsActive)
// POST /{id}/phases    -> add a phase to a lifecycle
// PUT  /{id}/phases/{phaseId} -> update a phase
// DELETE /{id}/phases/{phaseId} -> soft-delete a phase

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
  if (/Invalid object name.*Lifecycle/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cfg.Lifecycles does not exist yet. Run migration 006.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A lifecycle with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function attachPhases(pool, lifecycles) {
  if (lifecycles.length === 0) return lifecycles;
  const ids = lifecycles.map((l) => l.LifecycleId);
  const result = await pool.request().query(
    `SELECT * FROM cfg.LifecyclePhases WHERE LifecycleId IN (${ids.join(',')}) ORDER BY SequenceOrder;`
  );
  return lifecycles.map((l) => ({
    ...l,
    phases: result.recordset.filter((p) => p.LifecycleId === l.LifecycleId),
  }));
}

app.http('lifecycle', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'config/lifecycle/{id?}/{sub?}/{subId?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;
      const sub = request.params.sub; // 'phases' or undefined
      const subId = request.params.subId ? Number(request.params.subId) : null;

      // ---- Phase sub-routes ----
      if (sub === 'phases') {
        if (request.method === 'POST' && id) {
          const body = await request.json();
          const { phaseName, sequenceOrder, isRequired } = body || {};
          if (!phaseName) {
            const err = new Error('phaseName is required.');
            err.category = 'VALIDATION';
            throw err;
          }
          const result = await pool.request()
            .input('lifecycleId', sql.Int, id)
            .input('phaseName', sql.NVarChar, phaseName)
            .input('sequenceOrder', sql.Int, sequenceOrder ?? 0)
            .input('isRequired', sql.Bit, isRequired ?? true)
            .query(`
              INSERT INTO cfg.LifecyclePhases (LifecycleId, PhaseName, SequenceOrder, IsRequired)
              OUTPUT INSERTED.*
              VALUES (@lifecycleId, @phaseName, @sequenceOrder, @isRequired);
            `);
          return { status: 201, jsonBody: { success: true, phase: result.recordset[0] } };
        }
        if (request.method === 'PUT' && subId) {
          const body = await request.json();
          const existing = await pool.request().input('id', sql.Int, subId).query('SELECT * FROM cfg.LifecyclePhases WHERE PhaseId = @id');
          if (existing.recordset.length === 0) {
            const err = new Error(`Phase ${subId} not found.`);
            err.category = 'NOT_FOUND';
            throw err;
          }
          const row = existing.recordset[0];
          const result = await pool.request()
            .input('id', sql.Int, subId)
            .input('phaseName', sql.NVarChar, body.phaseName ?? row.PhaseName)
            .input('sequenceOrder', sql.Int, body.sequenceOrder ?? row.SequenceOrder)
            .input('isRequired', sql.Bit, body.isRequired ?? row.IsRequired)
            .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
            .query(`
              UPDATE cfg.LifecyclePhases
              SET PhaseName = @phaseName, SequenceOrder = @sequenceOrder, IsRequired = @isRequired, IsActive = @isActive,
                  UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
              OUTPUT INSERTED.*
              WHERE PhaseId = @id;
            `);
          return { jsonBody: { success: true, phase: result.recordset[0] } };
        }
        if (request.method === 'DELETE' && subId) {
          await pool.request().input('id', sql.Int, subId).query(`
            UPDATE cfg.LifecyclePhases SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
            WHERE PhaseId = @id;
          `);
          return { jsonBody: { success: true, message: `Phase ${subId} deactivated.` } };
        }
      }

      // ---- Lifecycle-level routes ----
      if (request.method === 'GET') {
        const query = id
          ? `SELECT * FROM cfg.Lifecycles WHERE LifecycleId = ${id};`
          : 'SELECT * FROM cfg.Lifecycles ORDER BY LifecycleName;';
        const result = await pool.request().query(query);
        const withPhases = await attachPhases(pool, result.recordset);
        return { jsonBody: { success: true, count: withPhases.length, lifecycles: withPhases } };
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const { lifecycleCode, lifecycleName, notes } = body || {};
        if (!lifecycleCode || !lifecycleName) {
          const err = new Error('lifecycleCode and lifecycleName are required.');
          err.category = 'VALIDATION';
          throw err;
        }
        const result = await pool.request()
          .input('code', sql.NVarChar, lifecycleCode)
          .input('name', sql.NVarChar, lifecycleName)
          .input('notes', sql.NVarChar, notes ?? null)
          .query(`
            INSERT INTO cfg.Lifecycles (LifecycleCode, LifecycleName, Notes)
            OUTPUT INSERTED.*
            VALUES (@code, @name, @notes);
          `);
        return { status: 201, jsonBody: { success: true, lifecycle: result.recordset[0] } };
      }

      if (request.method === 'PUT' && id) {
        const body = await request.json();
        const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM cfg.Lifecycles WHERE LifecycleId = @id');
        if (existing.recordset.length === 0) {
          const err = new Error(`Lifecycle ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        const row = existing.recordset[0];
        const result = await pool.request()
          .input('id', sql.Int, id)
          .input('name', sql.NVarChar, body.lifecycleName ?? row.LifecycleName)
          .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
          .input('notes', sql.NVarChar, body.notes ?? row.Notes)
          .query(`
            UPDATE cfg.Lifecycles
            SET LifecycleName = @name, IsActive = @isActive, Notes = @notes,
                UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
            OUTPUT INSERTED.*
            WHERE LifecycleId = @id;
          `);
        return { jsonBody: { success: true, lifecycle: result.recordset[0] } };
      }

      if (request.method === 'DELETE' && id) {
        await pool.request().input('id', sql.Int, id).query(`
          UPDATE cfg.Lifecycles SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
          WHERE LifecycleId = @id;
        `);
        return { jsonBody: { success: true, message: `Lifecycle ${id} deactivated.` } };
      }

      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Lifecycle API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Lifecycle request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

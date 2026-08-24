const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/config/branding/{id?}
// GET    -> list all themes
// POST   -> create a theme
// PUT    /{id} -> update a theme
// DELETE /{id} -> soft-delete (IsActive = 0)
//
// NOTE: this API only manages theme records. The live app does not
// yet read from this table to apply colors/fonts - see
// CURRENT_STATUS.md / DECISIONS.md for why that's a separate,
// deliberately deferred step.

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
  if (/Invalid object name.*BrandThemes/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'cfg.BrandThemes does not exist yet. Run migration 006.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A theme with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function clearDefault(pool, excludeId) {
  const req = pool.request();
  let query = 'UPDATE cfg.BrandThemes SET IsDefault = 0';
  if (excludeId) {
    req.input('excludeId', sql.Int, excludeId);
    query += ' WHERE ThemeId != @excludeId';
  }
  await req.query(query);
}

app.http('branding', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'config/branding/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET') {
        const result = await pool.request().query('SELECT * FROM cfg.BrandThemes ORDER BY ThemeName;');
        return { jsonBody: { success: true, count: result.recordset.length, themes: result.recordset } };
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const {
          themeCode, themeName, isDefault, companyName, tagline,
          colorPrimary, colorSecondary, colorAccent,
          colorStatusGreen, colorStatusAmber, colorStatusRed, notes,
        } = body || {};
        if (!themeCode || !themeName) {
          const err = new Error('themeCode and themeName are required.');
          err.category = 'VALIDATION';
          throw err;
        }
        if (isDefault) await clearDefault(pool, null);
        const result = await pool.request()
          .input('code', sql.NVarChar, themeCode)
          .input('name', sql.NVarChar, themeName)
          .input('isDefault', sql.Bit, isDefault ? 1 : 0)
          .input('companyName', sql.NVarChar, companyName ?? null)
          .input('tagline', sql.NVarChar, tagline ?? null)
          .input('colorPrimary', sql.NVarChar, colorPrimary ?? null)
          .input('colorSecondary', sql.NVarChar, colorSecondary ?? null)
          .input('colorAccent', sql.NVarChar, colorAccent ?? null)
          .input('colorStatusGreen', sql.NVarChar, colorStatusGreen ?? null)
          .input('colorStatusAmber', sql.NVarChar, colorStatusAmber ?? null)
          .input('colorStatusRed', sql.NVarChar, colorStatusRed ?? null)
          .input('notes', sql.NVarChar, notes ?? null)
          .query(`
            INSERT INTO cfg.BrandThemes (
              ThemeCode, ThemeName, IsDefault, CompanyName, Tagline,
              ColorPrimary, ColorSecondary, ColorAccent,
              ColorStatusGreen, ColorStatusAmber, ColorStatusRed, Notes
            )
            OUTPUT INSERTED.*
            VALUES (
              @code, @name, @isDefault, @companyName, @tagline,
              @colorPrimary, @colorSecondary, @colorAccent,
              @colorStatusGreen, @colorStatusAmber, @colorStatusRed, @notes
            );
          `);
        return { status: 201, jsonBody: { success: true, theme: result.recordset[0] } };
      }

      if (request.method === 'PUT' && id) {
        const body = await request.json();
        const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM cfg.BrandThemes WHERE ThemeId = @id');
        if (existing.recordset.length === 0) {
          const err = new Error(`Theme ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        const row = existing.recordset[0];
        if (body.isDefault) await clearDefault(pool, id);

        const result = await pool.request()
          .input('id', sql.Int, id)
          .input('name', sql.NVarChar, body.themeName ?? row.ThemeName)
          .input('isDefault', sql.Bit, body.isDefault ?? row.IsDefault)
          .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
          .input('companyName', sql.NVarChar, body.companyName ?? row.CompanyName)
          .input('tagline', sql.NVarChar, body.tagline ?? row.Tagline)
          .input('colorPrimary', sql.NVarChar, body.colorPrimary ?? row.ColorPrimary)
          .input('colorSecondary', sql.NVarChar, body.colorSecondary ?? row.ColorSecondary)
          .input('colorAccent', sql.NVarChar, body.colorAccent ?? row.ColorAccent)
          .input('colorStatusGreen', sql.NVarChar, body.colorStatusGreen ?? row.ColorStatusGreen)
          .input('colorStatusAmber', sql.NVarChar, body.colorStatusAmber ?? row.ColorStatusAmber)
          .input('colorStatusRed', sql.NVarChar, body.colorStatusRed ?? row.ColorStatusRed)
          .input('notes', sql.NVarChar, body.notes ?? row.Notes)
          .query(`
            UPDATE cfg.BrandThemes
            SET ThemeName = @name, IsDefault = @isDefault, IsActive = @isActive,
                CompanyName = @companyName, Tagline = @tagline,
                ColorPrimary = @colorPrimary, ColorSecondary = @colorSecondary, ColorAccent = @colorAccent,
                ColorStatusGreen = @colorStatusGreen, ColorStatusAmber = @colorStatusAmber, ColorStatusRed = @colorStatusRed,
                Notes = @notes, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
            OUTPUT INSERTED.*
            WHERE ThemeId = @id;
          `);
        return { jsonBody: { success: true, theme: result.recordset[0] } };
      }

      if (request.method === 'DELETE' && id) {
        const existing = await pool.request().input('id', sql.Int, id).query('SELECT ThemeId FROM cfg.BrandThemes WHERE ThemeId = @id');
        if (existing.recordset.length === 0) {
          const err = new Error(`Theme ${id} not found.`);
          err.category = 'NOT_FOUND';
          throw err;
        }
        await pool.request().input('id', sql.Int, id).query(`
          UPDATE cfg.BrandThemes SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
          WHERE ThemeId = @id;
        `);
        return { jsonBody: { success: true, message: `Theme ${id} deactivated.` } };
      }

      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Branding API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Branding request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

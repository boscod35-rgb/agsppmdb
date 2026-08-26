const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/three-sixty/{projectId}/{id?}
// GET    /{projectId} -> list feedback entries for the project
// POST   /{projectId} -> create (feedback required; respondentName,
//           respondentRole, overallRatingCode, submittedDate optional)
// PUT    /{projectId}/{id} -> update
// DELETE /{projectId}/{id} -> archive
//
// Deliberately lightweight (Module 31 is explicitly described that
// way in the framework) - a single flat table, no workflow, no
// approval step, no nested structure.

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
  if (/Invalid object name.*ThreeSixtyAssessments/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ThreeSixtyAssessments does not exist yet. Run migration 013_gap_assessment.sql.' };
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

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

const SELECT_ITEM = `
  SELECT a.*, rv.ValueCode AS OverallRatingCode, rv.ValueLabel AS OverallRatingLabel
  FROM ppm.ThreeSixtyAssessments a
  LEFT JOIN cfg.ConfigValues rv ON rv.ConfigValueId = a.OverallRatingValueId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_ITEM} WHERE a.ProjectId = @projectId AND a.IsActive = 1 ORDER BY a.SubmittedDate DESC, a.CreatedDate DESC;`);
  return { jsonBody: { success: true, count: result.recordset.length, items: result.recordset } };
}

async function getOne(pool, projectId, id) {
  const result = await pool.request().input('id', sql.Int, id).input('projectId', sql.Int, projectId)
    .query(`${SELECT_ITEM} WHERE a.AssessmentId = @id AND a.ProjectId = @projectId;`);
  if (result.recordset.length === 0) {
    const err = new Error(`360 assessment ${id} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { respondentName, respondentRole, overallRatingCode, feedback, submittedDate } = body || {};
  if (!feedback) {
    const err = new Error('feedback is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const ratingId = overallRatingCode ? await lookupConfigValueId(pool.request(), 'ThreeSixtyRating', overallRatingCode) : null;

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('respondentName', sql.NVarChar, respondentName ?? null)
    .input('respondentRole', sql.NVarChar, respondentRole ?? null)
    .input('ratingId', sql.Int, ratingId)
    .input('feedback', sql.NVarChar, feedback)
    .input('submittedDate', sql.Date, submittedDate ?? null)
    .query(`
      INSERT INTO ppm.ThreeSixtyAssessments (ProjectId, RespondentName, RespondentRole, OverallRatingValueId, Feedback, SubmittedDate)
      OUTPUT INSERTED.AssessmentId
      VALUES (@projectId, @respondentName, @respondentRole, @ratingId, @feedback, @submittedDate);
    `);
  return { status: 201, jsonBody: { success: true, item: await getOne(pool, projectId, result.recordset[0].AssessmentId) } };
}

async function handleUpdate(pool, projectId, id, request) {
  const row = await getOne(pool, projectId, id);
  const body = await request.json();
  const ratingId = body.overallRatingCode !== undefined
    ? (body.overallRatingCode === null ? null : await lookupConfigValueId(pool.request(), 'ThreeSixtyRating', body.overallRatingCode))
    : row.OverallRatingValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('respondentName', sql.NVarChar, body.respondentName ?? row.RespondentName)
    .input('respondentRole', sql.NVarChar, body.respondentRole ?? row.RespondentRole)
    .input('ratingId', sql.Int, ratingId)
    .input('feedback', sql.NVarChar, body.feedback ?? row.Feedback)
    .input('submittedDate', sql.Date, body.submittedDate ?? row.SubmittedDate)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .query(`
      UPDATE ppm.ThreeSixtyAssessments
      SET RespondentName = @respondentName, RespondentRole = @respondentRole, OverallRatingValueId = @ratingId,
          Feedback = @feedback, SubmittedDate = @submittedDate, IsActive = @isActive,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE AssessmentId = @id;
    `);
  return { jsonBody: { success: true, item: await getOne(pool, projectId, id) } };
}

async function handleArchive(pool, projectId, id) {
  await getOne(pool, projectId, id);
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.ThreeSixtyAssessments SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE AssessmentId = @id;
  `);
  return { jsonBody: { success: true, message: `360 assessment ${id} archived.` } };
}

app.http('threeSixty', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/three-sixty/{projectId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && !id) return await handleList(pool, projectId);
      if (request.method === 'POST' && !id) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, projectId, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, projectId, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid 360 assessment request.' } };
    } catch (err) {
      context.error('360 Assessment API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: '360 assessment request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/gap-assessment/{projectId}/{questionId?}
//
// GET /{projectId} -> the full Pillar -> SubArea -> Question tree
//           (same shape as gap-framework/pillars), with this
//           project's response (rating/finding/etc, or null if not
//           yet answered) merged onto each question as `response`.
// PUT /{projectId}/{questionId} -> upsert this project's response to
//           that question (ratingCode, findingText, assessedByName,
//           assessedDate, notes - all optional). Creates the
//           response row if none exists yet, updates it otherwise -
//           the caller never needs to know which case applies.

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
  if (/Invalid object name.*GapAssessment/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'Gap Assessment tables do not exist yet. Run migration 013_gap_assessment.sql.' };
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

async function handleGet(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);

  const pillars = await pool.request().query('SELECT * FROM ppm.GapAssessmentPillars WHERE IsActive = 1 ORDER BY SequenceOrder;');
  const pillarIds = pillars.recordset.map((p) => p.PillarId);
  const subAreas = pillarIds.length
    ? (await pool.request().query(`SELECT * FROM ppm.GapAssessmentSubAreas WHERE PillarId IN (${pillarIds.join(',')}) AND IsActive = 1 ORDER BY SequenceOrder;`)).recordset
    : [];
  const subAreaIds = subAreas.map((s) => s.SubAreaId);
  const questions = subAreaIds.length
    ? (await pool.request().query(`SELECT * FROM ppm.GapAssessmentQuestions WHERE SubAreaId IN (${subAreaIds.join(',')}) AND IsActive = 1 ORDER BY SequenceOrder;`)).recordset
    : [];

  const responses = await pool.request().input('projectId', sql.Int, projectId).query(`
    SELECT r.*, rv.ValueCode AS RatingCode, rv.ValueLabel AS RatingLabel
    FROM ppm.GapAssessmentResponses r
    LEFT JOIN cfg.ConfigValues rv ON rv.ConfigValueId = r.RatingValueId
    WHERE r.ProjectId = @projectId AND r.IsActive = 1;
  `);

  const questionsWithResponse = questions.map((q) => ({
    ...q, response: responses.recordset.find((r) => r.QuestionId === q.QuestionId) || null,
  }));
  const subAreasWithQuestions = subAreas.map((s) => ({
    ...s, questions: questionsWithResponse.filter((q) => q.SubAreaId === s.SubAreaId),
  }));
  const pillarsWithTree = pillars.recordset.map((p) => ({
    ...p, subAreas: subAreasWithQuestions.filter((s) => s.PillarId === p.PillarId),
  }));

  const totalQuestions = questions.length;
  const answeredQuestions = responses.recordset.length;

  return {
    jsonBody: {
      success: true,
      pillars: pillarsWithTree,
      summary: { totalQuestions, answeredQuestions, percentComplete: totalQuestions ? Math.round((answeredQuestions / totalQuestions) * 100) : 0 },
    },
  };
}

async function handleUpsertResponse(pool, projectId, questionId, request) {
  await assertProjectExists(pool.request(), projectId);
  const question = await pool.request().input('id', sql.Int, questionId).query('SELECT QuestionId FROM ppm.GapAssessmentQuestions WHERE QuestionId = @id');
  if (question.recordset.length === 0) {
    const err = new Error(`Question ${questionId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }

  const body = await request.json();
  const { ratingCode, findingText, assessedByName, assessedDate, notes } = body || {};
  const ratingId = ratingCode ? await lookupConfigValueId(pool.request(), 'GapAssessmentRating', ratingCode) : null;

  const existing = await pool.request().input('projectId', sql.Int, projectId).input('questionId', sql.Int, questionId)
    .query('SELECT * FROM ppm.GapAssessmentResponses WHERE ProjectId = @projectId AND QuestionId = @questionId AND IsActive = 1');

  if (existing.recordset.length === 0) {
    await pool.request()
      .input('projectId', sql.Int, projectId)
      .input('questionId', sql.Int, questionId)
      .input('ratingId', sql.Int, ratingId)
      .input('finding', sql.NVarChar, findingText ?? null)
      .input('assessedBy', sql.NVarChar, assessedByName ?? null)
      .input('assessedDate', sql.Date, assessedDate ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.GapAssessmentResponses (ProjectId, QuestionId, RatingValueId, FindingText, AssessedByName, AssessedDate, Notes)
        VALUES (@projectId, @questionId, @ratingId, @finding, @assessedBy, @assessedDate, @notes);
      `);
  } else {
    const row = existing.recordset[0];
    await pool.request()
      .input('id', sql.Int, row.ResponseId)
      .input('ratingId', sql.Int, ratingId ?? row.RatingValueId)
      .input('finding', sql.NVarChar, findingText ?? row.FindingText)
      .input('assessedBy', sql.NVarChar, assessedByName ?? row.AssessedByName)
      .input('assessedDate', sql.Date, assessedDate ?? row.AssessedDate)
      .input('notes', sql.NVarChar, notes ?? row.Notes)
      .query(`
        UPDATE ppm.GapAssessmentResponses
        SET RatingValueId = @ratingId, FindingText = @finding, AssessedByName = @assessedBy, AssessedDate = @assessedDate, Notes = @notes,
            UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
        WHERE ResponseId = @id;
      `);
  }

  return { jsonBody: { success: true, message: `Response to question ${questionId} saved.` } };
}

app.http('gapAssessment', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'ppm/gap-assessment/{projectId}/{questionId?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const questionId = request.params.questionId ? Number(request.params.questionId) : null;

      if (request.method === 'GET') return await handleGet(pool, projectId);
      if (request.method === 'PUT' && questionId) return await handleUpsertResponse(pool, projectId, questionId, request);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT requires a /{questionId}.' } };
    } catch (err) {
      context.error('Gap Assessment API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Gap Assessment request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

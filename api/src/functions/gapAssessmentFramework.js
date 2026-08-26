const { app } = require('@azure/functions');
const sql = require('mssql');

// Three flat routes rather than one deeply-nested one (Pillar ->
// SubArea -> Question is already a level deeper than anything else
// in the platform; nesting the URL to match would need 6 path
// segments). Same one-file-multiple-resources pattern as
// organization.js.
//
// /api/ppm/gap-framework/pillars/{id?}
//   GET (no id) -> list all pillars, each with nested subAreas (each
//     with nested questions) - the full framework tree in one call
//   POST -> create (pillarCode + pillarName required)
//   PUT/DELETE /{id} -> update / archive
//
// /api/ppm/gap-framework/subareas/{pillarId}/{id?}
//   POST /{pillarId} -> add a sub-area under that pillar
//   PUT/DELETE /{pillarId}/{id} -> update / archive
//
// /api/ppm/gap-framework/questions/{subAreaId}/{id?}
//   POST /{subAreaId} -> add a question under that sub-area
//   PUT/DELETE /{subAreaId}/{id} -> update / archive

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
    return { error: 'SCHEMA_MISSING', detail: 'Gap Assessment Framework tables do not exist yet. Run migration 013_gap_assessment.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A pillar with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

// ---- Pillars (with nested subAreas -> questions) ----

async function attachFrameworkTree(pool, pillars) {
  if (pillars.length === 0) return pillars;
  const pillarIds = pillars.map((p) => p.PillarId);
  const subAreas = await pool.request().query(
    `SELECT * FROM ppm.GapAssessmentSubAreas WHERE PillarId IN (${pillarIds.join(',')}) AND IsActive = 1 ORDER BY SequenceOrder;`
  );
  const subAreaIds = subAreas.recordset.map((s) => s.SubAreaId);
  const questions = subAreaIds.length
    ? (await pool.request().query(
        `SELECT * FROM ppm.GapAssessmentQuestions WHERE SubAreaId IN (${subAreaIds.join(',')}) AND IsActive = 1 ORDER BY SequenceOrder;`
      )).recordset
    : [];

  const subAreasWithQuestions = subAreas.recordset.map((s) => ({
    ...s, questions: questions.filter((q) => q.SubAreaId === s.SubAreaId),
  }));
  return pillars.map((p) => ({
    ...p, subAreas: subAreasWithQuestions.filter((s) => s.PillarId === p.PillarId),
  }));
}

async function handleListPillars(pool) {
  const result = await pool.request().query('SELECT * FROM ppm.GapAssessmentPillars WHERE IsActive = 1 ORDER BY SequenceOrder;');
  const withTree = await attachFrameworkTree(pool, result.recordset);
  return { jsonBody: { success: true, count: withTree.length, pillars: withTree } };
}

async function handleCreatePillar(pool, request) {
  const body = await request.json();
  const { pillarCode, pillarName, sequenceOrder, notes } = body || {};
  if (!pillarCode || !pillarName) {
    const err = new Error('pillarCode and pillarName are required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const maxSeq = await pool.request().query('SELECT ISNULL(MAX(SequenceOrder), 0) AS MaxSeq FROM ppm.GapAssessmentPillars');
  const result = await pool.request()
    .input('code', sql.NVarChar, pillarCode)
    .input('name', sql.NVarChar, pillarName)
    .input('seq', sql.Int, sequenceOrder ?? (maxSeq.recordset[0].MaxSeq + 10))
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.GapAssessmentPillars (PillarCode, PillarName, SequenceOrder, Notes)
      OUTPUT INSERTED.PillarId
      VALUES (@code, @name, @seq, @notes);
    `);
  return { status: 201, jsonBody: { success: true, pillarId: result.recordset[0].PillarId } };
}

async function handleUpdatePillar(pool, id, request) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.GapAssessmentPillars WHERE PillarId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Pillar ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();
  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.pillarName ?? row.PillarName)
    .input('seq', sql.Int, body.sequenceOrder ?? row.SequenceOrder)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.GapAssessmentPillars SET PillarName = @name, SequenceOrder = @seq, IsActive = @isActive, Notes = @notes,
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE PillarId = @id;
    `);
  return { jsonBody: { success: true, message: `Pillar ${id} updated.` } };
}

async function handleArchivePillar(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT PillarId FROM ppm.GapAssessmentPillars WHERE PillarId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Pillar ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.GapAssessmentPillars SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE PillarId = @id;
  `);
  return { jsonBody: { success: true, message: `Pillar ${id} archived.` } };
}

// ---- Sub-Areas ----

async function handleAddSubArea(pool, pillarId, request) {
  const pillar = await pool.request().input('id', sql.Int, pillarId).query('SELECT PillarId FROM ppm.GapAssessmentPillars WHERE PillarId = @id');
  if (pillar.recordset.length === 0) {
    const err = new Error(`Pillar ${pillarId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const body = await request.json();
  const { subAreaName, sequenceOrder, notes } = body || {};
  if (!subAreaName) {
    const err = new Error('subAreaName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const result = await pool.request()
    .input('pillarId', sql.Int, pillarId)
    .input('name', sql.NVarChar, subAreaName)
    .input('seq', sql.Int, sequenceOrder ?? 0)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.GapAssessmentSubAreas (PillarId, SubAreaName, SequenceOrder, Notes)
      OUTPUT INSERTED.SubAreaId
      VALUES (@pillarId, @name, @seq, @notes);
    `);
  return { status: 201, jsonBody: { success: true, subAreaId: result.recordset[0].SubAreaId } };
}

async function handleUpdateSubArea(pool, id, request) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.GapAssessmentSubAreas WHERE SubAreaId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Sub-area ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();
  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.subAreaName ?? row.SubAreaName)
    .input('seq', sql.Int, body.sequenceOrder ?? row.SequenceOrder)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.GapAssessmentSubAreas SET SubAreaName = @name, SequenceOrder = @seq, IsActive = @isActive, Notes = @notes,
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE SubAreaId = @id;
    `);
  return { jsonBody: { success: true, message: `Sub-area ${id} updated.` } };
}

async function handleArchiveSubArea(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT SubAreaId FROM ppm.GapAssessmentSubAreas WHERE SubAreaId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Sub-area ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.GapAssessmentSubAreas SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE SubAreaId = @id;
  `);
  return { jsonBody: { success: true, message: `Sub-area ${id} archived.` } };
}

// ---- Questions ----

async function handleAddQuestion(pool, subAreaId, request) {
  const subArea = await pool.request().input('id', sql.Int, subAreaId).query('SELECT SubAreaId FROM ppm.GapAssessmentSubAreas WHERE SubAreaId = @id');
  if (subArea.recordset.length === 0) {
    const err = new Error(`Sub-area ${subAreaId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const body = await request.json();
  const { questionText, sequenceOrder, notes } = body || {};
  if (!questionText) {
    const err = new Error('questionText is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const result = await pool.request()
    .input('subAreaId', sql.Int, subAreaId)
    .input('text', sql.NVarChar, questionText)
    .input('seq', sql.Int, sequenceOrder ?? 0)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.GapAssessmentQuestions (SubAreaId, QuestionText, SequenceOrder, Notes)
      OUTPUT INSERTED.QuestionId
      VALUES (@subAreaId, @text, @seq, @notes);
    `);
  return { status: 201, jsonBody: { success: true, questionId: result.recordset[0].QuestionId } };
}

async function handleUpdateQuestion(pool, id, request) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.GapAssessmentQuestions WHERE QuestionId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Question ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();
  await pool.request()
    .input('id', sql.Int, id)
    .input('text', sql.NVarChar, body.questionText ?? row.QuestionText)
    .input('seq', sql.Int, body.sequenceOrder ?? row.SequenceOrder)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.GapAssessmentQuestions SET QuestionText = @text, SequenceOrder = @seq, IsActive = @isActive, Notes = @notes,
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE QuestionId = @id;
    `);
  return { jsonBody: { success: true, message: `Question ${id} updated.` } };
}

async function handleArchiveQuestion(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT QuestionId FROM ppm.GapAssessmentQuestions WHERE QuestionId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Question ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.GapAssessmentQuestions SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE QuestionId = @id;
  `);
  return { jsonBody: { success: true, message: `Question ${id} archived.` } };
}

app.http('gapFrameworkPillars', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/gap-framework/pillars/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;
      if (request.method === 'GET') return await handleListPillars(pool);
      if (request.method === 'POST') return await handleCreatePillar(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdatePillar(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchivePillar(pool, id);
      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Gap Framework Pillars API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Gap Framework request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

app.http('gapFrameworkSubAreas', {
  methods: ['POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/gap-framework/subareas/{pillarId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const pillarId = Number(request.params.pillarId);
      const id = request.params.id ? Number(request.params.id) : null;
      if (request.method === 'POST' && !id) return await handleAddSubArea(pool, pillarId, request);
      if (request.method === 'PUT' && id) return await handleUpdateSubArea(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchiveSubArea(pool, id);
      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Gap Framework Sub-Areas API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Gap Framework request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

app.http('gapFrameworkQuestions', {
  methods: ['POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/gap-framework/questions/{subAreaId}/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const subAreaId = Number(request.params.subAreaId);
      const id = request.params.id ? Number(request.params.id) : null;
      if (request.method === 'POST' && !id) return await handleAddQuestion(pool, subAreaId, request);
      if (request.method === 'PUT' && id) return await handleUpdateQuestion(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchiveQuestion(pool, id);
      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Gap Framework Questions API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return { status, jsonBody: { success: false, message: 'Gap Framework request failed', error: safe.error, detail: safe.detail } };
    }
  },
});

const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/schedule/tasks/{projectId}/{taskId?}/{sub?}/{subId?}
//
// GET    /{projectId} -> list tasks for the project, each with its
//           dependencies nested (same pattern as templates.js's items)
// POST   /{projectId} -> create a task (taskName required)
// PUT    /{projectId}/{taskId} -> update a task
// DELETE /{projectId}/{taskId} -> archive a task
// POST   /{projectId}/{taskId}/dependencies -> add a dependency
//           (dependsOnTaskId required, dependencyTypeCode optional,
//           defaults to FS)
// DELETE /{projectId}/{taskId}/dependencies/{depId} -> remove a dependency

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
  if (/Invalid object name.*ScheduleTasks/i.test(err.message || '') || /Invalid object name.*TaskDependencies/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ScheduleTasks / ppm.TaskDependencies do not exist yet. Run migration 009_wbs_schedule_delivery.sql.' };
  }
  if (/CK_TaskDependencies_NotSelf/i.test(err.message || '')) {
    return { error: 'VALIDATION_FAILED', detail: 'A task cannot depend on itself.' };
  }
  if (/UQ_TaskDependencies/i.test(err.message || '')) {
    return { error: 'DUPLICATE_DEPENDENCY', detail: 'This dependency already exists between these two tasks.' };
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

async function lookupDefaultValueId(executor, categoryCode) {
  const result = await executor.input('cat', sql.NVarChar, categoryCode).query(`
    SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
    JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = @cat AND cv.IsDefault = 1
  `);
  return result.recordset.length ? result.recordset[0].ConfigValueId : null;
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

async function assertTaskExists(executor, taskId, projectId) {
  const result = await executor.input('id', sql.Int, taskId).input('projectId', sql.Int, projectId)
    .query('SELECT * FROM ppm.ScheduleTasks WHERE ScheduleTaskId = @id AND ProjectId = @projectId');
  if (result.recordset.length === 0) {
    const err = new Error(`Task ${taskId} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

const SELECT_TASK = `
  SELECT t.*, sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel
  FROM ppm.ScheduleTasks t
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = t.StatusValueId
`;

async function attachDependencies(pool, tasks) {
  if (tasks.length === 0) return tasks;
  const ids = tasks.map((t) => t.ScheduleTaskId);
  const result = await pool.request().query(`
    SELECT d.*, dt.ValueCode AS DependencyTypeCode, dt.ValueLabel AS DependencyTypeLabel, st.TaskName AS DependsOnTaskName
    FROM ppm.TaskDependencies d
    LEFT JOIN cfg.ConfigValues dt ON dt.ConfigValueId = d.DependencyTypeValueId
    LEFT JOIN ppm.ScheduleTasks st ON st.ScheduleTaskId = d.DependsOnTaskId
    WHERE d.TaskId IN (${ids.join(',')});
  `);
  return tasks.map((t) => ({ ...t, dependencies: result.recordset.filter((d) => d.TaskId === t.ScheduleTaskId) }));
}

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_TASK} WHERE t.ProjectId = @projectId AND t.IsActive = 1 ORDER BY t.StartDate, t.TaskName;`);
  const withDeps = await attachDependencies(pool, result.recordset);
  return { jsonBody: { success: true, count: withDeps.length, tasks: withDeps } };
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { taskName, startDate, dueDate, percentComplete, statusCode, notes } = body || {};
  if (!taskName) {
    const err = new Error('taskName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const statusId = statusCode
    ? await lookupConfigValueId(pool.request(), 'TaskStatus', statusCode)
    : await lookupDefaultValueId(pool.request(), 'TaskStatus');

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('taskName', sql.NVarChar, taskName)
    .input('startDate', sql.Date, startDate ?? null)
    .input('dueDate', sql.Date, dueDate ?? null)
    .input('percentComplete', sql.Int, percentComplete ?? 0)
    .input('statusId', sql.Int, statusId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ScheduleTasks (ProjectId, TaskName, StartDate, DueDate, PercentComplete, StatusValueId, Notes)
      OUTPUT INSERTED.ScheduleTaskId
      VALUES (@projectId, @taskName, @startDate, @dueDate, @percentComplete, @statusId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, taskId: result.recordset[0].ScheduleTaskId } };
}

async function handleUpdate(pool, projectId, taskId, request) {
  const row = await assertTaskExists(pool.request(), taskId, projectId);
  const body = await request.json();
  const statusId = body.statusCode !== undefined
    ? (body.statusCode === null ? null : await lookupConfigValueId(pool.request(), 'TaskStatus', body.statusCode))
    : row.StatusValueId;

  await pool.request()
    .input('id', sql.Int, taskId)
    .input('taskName', sql.NVarChar, body.taskName ?? row.TaskName)
    .input('startDate', sql.Date, body.startDate ?? row.StartDate)
    .input('dueDate', sql.Date, body.dueDate ?? row.DueDate)
    .input('percentComplete', sql.Int, body.percentComplete ?? row.PercentComplete)
    .input('statusId', sql.Int, statusId)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ScheduleTasks
      SET TaskName = @taskName, StartDate = @startDate, DueDate = @dueDate, PercentComplete = @percentComplete,
          StatusValueId = @statusId, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ScheduleTaskId = @id;
    `);
  return { jsonBody: { success: true, message: `Task ${taskId} updated.` } };
}

async function handleArchive(pool, projectId, taskId) {
  await assertTaskExists(pool.request(), taskId, projectId);
  await pool.request().input('id', sql.Int, taskId).query(`
    UPDATE ppm.ScheduleTasks SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ScheduleTaskId = @id;
  `);
  return { jsonBody: { success: true, message: `Task ${taskId} archived.` } };
}

async function handleAddDependency(pool, projectId, taskId, request) {
  await assertTaskExists(pool.request(), taskId, projectId);
  const body = await request.json();
  const { dependsOnTaskId, dependencyTypeCode } = body || {};
  if (!dependsOnTaskId) {
    const err = new Error('dependsOnTaskId is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  await assertTaskExists(pool.request(), dependsOnTaskId, projectId);
  const typeId = dependencyTypeCode
    ? await lookupConfigValueId(pool.request(), 'DependencyType', dependencyTypeCode)
    : await lookupDefaultValueId(pool.request(), 'DependencyType');

  const result = await pool.request()
    .input('taskId', sql.Int, taskId)
    .input('dependsOnTaskId', sql.Int, dependsOnTaskId)
    .input('typeId', sql.Int, typeId)
    .query(`
      INSERT INTO ppm.TaskDependencies (TaskId, DependsOnTaskId, DependencyTypeValueId)
      OUTPUT INSERTED.TaskDependencyId
      VALUES (@taskId, @dependsOnTaskId, @typeId);
    `);
  return { status: 201, jsonBody: { success: true, dependencyId: result.recordset[0].TaskDependencyId } };
}

async function handleRemoveDependency(pool, depId) {
  const existing = await pool.request().input('id', sql.Int, depId).query('SELECT TaskDependencyId FROM ppm.TaskDependencies WHERE TaskDependencyId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Dependency ${depId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, depId).query('DELETE FROM ppm.TaskDependencies WHERE TaskDependencyId = @id');
  return { jsonBody: { success: true, message: `Dependency ${depId} removed.` } };
}

app.http('scheduleTasks', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/schedule/tasks/{projectId}/{taskId?}/{sub?}/{subId?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const taskId = request.params.taskId ? Number(request.params.taskId) : null;
      const sub = request.params.sub;
      const subId = request.params.subId ? Number(request.params.subId) : null;

      if (sub === 'dependencies') {
        if (request.method === 'POST' && taskId) return await handleAddDependency(pool, projectId, taskId, request);
        if (request.method === 'DELETE' && subId) return await handleRemoveDependency(pool, subId);
        return { status: 400, jsonBody: { success: false, message: 'Invalid dependencies sub-route request.' } };
      }

      if (request.method === 'GET' && !taskId) return await handleList(pool, projectId);
      if (request.method === 'POST' && !taskId) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && taskId) return await handleUpdate(pool, projectId, taskId, request);
      if (request.method === 'DELETE' && taskId) return await handleArchive(pool, projectId, taskId);

      return { status: 400, jsonBody: { success: false, message: 'Invalid schedule task request.' } };
    } catch (err) {
      context.error('Schedule Tasks API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Schedule task request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

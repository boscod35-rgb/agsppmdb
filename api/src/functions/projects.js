const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/projects/{id?}
//
// GET    -> paginated/searchable/filterable/sortable list (built and
//           indexed for the framework's explicit 250+ project
//           requirement - see query params below)
// GET /{id} -> single project, fully joined with all lookups
// POST   -> create (auto-generates ProjectCode from cfg.NumberingRules,
//           EntityType='Project'; portfolioCode is required, everything
//           else optional)
// PUT    /{id} -> update
// DELETE /{id} -> archive (IsActive = 0, never a hard delete)
//
// GET list query params:
//   page          default 1
//   pageSize      default 25, max 100
//   search        matches ProjectName or ProjectCode (contains)
//   status        ProjectStatus ValueCode, e.g. ACTIVE
//   portfolio     PortfolioCode, e.g. PF-001
//   program       ProgramCode, e.g. PG-0001
//   sortBy        ProjectName | ProjectCode | CreatedDate | StartDate | TargetEndDate (default ProjectName)
//   sortDir       asc | desc (default asc)
//   includeInactive  'true' to include archived projects (default: active only)

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
  if (/Invalid object name.*ppm\.Projects/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Projects does not exist yet. Run migration 007_portfolio_program_project.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A project with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function generateCode(transaction, entityType) {
  const result = await new sql.Request(transaction)
    .input('entityType', sql.NVarChar, entityType)
    .query(`
      UPDATE cfg.NumberingRules
      SET CurrentSequence = CurrentSequence + 1
      OUTPUT INSERTED.CurrentSequence, INSERTED.Prefix, INSERTED.Suffix, INSERTED.Separator, INSERTED.SequenceLength
      WHERE EntityType = @entityType AND IsActive = 1;
    `);
  if (result.recordset.length === 0) {
    const err = new Error(`No active numbering rule for EntityType "${entityType}". Configure one under Administration -> Numbering.`);
    err.category = 'VALIDATION';
    throw err;
  }
  const rule = result.recordset[0];
  const padded = String(rule.CurrentSequence).padStart(rule.SequenceLength, '0');
  return [rule.Prefix, padded, rule.Suffix].filter(Boolean).join(rule.Separator || '-');
}

async function lookupPortfolioId(executor, portfolioCode) {
  const result = await executor.input('pfCode', sql.NVarChar, portfolioCode)
    .query('SELECT PortfolioId FROM ppm.Portfolios WHERE PortfolioCode = @pfCode');
  if (result.recordset.length === 0) {
    const err = new Error(`Portfolio "${portfolioCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].PortfolioId;
}

async function lookupProgramId(executor, programCode) {
  const result = await executor.input('pgCode', sql.NVarChar, programCode)
    .query('SELECT ProgramId FROM ppm.Programs WHERE ProgramCode = @pgCode');
  if (result.recordset.length === 0) {
    const err = new Error(`Program "${programCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].ProgramId;
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

async function lookupLifecycleId(executor, lifecycleCode) {
  const result = await executor.input('code', sql.NVarChar, lifecycleCode)
    .query('SELECT LifecycleId FROM cfg.Lifecycles WHERE LifecycleCode = @code');
  if (result.recordset.length === 0) {
    const err = new Error(`Lifecycle "${lifecycleCode}" does not exist.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0].LifecycleId;
}

const DETAIL_SELECT = `
  SELECT pr.*,
         pf.PortfolioCode, pf.PortfolioName,
         pg.ProgramCode, pg.ProgramName,
         tv.ValueCode AS ProjectTypeCode, tv.ValueLabel AS ProjectTypeLabel,
         cv.ValueCode AS ProjectCategoryCode, cv.ValueLabel AS ProjectCategoryLabel,
         szv.ValueCode AS ProjectSizeCode, szv.ValueLabel AS ProjectSizeLabel,
         cxv.ValueCode AS ProjectComplexityCode, cxv.ValueLabel AS ProjectComplexityLabel,
         pv.ValueCode AS ProjectPriorityCode, pv.ValueLabel AS ProjectPriorityLabel,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel,
         hv.ValueCode AS HealthStatusCode, hv.ValueLabel AS HealthStatusLabel,
         lc.LifecycleCode, lc.LifecycleName
  FROM ppm.Projects pr
  JOIN ppm.Portfolios pf ON pf.PortfolioId = pr.PortfolioId
  LEFT JOIN ppm.Programs pg ON pg.ProgramId = pr.ProgramId
  LEFT JOIN cfg.ConfigValues tv ON tv.ConfigValueId = pr.ProjectTypeValueId
  LEFT JOIN cfg.ConfigValues cv ON cv.ConfigValueId = pr.ProjectCategoryValueId
  LEFT JOIN cfg.ConfigValues szv ON szv.ConfigValueId = pr.ProjectSizeValueId
  LEFT JOIN cfg.ConfigValues cxv ON cxv.ConfigValueId = pr.ProjectComplexityValueId
  LEFT JOIN cfg.ConfigValues pv ON pv.ConfigValueId = pr.ProjectPriorityValueId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = pr.StatusValueId
  LEFT JOIN cfg.ConfigValues hv ON hv.ConfigValueId = pr.HealthStatusValueId
  LEFT JOIN cfg.Lifecycles lc ON lc.LifecycleId = pr.LifecycleId
`;

const SORT_COLUMNS = {
  ProjectName: 'pr.ProjectName',
  ProjectCode: 'pr.ProjectCode',
  CreatedDate: 'pr.CreatedDate',
  StartDate: 'pr.StartDate',
  TargetEndDate: 'pr.TargetEndDate',
};

async function handleList(pool, request) {
  const q = request.query;
  const page = Math.max(1, Number(q.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize')) || 25));
  const search = q.get('search');
  const status = q.get('status');
  const portfolio = q.get('portfolio');
  const program = q.get('program');
  const sortBy = SORT_COLUMNS[q.get('sortBy')] || SORT_COLUMNS.ProjectName;
  const sortDir = (q.get('sortDir') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const includeInactive = q.get('includeInactive') === 'true';

  const req = pool.request();
  const where = [];
  if (!includeInactive) where.push('pr.IsActive = 1');
  if (search) { where.push('(pr.ProjectName LIKE @search OR pr.ProjectCode LIKE @search)'); req.input('search', sql.NVarChar, `%${search}%`); }
  if (status) { where.push('sv.ValueCode = @status'); req.input('status', sql.NVarChar, status); }
  if (portfolio) { where.push('pf.PortfolioCode = @portfolio'); req.input('portfolio', sql.NVarChar, portfolio); }
  if (program) { where.push('pg.ProgramCode = @program'); req.input('program', sql.NVarChar, program); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  req.input('offset', sql.Int, (page - 1) * pageSize);
  req.input('pageSize', sql.Int, pageSize);

  const dataResult = await req.query(`
    ${DETAIL_SELECT}
    ${whereClause}
    ORDER BY ${sortBy} ${sortDir}
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `);

  // Separate lightweight count query (same filters, no join needed
  // beyond what the filters reference) so pagination stays cheap
  // even as the table grows toward and past 250+ rows.
  const countReq = pool.request();
  if (search) countReq.input('search', sql.NVarChar, `%${search}%`);
  if (status) countReq.input('status', sql.NVarChar, status);
  if (portfolio) countReq.input('portfolio', sql.NVarChar, portfolio);
  if (program) countReq.input('program', sql.NVarChar, program);
  const countResult = await countReq.query(`
    SELECT COUNT(*) AS Total
    FROM ppm.Projects pr
    JOIN ppm.Portfolios pf ON pf.PortfolioId = pr.PortfolioId
    LEFT JOIN ppm.Programs pg ON pg.ProgramId = pr.ProgramId
    LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = pr.StatusValueId
    ${whereClause};
  `);
  const totalCount = countResult.recordset[0].Total;

  return {
    jsonBody: {
      success: true,
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      projects: dataResult.recordset,
    },
  };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${DETAIL_SELECT} WHERE pr.ProjectId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, project: result.recordset[0] } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const {
    name, portfolioCode, programCode, projectManagerName,
    projectTypeCode, projectCategoryCode, projectSizeCode, projectComplexityCode, projectPriorityCode,
    statusCode, healthStatusCode, lifecycleCode, startDate, targetEndDate, description, notes,
  } = body || {};

  if (!name || !portfolioCode) {
    const err = new Error('name and portfolioCode are required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const portfolioId = await lookupPortfolioId(new sql.Request(transaction), portfolioCode);
    const programId = programCode ? await lookupProgramId(new sql.Request(transaction), programCode) : null;
    const code = await generateCode(transaction, 'Project');

    const typeId = projectTypeCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectType', projectTypeCode) : null;
    const categoryId = projectCategoryCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectCategory', projectCategoryCode) : null;
    const sizeId = projectSizeCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectSize', projectSizeCode) : null;
    const complexityId = projectComplexityCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectComplexity', projectComplexityCode) : null;
    const priorityId = projectPriorityCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectPriority', projectPriorityCode) : null;
    const statusId = statusCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectStatus', statusCode) : null;
    const healthId = healthStatusCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectHealthStatus', healthStatusCode) : null;
    const lifecycleId = lifecycleCode ? await lookupLifecycleId(new sql.Request(transaction), lifecycleCode) : null;

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('pfId', sql.Int, portfolioId)
      .input('pgId', sql.Int, programId)
      .input('pm', sql.NVarChar, projectManagerName ?? null)
      .input('typeId', sql.Int, typeId)
      .input('categoryId', sql.Int, categoryId)
      .input('sizeId', sql.Int, sizeId)
      .input('complexityId', sql.Int, complexityId)
      .input('priorityId', sql.Int, priorityId)
      .input('statusId', sql.Int, statusId)
      .input('healthId', sql.Int, healthId)
      .input('lifecycleId', sql.Int, lifecycleId)
      .input('startDate', sql.Date, startDate ?? null)
      .input('targetEndDate', sql.Date, targetEndDate ?? null)
      .input('description', sql.NVarChar, description ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.Projects (
          ProjectCode, ProjectName, PortfolioId, ProgramId, ProjectManagerName,
          ProjectTypeValueId, ProjectCategoryValueId, ProjectSizeValueId, ProjectComplexityValueId, ProjectPriorityValueId,
          StatusValueId, HealthStatusValueId, LifecycleId, StartDate, TargetEndDate, Description, Notes
        )
        OUTPUT INSERTED.ProjectId
        VALUES (
          @code, @name, @pfId, @pgId, @pm,
          @typeId, @categoryId, @sizeId, @complexityId, @priorityId,
          @statusId, @healthId, @lifecycleId, @startDate, @targetEndDate, @description, @notes
        );
      `);

    await transaction.commit();
    return await handleGetOne(pool, result.recordset[0].ProjectId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.Projects WHERE ProjectId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Project ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  async function resolveLookup(field, current, lookupFn, ...args) {
    if (body[field] === undefined) return current;
    if (body[field] === null) return null;
    return await lookupFn(pool.request(), ...args, body[field]);
  }

  const portfolioId = body.portfolioCode !== undefined
    ? await lookupPortfolioId(pool.request(), body.portfolioCode)
    : row.PortfolioId;
  const programId = body.programCode !== undefined
    ? (body.programCode === null ? null : await lookupProgramId(pool.request(), body.programCode))
    : row.ProgramId;

  const typeId = await resolveLookup('projectTypeCode', row.ProjectTypeValueId, lookupConfigValueId, 'ProjectType');
  const categoryId = await resolveLookup('projectCategoryCode', row.ProjectCategoryValueId, lookupConfigValueId, 'ProjectCategory');
  const sizeId = await resolveLookup('projectSizeCode', row.ProjectSizeValueId, lookupConfigValueId, 'ProjectSize');
  const complexityId = await resolveLookup('projectComplexityCode', row.ProjectComplexityValueId, lookupConfigValueId, 'ProjectComplexity');
  const priorityId = await resolveLookup('projectPriorityCode', row.ProjectPriorityValueId, lookupConfigValueId, 'ProjectPriority');
  const statusId = await resolveLookup('statusCode', row.StatusValueId, lookupConfigValueId, 'ProjectStatus');
  const healthId = await resolveLookup('healthStatusCode', row.HealthStatusValueId, lookupConfigValueId, 'ProjectHealthStatus');
  const lifecycleId = body.lifecycleCode !== undefined
    ? (body.lifecycleCode === null ? null : await lookupLifecycleId(pool.request(), body.lifecycleCode))
    : row.LifecycleId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.name ?? row.ProjectName)
    .input('pfId', sql.Int, portfolioId)
    .input('pgId', sql.Int, programId)
    .input('pm', sql.NVarChar, body.projectManagerName ?? row.ProjectManagerName)
    .input('typeId', sql.Int, typeId)
    .input('categoryId', sql.Int, categoryId)
    .input('sizeId', sql.Int, sizeId)
    .input('complexityId', sql.Int, complexityId)
    .input('priorityId', sql.Int, priorityId)
    .input('statusId', sql.Int, statusId)
    .input('healthId', sql.Int, healthId)
    .input('lifecycleId', sql.Int, lifecycleId)
    .input('startDate', sql.Date, body.startDate ?? row.StartDate)
    .input('targetEndDate', sql.Date, body.targetEndDate ?? row.TargetEndDate)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Projects
      SET ProjectName = @name, PortfolioId = @pfId, ProgramId = @pgId, ProjectManagerName = @pm,
          ProjectTypeValueId = @typeId, ProjectCategoryValueId = @categoryId, ProjectSizeValueId = @sizeId,
          ProjectComplexityValueId = @complexityId, ProjectPriorityValueId = @priorityId,
          StatusValueId = @statusId, HealthStatusValueId = @healthId, LifecycleId = @lifecycleId,
          StartDate = @startDate, TargetEndDate = @targetEndDate, Description = @description,
          IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ProjectId = @id;
    `);

  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Project ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Projects SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ProjectId = @id;
  `);
  return { jsonBody: { success: true, message: `Project ${id} archived.` } };
}

app.http('projects', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/projects/{id?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;

      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool, request);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Projects API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Project request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

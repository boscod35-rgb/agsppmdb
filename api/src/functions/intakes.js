const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/intakes/{id?}/{action?}
// GET    -> list intakes (joined with Business Unit, Template, Status label)
// GET /{id} -> single intake
// POST   -> create (auto-generates IntakeCode from cfg.NumberingRules,
//           EntityType='Intake'; defaults StatusValueId to IntakeStatus's
//           default value - Submitted - if not supplied)
// PUT    /{id} -> update
// DELETE /{id} -> archive (IsActive = 0, never a hard delete)
// POST   /{id}/convert -> creates a real ppm.Projects row from this
//           intake (requires portfolioCode; programCode optional),
//           using the same transactional Numbering pattern as
//           POST /api/ppm/projects, then marks the intake Converted
//           and links ProjectId. Fails if already converted.

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
  if (err.category === 'ALREADY_CONVERTED') return { error: 'ALREADY_CONVERTED', detail: err.message };
  const code = err.code || '';
  if (code === 'ELOGIN') return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  if (code === 'ETIMEOUT' || code === 'ESOCKET') return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  if (/Invalid object name.*ProjectIntakes/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ProjectIntakes does not exist yet. Run migration 008_intake_charter_templates.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'An intake with this code already exists.' };
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

async function lookupDefaultStatusId(executor, categoryCode) {
  const result = await executor.input('cat', sql.NVarChar, categoryCode).query(`
    SELECT cv.ConfigValueId FROM cfg.ConfigValues cv
    JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = @cat AND cv.IsDefault = 1
  `);
  return result.recordset.length ? result.recordset[0].ConfigValueId : null;
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

const SELECT_LIST = `
  SELECT ik.*, bu.BusinessUnitCode, bu.BusinessUnitName,
         tpl.TemplateCode, tpl.TemplateName,
         sv.ValueCode AS StatusCode, sv.ValueLabel AS StatusLabel,
         p.ProjectCode AS ConvertedProjectCode
  FROM ppm.ProjectIntakes ik
  LEFT JOIN org.BusinessUnits bu ON bu.BusinessUnitId = ik.BusinessUnitId
  LEFT JOIN ppm.ProjectTemplates tpl ON tpl.TemplateId = ik.TemplateId
  LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = ik.StatusValueId
  LEFT JOIN ppm.Projects p ON p.ProjectId = ik.ProjectId
`;

async function handleList(pool, request) {
  const status = request.query.get('status');
  const req = pool.request();
  let query = SELECT_LIST;
  if (status) { query += ' WHERE sv.ValueCode = @status'; req.input('status', sql.NVarChar, status); }
  query += ' ORDER BY ik.CreatedDate DESC;';
  const result = await req.query(query);
  return { jsonBody: { success: true, count: result.recordset.length, intakes: result.recordset } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_LIST} WHERE ik.IntakeId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Intake ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return { jsonBody: { success: true, intake: result.recordset[0] } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const {
    requestTitle, businessNeed, sponsorName, requestedByName, businessUnitCode,
    projectTypeCode, projectCategoryCode, priorityCode, templateCode, statusCode,
    requestedDate, description, notes,
  } = body || {};

  if (!requestTitle) {
    const err = new Error('requestTitle is required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const code = await generateCode(transaction, 'Intake');

    let businessUnitId = null;
    if (businessUnitCode) {
      const bu = await new sql.Request(transaction).input('code', sql.NVarChar, businessUnitCode)
        .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code');
      if (bu.recordset.length === 0) {
        const err = new Error(`Business Unit "${businessUnitCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      businessUnitId = bu.recordset[0].BusinessUnitId;
    }

    let templateId = null;
    if (templateCode) {
      const tpl = await new sql.Request(transaction).input('code', sql.NVarChar, templateCode)
        .query('SELECT TemplateId FROM ppm.ProjectTemplates WHERE TemplateCode = @code');
      if (tpl.recordset.length === 0) {
        const err = new Error(`Template "${templateCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      templateId = tpl.recordset[0].TemplateId;
    }

    const typeId = projectTypeCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectType', projectTypeCode) : null;
    const categoryId = projectCategoryCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectCategory', projectCategoryCode) : null;
    const priorityId = priorityCode ? await lookupConfigValueId(new sql.Request(transaction), 'ProjectPriority', priorityCode) : null;
    const statusId = statusCode
      ? await lookupConfigValueId(new sql.Request(transaction), 'IntakeStatus', statusCode)
      : await lookupDefaultStatusId(new sql.Request(transaction), 'IntakeStatus');

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('title', sql.NVarChar, requestTitle)
      .input('need', sql.NVarChar, businessNeed ?? null)
      .input('sponsor', sql.NVarChar, sponsorName ?? null)
      .input('requestedBy', sql.NVarChar, requestedByName ?? null)
      .input('buId', sql.Int, businessUnitId)
      .input('typeId', sql.Int, typeId)
      .input('categoryId', sql.Int, categoryId)
      .input('priorityId', sql.Int, priorityId)
      .input('templateId', sql.Int, templateId)
      .input('statusId', sql.Int, statusId)
      .input('requestedDate', sql.Date, requestedDate ?? null)
      .input('description', sql.NVarChar, description ?? null)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.ProjectIntakes (
          IntakeCode, RequestTitle, BusinessNeed, SponsorName, RequestedByName, BusinessUnitId,
          ProjectTypeValueId, ProjectCategoryValueId, PriorityValueId, TemplateId, StatusValueId,
          RequestedDate, Description, Notes
        )
        OUTPUT INSERTED.IntakeId
        VALUES (
          @code, @title, @need, @sponsor, @requestedBy, @buId,
          @typeId, @categoryId, @priorityId, @templateId, @statusId,
          @requestedDate, @description, @notes
        );
      `);

    await transaction.commit();
    return await handleGetOne(pool, result.recordset[0].IntakeId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.ProjectIntakes WHERE IntakeId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Intake ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  if (row.ProjectId) {
    const err = new Error(`Intake ${id} has already been converted to Project - it is now read-only. Edit the Project directly instead.`);
    err.category = 'VALIDATION';
    throw err;
  }

  async function resolveCode(field, current, lookupFn, ...args) {
    if (body[field] === undefined) return current;
    if (body[field] === null) return null;
    return await lookupFn(pool.request(), ...args, body[field]);
  }

  let businessUnitId = row.BusinessUnitId;
  if (body.businessUnitCode !== undefined) {
    businessUnitId = body.businessUnitCode === null ? null : (await pool.request().input('code', sql.NVarChar, body.businessUnitCode)
      .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code')).recordset[0]?.BusinessUnitId;
  }
  let templateId = row.TemplateId;
  if (body.templateCode !== undefined) {
    templateId = body.templateCode === null ? null : (await pool.request().input('code', sql.NVarChar, body.templateCode)
      .query('SELECT TemplateId FROM ppm.ProjectTemplates WHERE TemplateCode = @code')).recordset[0]?.TemplateId;
  }

  const typeId = await resolveCode('projectTypeCode', row.ProjectTypeValueId, lookupConfigValueId, 'ProjectType');
  const categoryId = await resolveCode('projectCategoryCode', row.ProjectCategoryValueId, lookupConfigValueId, 'ProjectCategory');
  const priorityId = await resolveCode('priorityCode', row.PriorityValueId, lookupConfigValueId, 'ProjectPriority');
  const statusId = await resolveCode('statusCode', row.StatusValueId, lookupConfigValueId, 'IntakeStatus');

  await pool.request()
    .input('id', sql.Int, id)
    .input('title', sql.NVarChar, body.requestTitle ?? row.RequestTitle)
    .input('need', sql.NVarChar, body.businessNeed ?? row.BusinessNeed)
    .input('sponsor', sql.NVarChar, body.sponsorName ?? row.SponsorName)
    .input('requestedBy', sql.NVarChar, body.requestedByName ?? row.RequestedByName)
    .input('buId', sql.Int, businessUnitId)
    .input('typeId', sql.Int, typeId)
    .input('categoryId', sql.Int, categoryId)
    .input('priorityId', sql.Int, priorityId)
    .input('templateId', sql.Int, templateId)
    .input('statusId', sql.Int, statusId)
    .input('requestedDate', sql.Date, body.requestedDate ?? row.RequestedDate)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ProjectIntakes
      SET RequestTitle = @title, BusinessNeed = @need, SponsorName = @sponsor, RequestedByName = @requestedBy,
          BusinessUnitId = @buId, ProjectTypeValueId = @typeId, ProjectCategoryValueId = @categoryId,
          PriorityValueId = @priorityId, TemplateId = @templateId, StatusValueId = @statusId,
          RequestedDate = @requestedDate, Description = @description, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE IntakeId = @id;
    `);

  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT IntakeId FROM ppm.ProjectIntakes WHERE IntakeId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Intake ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.ProjectIntakes SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE IntakeId = @id;
  `);
  return { jsonBody: { success: true, message: `Intake ${id} archived.` } };
}

async function handleConvert(pool, id, request) {
  const body = await request.json();
  const { portfolioCode, programCode, projectName, projectManagerName } = body || {};
  if (!portfolioCode) {
    const err = new Error('portfolioCode is required to convert an intake into a project.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const intakeResult = await new sql.Request(transaction).input('id', sql.Int, id)
      .query('SELECT * FROM ppm.ProjectIntakes WHERE IntakeId = @id');
    if (intakeResult.recordset.length === 0) {
      const err = new Error(`Intake ${id} not found.`);
      err.category = 'NOT_FOUND';
      throw err;
    }
    const intake = intakeResult.recordset[0];
    if (intake.ProjectId) {
      const err = new Error(`Intake ${id} was already converted to project ${intake.ProjectId}.`);
      err.category = 'ALREADY_CONVERTED';
      throw err;
    }

    const portfolioId = await lookupPortfolioId(new sql.Request(transaction), portfolioCode);
    const programId = programCode ? await lookupProgramId(new sql.Request(transaction), programCode) : null;
    const projectCode = await generateCode(transaction, 'Project');
    const convertedStatusId = await lookupConfigValueId(new sql.Request(transaction), 'IntakeStatus', 'CONVERTED');

    const projectResult = await new sql.Request(transaction)
      .input('code', sql.NVarChar, projectCode)
      .input('name', sql.NVarChar, projectName || intake.RequestTitle)
      .input('pfId', sql.Int, portfolioId)
      .input('pgId', sql.Int, programId)
      .input('pm', sql.NVarChar, projectManagerName ?? null)
      .input('typeId', sql.Int, intake.ProjectTypeValueId)
      .input('categoryId', sql.Int, intake.ProjectCategoryValueId)
      .input('priorityId', sql.Int, intake.PriorityValueId)
      .input('templateId', sql.Int, intake.TemplateId)
      .input('description', sql.NVarChar, intake.Description)
      .query(`
        INSERT INTO ppm.Projects (
          ProjectCode, ProjectName, PortfolioId, ProgramId, ProjectManagerName,
          ProjectTypeValueId, ProjectCategoryValueId, ProjectPriorityValueId, TemplateId, Description
        )
        OUTPUT INSERTED.ProjectId
        VALUES (@code, @name, @pfId, @pgId, @pm, @typeId, @categoryId, @priorityId, @templateId, @description);
      `);
    const newProjectId = projectResult.recordset[0].ProjectId;

    await new sql.Request(transaction)
      .input('id', sql.Int, id)
      .input('projectId', sql.Int, newProjectId)
      .input('statusId', sql.Int, convertedStatusId)
      .query(`
        UPDATE ppm.ProjectIntakes
        SET ProjectId = @projectId, StatusValueId = @statusId,
            UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
        WHERE IntakeId = @id;
      `);

    await transaction.commit();
    return await handleGetOne(pool, id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

app.http('intakes', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/intakes/{id?}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;
      const action = request.params.action;

      if (request.method === 'POST' && id && action === 'convert') return await handleConvert(pool, id, request);
      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool, request);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Intakes API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' || safe.error === 'ALREADY_CONVERTED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Intake request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

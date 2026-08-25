const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/resources/{id?}/{sub?}/{subId?}
//
// GET    (no id)     -> list resources (joined with Business Unit,
//           Type, Role labels)
// GET    /{id}         -> single resource, with nested active skills
// POST                    -> create (auto-generates ResourceCode from
//           cfg.NumberingRules, EntityType='Resource', same
//           transactional pattern as every other entity - D012)
// PUT    /{id}             -> update
// DELETE /{id}               -> archive (IsActive = 0, never a hard delete)
// GET    /{id}/utilization     -> Module 19 (Capacity & Utilization) -
//           NOT a stored table (see DECISIONS.md D018). Sums this
//           resource's active allocations' Planned and Actual
//           percentages across all projects and compares against
//           DefaultCapacityHoursPerWeek, expressed as a percent of
//           capacity so it can flag over-allocation regardless of
//           the resource's specific hours/week.
// POST   /{id}/skills           -> add a skill (skillCode required,
//           proficiencyCode optional)
// PUT    /{id}/skills/{skillId}   -> update proficiency/notes
// DELETE /{id}/skills/{skillId}     -> remove (soft-delete) a skill

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
  if (/Invalid object name.*ppm\.Resources/i.test(err.message || '') || /Invalid object name.*ResourceSkills/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.Resources / ppm.ResourceSkills do not exist yet. Run migration 010_resource_rmg.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '') || /UQ_ResourceSkills_ActiveSkillPerResource/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A resource with this code already exists, or this resource already has this skill active.' };
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

const SELECT_LIST = `
  SELECT r.*, bu.BusinessUnitCode, bu.BusinessUnitName,
         tv.ValueCode AS ResourceTypeCode, tv.ValueLabel AS ResourceTypeLabel,
         rv.ValueCode AS ResourceRoleCode, rv.ValueLabel AS ResourceRoleLabel
  FROM ppm.Resources r
  LEFT JOIN org.BusinessUnits bu ON bu.BusinessUnitId = r.BusinessUnitId
  LEFT JOIN cfg.ConfigValues tv ON tv.ConfigValueId = r.ResourceTypeValueId
  LEFT JOIN cfg.ConfigValues rv ON rv.ConfigValueId = r.ResourceRoleValueId
`;

async function attachSkills(pool, resources) {
  if (resources.length === 0) return resources;
  const ids = resources.map((r) => r.ResourceId);
  const result = await pool.request().query(`
    SELECT rs.*, sv.ValueCode AS SkillCode, sv.ValueLabel AS SkillLabel,
           pv.ValueCode AS ProficiencyCode, pv.ValueLabel AS ProficiencyLabel
    FROM ppm.ResourceSkills rs
    LEFT JOIN cfg.ConfigValues sv ON sv.ConfigValueId = rs.SkillValueId
    LEFT JOIN cfg.ConfigValues pv ON pv.ConfigValueId = rs.ProficiencyLevelValueId
    WHERE rs.ResourceId IN (${ids.join(',')}) AND rs.IsActive = 1;
  `);
  return resources.map((r) => ({ ...r, skills: result.recordset.filter((s) => s.ResourceId === r.ResourceId) }));
}

async function handleList(pool) {
  const result = await pool.request().query(`${SELECT_LIST} ORDER BY r.ResourceName;`);
  const withSkills = await attachSkills(pool, result.recordset);
  return { jsonBody: { success: true, count: withSkills.length, resources: withSkills } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_LIST} WHERE r.ResourceId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Resource ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const [withSkills] = await attachSkills(pool, result.recordset);
  return { jsonBody: { success: true, resource: withSkills } };
}

async function handleCreate(pool, request) {
  const body = await request.json();
  const { name, email, businessUnitCode, resourceTypeCode, resourceRoleCode, defaultCapacityHoursPerWeek, notes } = body || {};
  if (!name) {
    const err = new Error('name is required.');
    err.category = 'VALIDATION';
    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const code = await generateCode(transaction, 'Resource');

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

    const typeId = resourceTypeCode ? await lookupConfigValueId(new sql.Request(transaction), 'ResourceType', resourceTypeCode) : null;
    const roleId = resourceRoleCode ? await lookupConfigValueId(new sql.Request(transaction), 'ResourceRole', resourceRoleCode) : null;

    const result = await new sql.Request(transaction)
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email ?? null)
      .input('buId', sql.Int, businessUnitId)
      .input('typeId', sql.Int, typeId)
      .input('roleId', sql.Int, roleId)
      .input('capacity', sql.Decimal(5, 2), defaultCapacityHoursPerWeek ?? 40)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ppm.Resources (ResourceCode, ResourceName, Email, BusinessUnitId, ResourceTypeValueId, ResourceRoleValueId, DefaultCapacityHoursPerWeek, Notes)
        OUTPUT INSERTED.ResourceId
        VALUES (@code, @name, @email, @buId, @typeId, @roleId, @capacity, @notes);
      `);

    await transaction.commit();
    return await handleGetOne(pool, result.recordset[0].ResourceId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.Resources WHERE ResourceId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Resource ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  let businessUnitId = row.BusinessUnitId;
  if (body.businessUnitCode !== undefined) {
    if (body.businessUnitCode === null) {
      businessUnitId = null;
    } else {
      const bu = await pool.request().input('code', sql.NVarChar, body.businessUnitCode)
        .query('SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = @code');
      if (bu.recordset.length === 0) {
        const err = new Error(`Business Unit "${body.businessUnitCode}" does not exist.`);
        err.category = 'NOT_FOUND';
        throw err;
      }
      businessUnitId = bu.recordset[0].BusinessUnitId;
    }
  }

  const typeId = body.resourceTypeCode !== undefined
    ? (body.resourceTypeCode === null ? null : await lookupConfigValueId(pool.request(), 'ResourceType', body.resourceTypeCode))
    : row.ResourceTypeValueId;
  const roleId = body.resourceRoleCode !== undefined
    ? (body.resourceRoleCode === null ? null : await lookupConfigValueId(pool.request(), 'ResourceRole', body.resourceRoleCode))
    : row.ResourceRoleValueId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.name ?? row.ResourceName)
    .input('email', sql.NVarChar, body.email ?? row.Email)
    .input('buId', sql.Int, businessUnitId)
    .input('typeId', sql.Int, typeId)
    .input('roleId', sql.Int, roleId)
    .input('capacity', sql.Decimal(5, 2), body.defaultCapacityHoursPerWeek ?? row.DefaultCapacityHoursPerWeek)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.Resources
      SET ResourceName = @name, Email = @email, BusinessUnitId = @buId, ResourceTypeValueId = @typeId,
          ResourceRoleValueId = @roleId, DefaultCapacityHoursPerWeek = @capacity, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ResourceId = @id;
    `);

  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT ResourceId FROM ppm.Resources WHERE ResourceId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Resource ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.Resources SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ResourceId = @id;
  `);
  return { jsonBody: { success: true, message: `Resource ${id} archived.` } };
}

// Module 19 - Capacity & Utilization. No stored table (D018): sums
// this resource's active allocations across all projects and
// expresses the total as a percent of the resource's own capacity,
// so "100" always means fully booked regardless of hours/week.
async function handleUtilization(pool, id) {
  const resource = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.Resources WHERE ResourceId = @id');
  if (resource.recordset.length === 0) {
    const err = new Error(`Resource ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const allocations = await pool.request().input('id', sql.Int, id).query(`
    SELECT ra.*, p.ProjectCode, p.ProjectName
    FROM ppm.ResourceAllocations ra
    JOIN ppm.Projects p ON p.ProjectId = ra.ProjectId
    WHERE ra.ResourceId = @id AND ra.IsActive = 1;
  `);
  const totalPlanned = allocations.recordset.reduce((sum, a) => sum + Number(a.PlannedAllocationPercent || 0), 0);
  const totalActual = allocations.recordset.reduce((sum, a) => sum + Number(a.ActualAllocationPercent || 0), 0);

  return {
    jsonBody: {
      success: true,
      utilization: {
        resourceId: id,
        defaultCapacityHoursPerWeek: resource.recordset[0].DefaultCapacityHoursPerWeek,
        totalPlannedPercent: totalPlanned,
        totalActualPercent: totalActual,
        isOverAllocatedPlanned: totalPlanned > 100,
        isOverAllocatedActual: totalActual > 100,
        allocations: allocations.recordset,
      },
    },
  };
}

// ---- Skills sub-routes ----

async function handleAddSkill(pool, resourceId, request) {
  const existing = await pool.request().input('id', sql.Int, resourceId).query('SELECT ResourceId FROM ppm.Resources WHERE ResourceId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Resource ${resourceId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const body = await request.json();
  const { skillCode, proficiencyCode, notes } = body || {};
  if (!skillCode) {
    const err = new Error('skillCode is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const skillId = await lookupConfigValueId(pool.request(), 'Skill', skillCode);
  const proficiencyId = proficiencyCode ? await lookupConfigValueId(pool.request(), 'SkillProficiencyLevel', proficiencyCode) : null;

  const result = await pool.request()
    .input('resourceId', sql.Int, resourceId)
    .input('skillId', sql.Int, skillId)
    .input('proficiencyId', sql.Int, proficiencyId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ResourceSkills (ResourceId, SkillValueId, ProficiencyLevelValueId, Notes)
      OUTPUT INSERTED.ResourceSkillId
      VALUES (@resourceId, @skillId, @proficiencyId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, resourceSkillId: result.recordset[0].ResourceSkillId } };
}

async function handleUpdateSkill(pool, skillRowId, request) {
  const existing = await pool.request().input('id', sql.Int, skillRowId).query('SELECT * FROM ppm.ResourceSkills WHERE ResourceSkillId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Resource skill ${skillRowId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();
  const proficiencyId = body.proficiencyCode !== undefined
    ? (body.proficiencyCode === null ? null : await lookupConfigValueId(pool.request(), 'SkillProficiencyLevel', body.proficiencyCode))
    : row.ProficiencyLevelValueId;

  await pool.request()
    .input('id', sql.Int, skillRowId)
    .input('proficiencyId', sql.Int, proficiencyId)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ResourceSkills SET ProficiencyLevelValueId = @proficiencyId, Notes = @notes,
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ResourceSkillId = @id;
    `);
  return { jsonBody: { success: true, message: `Resource skill ${skillRowId} updated.` } };
}

async function handleRemoveSkill(pool, skillRowId) {
  const existing = await pool.request().input('id', sql.Int, skillRowId).query('SELECT ResourceSkillId FROM ppm.ResourceSkills WHERE ResourceSkillId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Resource skill ${skillRowId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, skillRowId).query(`
    UPDATE ppm.ResourceSkills SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ResourceSkillId = @id;
  `);
  return { jsonBody: { success: true, message: `Resource skill ${skillRowId} removed.` } };
}

app.http('resources', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/resources/{id?}/{sub?}/{subId?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id && request.params.id !== 'undefined' ? Number(request.params.id) : null;
      const sub = request.params.sub;
      const subId = request.params.subId ? Number(request.params.subId) : null;

      if (sub === 'utilization' && request.method === 'GET') return await handleUtilization(pool, id);

      if (sub === 'skills') {
        if (request.method === 'POST' && id) return await handleAddSkill(pool, id, request);
        if (request.method === 'PUT' && subId) return await handleUpdateSkill(pool, subId, request);
        if (request.method === 'DELETE' && subId) return await handleRemoveSkill(pool, subId);
        return { status: 400, jsonBody: { success: false, message: 'Invalid skills sub-route request.' } };
      }

      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Resources API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Resource request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

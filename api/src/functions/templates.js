const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/templates/{id?}/{sub?}/{subId?}
// GET  (no id)     -> list templates, each with its Process Matrix items nested
// GET  /{id}        -> single template with items
// POST              -> create a template (TemplateCode is user-entered, like cfg.Lifecycles)
// PUT  /{id}         -> update template-level fields
// DELETE /{id}        -> soft-delete the template (does not touch its items' IsActive)
// POST /{id}/items     -> add a Process Matrix item to a template
// PUT  /{id}/items/{itemId} -> update an item
// DELETE /{id}/items/{itemId} -> soft-delete an item

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
  if (/Invalid object name.*ProjectTemplates/i.test(err.message || '') || /Invalid object name.*ProcessMatrixItems/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ProjectTemplates / ppm.ProcessMatrixItems do not exist yet. Run migration 008_intake_charter_templates.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'DUPLICATE_CODE', detail: 'A template with this code already exists.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

const SELECT_TEMPLATE = `
  SELECT tpl.*, tv.ValueCode AS ProjectTypeCode, tv.ValueLabel AS ProjectTypeLabel,
         lc.LifecycleCode, lc.LifecycleName
  FROM ppm.ProjectTemplates tpl
  LEFT JOIN cfg.ConfigValues tv ON tv.ConfigValueId = tpl.ProjectTypeValueId
  LEFT JOIN cfg.Lifecycles lc ON lc.LifecycleId = tpl.LifecycleId
`;

async function attachItems(pool, templates) {
  if (templates.length === 0) return templates;
  const ids = templates.map((t) => t.TemplateId);
  const result = await pool.request().query(
    `SELECT * FROM ppm.ProcessMatrixItems WHERE TemplateId IN (${ids.join(',')}) ORDER BY SequenceOrder;`
  );
  return templates.map((t) => ({ ...t, items: result.recordset.filter((i) => i.TemplateId === t.TemplateId) }));
}

async function handleList(pool) {
  const result = await pool.request().query(`${SELECT_TEMPLATE} ORDER BY tpl.TemplateName;`);
  const withItems = await attachItems(pool, result.recordset);
  return { jsonBody: { success: true, count: withItems.length, templates: withItems } };
}

async function handleGetOne(pool, id) {
  const result = await pool.request().input('id', sql.Int, id).query(`${SELECT_TEMPLATE} WHERE tpl.TemplateId = @id;`);
  if (result.recordset.length === 0) {
    const err = new Error(`Template ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const [withItems] = await attachItems(pool, result.recordset);
  return { jsonBody: { success: true, template: withItems } };
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

async function handleCreate(pool, request) {
  const body = await request.json();
  const { templateCode, name, projectTypeCode, lifecycleCode, description, notes } = body || {};
  if (!templateCode || !name) {
    const err = new Error('templateCode and name are required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const typeId = projectTypeCode ? await lookupConfigValueId(pool.request(), 'ProjectType', projectTypeCode) : null;
  const lifecycleId = lifecycleCode ? await lookupLifecycleId(pool.request(), lifecycleCode) : null;

  const result = await pool.request()
    .input('code', sql.NVarChar, templateCode)
    .input('name', sql.NVarChar, name)
    .input('typeId', sql.Int, typeId)
    .input('lifecycleId', sql.Int, lifecycleId)
    .input('description', sql.NVarChar, description ?? null)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ProjectTemplates (TemplateCode, TemplateName, ProjectTypeValueId, LifecycleId, Description, Notes)
      OUTPUT INSERTED.TemplateId
      VALUES (@code, @name, @typeId, @lifecycleId, @description, @notes);
    `);
  return await handleGetOne(pool, result.recordset[0].TemplateId);
}

async function handleUpdate(pool, id, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT * FROM ppm.ProjectTemplates WHERE TemplateId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Template ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];

  const typeId = body.projectTypeCode !== undefined
    ? (body.projectTypeCode === null ? null : await lookupConfigValueId(pool.request(), 'ProjectType', body.projectTypeCode))
    : row.ProjectTypeValueId;
  const lifecycleId = body.lifecycleCode !== undefined
    ? (body.lifecycleCode === null ? null : await lookupLifecycleId(pool.request(), body.lifecycleCode))
    : row.LifecycleId;

  await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar, body.name ?? row.TemplateName)
    .input('typeId', sql.Int, typeId)
    .input('lifecycleId', sql.Int, lifecycleId)
    .input('description', sql.NVarChar, body.description ?? row.Description)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ProjectTemplates
      SET TemplateName = @name, ProjectTypeValueId = @typeId, LifecycleId = @lifecycleId,
          Description = @description, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE TemplateId = @id;
    `);
  return await handleGetOne(pool, id);
}

async function handleArchive(pool, id) {
  const existing = await pool.request().input('id', sql.Int, id).query('SELECT TemplateId FROM ppm.ProjectTemplates WHERE TemplateId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Template ${id} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, id).query(`
    UPDATE ppm.ProjectTemplates SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE TemplateId = @id;
  `);
  return { jsonBody: { success: true, message: `Template ${id} archived.` } };
}

// ---- Process Matrix item sub-routes ----

async function handleAddItem(pool, templateId, request) {
  const body = await request.json();
  const { itemName, sequenceOrder, isRequired } = body || {};
  if (!itemName) {
    const err = new Error('itemName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  const tpl = await pool.request().input('id', sql.Int, templateId).query('SELECT TemplateId FROM ppm.ProjectTemplates WHERE TemplateId = @id');
  if (tpl.recordset.length === 0) {
    const err = new Error(`Template ${templateId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const result = await pool.request()
    .input('templateId', sql.Int, templateId)
    .input('itemName', sql.NVarChar, itemName)
    .input('sequenceOrder', sql.Int, sequenceOrder ?? 0)
    .input('isRequired', sql.Bit, isRequired ?? true)
    .query(`
      INSERT INTO ppm.ProcessMatrixItems (TemplateId, ItemName, SequenceOrder, IsRequired)
      OUTPUT INSERTED.*
      VALUES (@templateId, @itemName, @sequenceOrder, @isRequired);
    `);
  return { status: 201, jsonBody: { success: true, item: result.recordset[0] } };
}

async function handleUpdateItem(pool, itemId, request) {
  const body = await request.json();
  const existing = await pool.request().input('id', sql.Int, itemId).query('SELECT * FROM ppm.ProcessMatrixItems WHERE ProcessMatrixItemId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Process Matrix item ${itemId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const result = await pool.request()
    .input('id', sql.Int, itemId)
    .input('itemName', sql.NVarChar, body.itemName ?? row.ItemName)
    .input('sequenceOrder', sql.Int, body.sequenceOrder ?? row.SequenceOrder)
    .input('isRequired', sql.Bit, body.isRequired ?? row.IsRequired)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ProcessMatrixItems
      SET ItemName = @itemName, SequenceOrder = @sequenceOrder, IsRequired = @isRequired,
          IsActive = @isActive, Notes = @notes, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      OUTPUT INSERTED.*
      WHERE ProcessMatrixItemId = @id;
    `);
  return { jsonBody: { success: true, item: result.recordset[0] } };
}

async function handleDeleteItem(pool, itemId) {
  const existing = await pool.request().input('id', sql.Int, itemId).query('SELECT ProcessMatrixItemId FROM ppm.ProcessMatrixItems WHERE ProcessMatrixItemId = @id');
  if (existing.recordset.length === 0) {
    const err = new Error(`Process Matrix item ${itemId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  await pool.request().input('id', sql.Int, itemId).query(`
    UPDATE ppm.ProcessMatrixItems SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE ProcessMatrixItemId = @id;
  `);
  return { jsonBody: { success: true, message: `Process Matrix item ${itemId} removed.` } };
}

app.http('templates', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/templates/{id?}/{sub?}/{subId?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const id = request.params.id ? Number(request.params.id) : null;
      const sub = request.params.sub; // 'items' or undefined
      const subId = request.params.subId ? Number(request.params.subId) : null;

      if (sub === 'items') {
        if (request.method === 'POST' && id) return await handleAddItem(pool, id, request);
        if (request.method === 'PUT' && subId) return await handleUpdateItem(pool, subId, request);
        if (request.method === 'DELETE' && subId) return await handleDeleteItem(pool, subId);
        return { status: 400, jsonBody: { success: false, message: 'Invalid items sub-route request.' } };
      }

      if (request.method === 'GET' && id) return await handleGetOne(pool, id);
      if (request.method === 'GET') return await handleList(pool);
      if (request.method === 'POST') return await handleCreate(pool, request);
      if (request.method === 'PUT' && id) return await handleUpdate(pool, id, request);
      if (request.method === 'DELETE' && id) return await handleArchive(pool, id);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request. PUT and DELETE require an /{id}.' } };
    } catch (err) {
      context.error('Templates API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Template request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

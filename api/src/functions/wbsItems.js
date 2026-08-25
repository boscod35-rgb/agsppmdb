const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/wbs/{projectId}/{itemId?}/{action?}
//
// GET    /{projectId} -> flat list of all WBS items for the project
//           (client nests them into a tree via ParentWbsItemId - see
//           TABLE_WBS_TREE in WbsPage.jsx)
// POST   /{projectId} -> add an item (itemName required; parentWbsItemId,
//           pathTypeCode, notes optional). New items land at the end
//           of their parent's sibling list (SequenceOrder = max + 1).
// PUT    /{projectId}/{itemId} -> update name/pathTypeCode/notes
// DELETE /{projectId}/{itemId} -> archive (also archives descendants,
//           since a parent disappearing but its children staying
//           visible would be confusing)
// POST   /{projectId}/{itemId}/toggle -> flip IsComplete
// POST   /{projectId}/{itemId}/move-up -> swap SequenceOrder with the
//           previous sibling (same ParentWbsItemId)
// POST   /{projectId}/{itemId}/move-down -> swap SequenceOrder with
//           the next sibling
// POST   /{projectId}/generate-from-template -> reads the project's
//           TemplateId (set at creation - Chunk 04) and instantiates
//           its active ppm.ProcessMatrixItems as top-level WBS items,
//           in SequenceOrder. Closes the "template-to-project
//           generation" loop deferred in Chunk 04 (see DECISIONS.md
//           D015). Fails if the project has no Template, or already
//           has WBS items (never silently duplicates).

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
  if (/Invalid object name.*WbsItems/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.WbsItems does not exist yet. Run migration 009_wbs_schedule_delivery.sql.' };
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
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId, TemplateId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

const SELECT_LIST = `
  SELECT w.*, pt.ValueCode AS PathTypeCode, pt.ValueLabel AS PathTypeLabel
  FROM ppm.WbsItems w
  LEFT JOIN cfg.ConfigValues pt ON pt.ConfigValueId = w.PathTypeValueId
`;

async function handleList(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const result = await pool.request().input('projectId', sql.Int, projectId)
    .query(`${SELECT_LIST} WHERE w.ProjectId = @projectId AND w.IsActive = 1 ORDER BY w.ParentWbsItemId, w.SequenceOrder;`);
  return { jsonBody: { success: true, count: result.recordset.length, items: result.recordset } };
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const body = await request.json();
  const { itemName, parentWbsItemId, pathTypeCode, notes } = body || {};
  if (!itemName) {
    const err = new Error('itemName is required.');
    err.category = 'VALIDATION';
    throw err;
  }
  if (parentWbsItemId) {
    const parent = await pool.request().input('id', sql.Int, parentWbsItemId).input('projectId', sql.Int, projectId)
      .query('SELECT WbsItemId FROM ppm.WbsItems WHERE WbsItemId = @id AND ProjectId = @projectId AND IsActive = 1');
    if (parent.recordset.length === 0) {
      const err = new Error(`Parent WBS item ${parentWbsItemId} not found on project ${projectId}.`);
      err.category = 'NOT_FOUND';
      throw err;
    }
  }
  const pathTypeId = pathTypeCode ? await lookupConfigValueId(pool.request(), 'WbsPathType', pathTypeCode) : null;

  const maxSeq = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('parentId', sql.Int, parentWbsItemId ?? null)
    .query(`
      SELECT ISNULL(MAX(SequenceOrder), 0) AS MaxSeq FROM ppm.WbsItems
      WHERE ProjectId = @projectId AND ((@parentId IS NULL AND ParentWbsItemId IS NULL) OR ParentWbsItemId = @parentId) AND IsActive = 1;
    `);
  const nextSeq = (maxSeq.recordset[0].MaxSeq || 0) + 1;

  const result = await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('parentId', sql.Int, parentWbsItemId ?? null)
    .input('itemName', sql.NVarChar, itemName)
    .input('sequenceOrder', sql.Int, nextSeq)
    .input('pathTypeId', sql.Int, pathTypeId)
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.WbsItems (ProjectId, ParentWbsItemId, ItemName, SequenceOrder, PathTypeValueId, Notes)
      OUTPUT INSERTED.WbsItemId
      VALUES (@projectId, @parentId, @itemName, @sequenceOrder, @pathTypeId, @notes);
    `);
  return { status: 201, jsonBody: { success: true, itemId: result.recordset[0].WbsItemId } };
}

async function getItem(pool, itemId, projectId) {
  const result = await pool.request().input('id', sql.Int, itemId).input('projectId', sql.Int, projectId)
    .query('SELECT * FROM ppm.WbsItems WHERE WbsItemId = @id AND ProjectId = @projectId');
  if (result.recordset.length === 0) {
    const err = new Error(`WBS item ${itemId} not found on project ${projectId}.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  return result.recordset[0];
}

async function handleUpdate(pool, projectId, itemId, request) {
  const row = await getItem(pool, itemId, projectId);
  const body = await request.json();
  const pathTypeId = body.pathTypeCode !== undefined
    ? (body.pathTypeCode === null ? null : await lookupConfigValueId(pool.request(), 'WbsPathType', body.pathTypeCode))
    : row.PathTypeValueId;

  await pool.request()
    .input('id', sql.Int, itemId)
    .input('itemName', sql.NVarChar, body.itemName ?? row.ItemName)
    .input('pathTypeId', sql.Int, pathTypeId)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.WbsItems SET ItemName = @itemName, PathTypeValueId = @pathTypeId, Notes = @notes,
        UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE WbsItemId = @id;
    `);
  return { jsonBody: { success: true, message: `WBS item ${itemId} updated.` } };
}

async function handleArchive(pool, projectId, itemId) {
  await getItem(pool, itemId, projectId);
  // Archive the item and all descendants (recursive CTE) so a
  // vanished parent never leaves orphaned-looking children visible.
  await pool.request().input('id', sql.Int, itemId).query(`
    WITH Descendants AS (
      SELECT WbsItemId FROM ppm.WbsItems WHERE WbsItemId = @id
      UNION ALL
      SELECT w.WbsItemId FROM ppm.WbsItems w JOIN Descendants d ON w.ParentWbsItemId = d.WbsItemId
    )
    UPDATE ppm.WbsItems SET IsActive = 0, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE WbsItemId IN (SELECT WbsItemId FROM Descendants);
  `);
  return { jsonBody: { success: true, message: `WBS item ${itemId} and its descendants archived.` } };
}

async function handleToggle(pool, projectId, itemId) {
  const row = await getItem(pool, itemId, projectId);
  await pool.request().input('id', sql.Int, itemId).input('val', sql.Bit, !row.IsComplete).query(`
    UPDATE ppm.WbsItems SET IsComplete = @val, UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
    WHERE WbsItemId = @id;
  `);
  return { jsonBody: { success: true, isComplete: !row.IsComplete } };
}

async function handleMove(pool, projectId, itemId, direction) {
  const row = await getItem(pool, itemId, projectId);
  const siblingsReq = pool.request().input('projectId', sql.Int, projectId).input('parentId', sql.Int, row.ParentWbsItemId);
  const siblings = await siblingsReq.query(`
    SELECT WbsItemId, SequenceOrder FROM ppm.WbsItems
    WHERE ProjectId = @projectId AND IsActive = 1
      AND ((@parentId IS NULL AND ParentWbsItemId IS NULL) OR ParentWbsItemId = @parentId)
    ORDER BY SequenceOrder;
  `);
  const list = siblings.recordset;
  const idx = list.findIndex((s) => s.WbsItemId === itemId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= list.length) {
    return { jsonBody: { success: true, message: 'Already at the edge - nothing to move.' } };
  }
  const a = list[idx];
  const b = list[swapIdx];
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input('id', sql.Int, a.WbsItemId).input('seq', sql.Int, b.SequenceOrder)
      .query('UPDATE ppm.WbsItems SET SequenceOrder = @seq WHERE WbsItemId = @id');
    await new sql.Request(transaction).input('id', sql.Int, b.WbsItemId).input('seq', sql.Int, a.SequenceOrder)
      .query('UPDATE ppm.WbsItems SET SequenceOrder = @seq WHERE WbsItemId = @id');
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return { jsonBody: { success: true, message: 'Moved.' } };
}

async function handleGenerateFromTemplate(pool, projectId) {
  const project = await assertProjectExists(pool.request(), projectId);
  if (!project.TemplateId) {
    const err = new Error(`Project ${projectId} has no Template assigned - nothing to generate from.`);
    err.category = 'VALIDATION';
    throw err;
  }
  const existing = await pool.request().input('projectId', sql.Int, projectId)
    .query('SELECT COUNT(*) AS Cnt FROM ppm.WbsItems WHERE ProjectId = @projectId AND IsActive = 1');
  if (existing.recordset[0].Cnt > 0) {
    const err = new Error(`Project ${projectId} already has WBS items - generate-from-template only runs on an empty WBS, to avoid duplicating items.`);
    err.category = 'VALIDATION';
    throw err;
  }

  const items = await pool.request().input('templateId', sql.Int, project.TemplateId)
    .query('SELECT * FROM ppm.ProcessMatrixItems WHERE TemplateId = @templateId AND IsActive = 1 ORDER BY SequenceOrder');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of items.recordset) {
      await new sql.Request(transaction)
        .input('projectId', sql.Int, projectId)
        .input('itemName', sql.NVarChar, item.ItemName)
        .input('sequenceOrder', sql.Int, item.SequenceOrder)
        .query(`
          INSERT INTO ppm.WbsItems (ProjectId, ParentWbsItemId, ItemName, SequenceOrder)
          VALUES (@projectId, NULL, @itemName, @sequenceOrder);
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return { jsonBody: { success: true, message: `Generated ${items.recordset.length} WBS items from template.`, count: items.recordset.length } };
}

app.http('wbs', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'ppm/wbs/{projectId}/{itemId?}/{action?}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);
      const itemId = request.params.itemId && request.params.itemId !== 'generate-from-template' ? Number(request.params.itemId) : null;
      const action = request.params.itemId === 'generate-from-template' ? 'generate-from-template' : request.params.action;

      if (request.method === 'POST' && action === 'generate-from-template') return await handleGenerateFromTemplate(pool, projectId);
      if (request.method === 'POST' && itemId && action === 'toggle') return await handleToggle(pool, projectId, itemId);
      if (request.method === 'POST' && itemId && action === 'move-up') return await handleMove(pool, projectId, itemId, 'up');
      if (request.method === 'POST' && itemId && action === 'move-down') return await handleMove(pool, projectId, itemId, 'down');
      if (request.method === 'GET' && !itemId) return await handleList(pool, projectId);
      if (request.method === 'POST' && !itemId) return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT' && itemId) return await handleUpdate(pool, projectId, itemId, request);
      if (request.method === 'DELETE' && itemId) return await handleArchive(pool, projectId, itemId);

      return { status: 400, jsonBody: { success: false, message: 'Invalid WBS request.' } };
    } catch (err) {
      context.error('WBS API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'WBS request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

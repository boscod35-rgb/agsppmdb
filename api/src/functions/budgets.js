const { app } = require('@azure/functions');
const sql = require('mssql');

// /api/ppm/budgets/{projectId}
//
// Addressed by ProjectId (1:1 relationship), same convention as
// charters.js.
//
// GET    /{projectId} -> returns { budget, computed } together.
//           `budget` is the stored, editable row (null fields if no
//           budget has been created yet - this is expected, not an
//           error). `computed` is ALWAYS present regardless of
//           whether a budget row exists, since it's derived purely
//           from Effort x Rate data (Modules 21's Actual Cost, 24's
//           Billing Calculation, 25's EAC/Variance) - see D021.
// POST   /{projectId} -> create the budget row (fails with
//           ALREADY_EXISTS if one already exists - use PUT instead)
// PUT    /{projectId} -> update budget fields

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
  if (err.category === 'ALREADY_EXISTS') return { error: 'ALREADY_EXISTS', detail: err.message };
  const code = err.code || '';
  if (code === 'ELOGIN') return { error: 'SQL_AUTH_FAILED', detail: 'SQL authentication failed.' };
  if (code === 'ETIMEOUT' || code === 'ESOCKET') return { error: 'SQL_NETWORK_BLOCKED', detail: 'Could not reach the SQL server.' };
  if (/Invalid object name.*ProjectBudgets/i.test(err.message || '') || /Invalid object name.*TaskEffort/i.test(err.message || '')) {
    return { error: 'SCHEMA_MISSING', detail: 'ppm.ProjectBudgets / ppm.TaskEffort do not exist yet. Run migration 011_finance_rate_billing.sql.' };
  }
  if (/Violation of UNIQUE KEY constraint/i.test(err.message || '')) {
    return { error: 'ALREADY_EXISTS', detail: 'This project already has a budget. Use PUT to update it.' };
  }
  return { error: 'DATABASE_UNAVAILABLE', detail: 'Unexpected database error.' };
}

async function assertProjectExists(executor, projectId) {
  const result = await executor.input('id', sql.Int, projectId).query('SELECT ProjectId FROM ppm.Projects WHERE ProjectId = @id');
  if (result.recordset.length === 0) {
    const err = new Error(`Project ${projectId} not found.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
}

// Module 21's Actual Cost, Module 24's Billing Calculation, and
// Module 25's EAC/Variance - all derived at read time from
// ppm.TaskEffort x resolved ppm.RateCards, no stored table (D021,
// same pattern as Chunk 06's Capacity & Utilization, D018).
//
// Rate resolution per effort entry: an explicit RateCardId on the
// entry wins; otherwise the best active RateCard whose Role/Type
// (each nullable = wildcard) matches the resource's own Role/Type,
// most recently effective first. Hours with no resolvable rate are
// tracked separately as "unresolved" rather than silently costed at
// zero, so the numbers stay honest.
async function computeCostSummary(pool, projectId) {
  const result = await pool.request().input('projectId', sql.Int, projectId).query(`
    SELECT te.*, r.ResourceCode, r.ResourceName, r.ResourceRoleValueId AS ResRoleId, r.ResourceTypeValueId AS ResTypeId,
           explicitRC.RateCardCode AS ExplicitRateCardCode, explicitRC.CostRatePerHour AS ExplicitCostRate, explicitRC.BillRatePerHour AS ExplicitBillRate,
           autoRC.RateCardCode AS AutoRateCardCode, autoRC.CostRatePerHour AS AutoCostRate, autoRC.BillRatePerHour AS AutoBillRate
    FROM ppm.TaskEffort te
    JOIN ppm.ScheduleTasks st ON st.ScheduleTaskId = te.ScheduleTaskId
    JOIN ppm.Resources r ON r.ResourceId = te.ResourceId
    LEFT JOIN ppm.RateCards explicitRC ON explicitRC.RateCardId = te.RateCardId AND explicitRC.IsActive = 1
    OUTER APPLY (
      SELECT TOP 1 rc2.RateCardCode, rc2.CostRatePerHour, rc2.BillRatePerHour
      FROM ppm.RateCards rc2
      WHERE rc2.IsActive = 1 AND te.RateCardId IS NULL
        AND (rc2.ResourceRoleValueId IS NULL OR rc2.ResourceRoleValueId = r.ResourceRoleValueId)
        AND (rc2.ResourceTypeValueId IS NULL OR rc2.ResourceTypeValueId = r.ResourceTypeValueId)
      ORDER BY rc2.EffectiveStartDate DESC
    ) autoRC
    WHERE st.ProjectId = @projectId AND te.IsActive = 1;
  `);

  let actualCost = 0;
  let actualBillable = 0;
  let plannedCostFromEffort = 0;
  let unresolvedActualHours = 0;
  const lines = [];

  for (const row of result.recordset) {
    const costRate = row.ExplicitCostRate ?? row.AutoCostRate ?? null;
    const billRate = row.ExplicitBillRate ?? row.AutoBillRate ?? null;
    const rateCardCode = row.ExplicitRateCardCode ?? row.AutoRateCardCode ?? null;
    const actualHours = Number(row.ActualHours || 0);
    const plannedHours = Number(row.PlannedHours || 0);

    if (costRate !== null) {
      actualCost += actualHours * Number(costRate);
      plannedCostFromEffort += plannedHours * Number(costRate);
    } else if (actualHours > 0) {
      unresolvedActualHours += actualHours;
    }
    if (billRate !== null) actualBillable += actualHours * Number(billRate);

    lines.push({
      effortId: row.EffortId, resourceCode: row.ResourceCode, resourceName: row.ResourceName,
      plannedHours, actualHours, resolvedRateCardCode: rateCardCode,
      resolvedCostRate: costRate, resolvedBillRate: billRate,
    });
  }

  return { actualCost, actualBillable, plannedCostFromEffort, unresolvedActualHours, lines };
}

async function handleGet(pool, projectId) {
  await assertProjectExists(pool.request(), projectId);
  const budgetResult = await pool.request().input('projectId', sql.Int, projectId)
    .query('SELECT * FROM ppm.ProjectBudgets WHERE ProjectId = @projectId;');
  const budget = budgetResult.recordset[0] || null;

  const computed = await computeCostSummary(pool, projectId);
  const eac = budget?.ForecastCost != null ? computed.actualCost + Number(budget.ForecastCost) : null;
  const variance = budget?.BudgetAmount != null
    ? Number(budget.BudgetAmount) - (eac ?? computed.actualCost)
    : null;

  return {
    jsonBody: {
      success: true,
      budget,
      computed: { ...computed, estimateAtCompletion: eac, variance },
    },
  };
}

async function handleCreate(pool, projectId, request) {
  await assertProjectExists(pool.request(), projectId);
  const existing = await pool.request().input('projectId', sql.Int, projectId).query('SELECT ProjectBudgetId FROM ppm.ProjectBudgets WHERE ProjectId = @projectId');
  if (existing.recordset.length > 0) {
    const err = new Error(`Project ${projectId} already has a budget. Use PUT to update it.`);
    err.category = 'ALREADY_EXISTS';
    throw err;
  }
  const body = await request.json();
  const { budgetAmount, plannedCost, forecastCost, currencyCode, notes } = body || {};

  await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('budgetAmount', sql.Decimal(14, 2), budgetAmount ?? null)
    .input('plannedCost', sql.Decimal(14, 2), plannedCost ?? null)
    .input('forecastCost', sql.Decimal(14, 2), forecastCost ?? null)
    .input('currencyCode', sql.NVarChar(3), currencyCode || 'USD')
    .input('notes', sql.NVarChar, notes ?? null)
    .query(`
      INSERT INTO ppm.ProjectBudgets (ProjectId, BudgetAmount, PlannedCost, ForecastCost, CurrencyCode, Notes)
      VALUES (@projectId, @budgetAmount, @plannedCost, @forecastCost, @currencyCode, @notes);
    `);

  return await handleGet(pool, projectId);
}

async function handleUpdate(pool, projectId, request) {
  const existing = await pool.request().input('projectId', sql.Int, projectId).query('SELECT * FROM ppm.ProjectBudgets WHERE ProjectId = @projectId');
  if (existing.recordset.length === 0) {
    const err = new Error(`No budget exists yet for project ${projectId}. Use POST to create one.`);
    err.category = 'NOT_FOUND';
    throw err;
  }
  const row = existing.recordset[0];
  const body = await request.json();

  await pool.request()
    .input('projectId', sql.Int, projectId)
    .input('budgetAmount', sql.Decimal(14, 2), body.budgetAmount ?? row.BudgetAmount)
    .input('plannedCost', sql.Decimal(14, 2), body.plannedCost ?? row.PlannedCost)
    .input('forecastCost', sql.Decimal(14, 2), body.forecastCost ?? row.ForecastCost)
    .input('currencyCode', sql.NVarChar(3), body.currencyCode || row.CurrencyCode)
    .input('isActive', sql.Bit, body.isActive ?? row.IsActive)
    .input('notes', sql.NVarChar, body.notes ?? row.Notes)
    .query(`
      UPDATE ppm.ProjectBudgets
      SET BudgetAmount = @budgetAmount, PlannedCost = @plannedCost, ForecastCost = @forecastCost,
          CurrencyCode = @currencyCode, IsActive = @isActive, Notes = @notes,
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = SUSER_SNAME()
      WHERE ProjectId = @projectId;
    `);

  return await handleGet(pool, projectId);
}

app.http('budgets', {
  methods: ['GET', 'POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'ppm/budgets/{projectId}',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const projectId = Number(request.params.projectId);

      if (request.method === 'GET') return await handleGet(pool, projectId);
      if (request.method === 'POST') return await handleCreate(pool, projectId, request);
      if (request.method === 'PUT') return await handleUpdate(pool, projectId, request);

      return { status: 400, jsonBody: { success: false, message: 'Invalid request.' } };
    } catch (err) {
      context.error('Budgets API error:', err.message);
      const safe = classifyError(err);
      const status = safe.error === 'NOT_FOUND' ? 404 : safe.error === 'ALREADY_EXISTS' || safe.error === 'VALIDATION_FAILED' ? 400 : 500;
      return {
        status,
        jsonBody: { success: false, message: 'Budget request failed', error: safe.error, detail: safe.detail },
      };
    }
  },
});

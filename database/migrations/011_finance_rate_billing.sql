-- =============================================================
-- Migration: 011_finance_rate_billing.sql
-- Chunk:     Chunk 07 - Finance, Rate Card & Billing
-- Version:   v0.13.0
-- Framework Section: Module 21 (Cost Management), Module 22 (Rate
--            Card Management), Module 23 (Effort Management),
--            Module 24 (Billing Calculation), Module 25 (Budget /
--            Forecast / Variance)
--
-- Purpose: ppm.RateCards holds cost/bill rates by Resource Role +
-- Resource Type + Location (Module 22 - the three dimensions the
-- platform already has entities for; Customer/Contract/Grade are
-- explicitly deferred, see DECISIONS.md D020). ppm.TaskEffort wires
-- Task -> Resource -> Planned/Actual Effort (Module 23), nested
-- under ppm.ScheduleTasks. ppm.ProjectBudgets holds the editable,
-- judgment-based inputs for Modules 21 + 25 (baseline budget,
-- planned cost, forecast/ETC).
--
-- Module 24 (Billing Calculation) and the computed side of Modules
-- 21/25 (Actual Cost, Actual Billable, EAC, Variance) get NO new
-- table at all - they are derived at read time from Effort x Rate,
-- same pattern as Chunk 06's Capacity & Utilization (D018). See
-- budgets.js for the computation.
--
-- Three independent sections, each separately guarded:
--   1. ppm.RateCards
--   2. ppm.TaskEffort
--   3. ppm.ProjectBudgets
--
-- No new cfg.ConfigCategories or cfg.NumberingRules this round -
-- Rate Cards reuse the ResourceRole/ResourceType categories from
-- Chunk 06 and org.Locations from Chunk 02, and use a user-entered
-- code like cfg.Lifecycles / ppm.ProjectTemplates rather than a
-- Numbering rule.
--
-- Safe to re-run: every CREATE/seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 010_resource_rmg.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 10)
BEGIN
    RAISERROR('Migration 010_resource_rmg.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: ppm.RateCards (Module 22)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'RateCards'
)
BEGIN
    CREATE TABLE ppm.RateCards (
        RateCardId          INT IDENTITY(1,1) PRIMARY KEY,
        RateCardCode          NVARCHAR(50)  NOT NULL UNIQUE,   -- user-entered, like cfg.Lifecycles.LifecycleCode
        RateCardName            NVARCHAR(200) NOT NULL,
        ResourceRoleValueId         INT NULL,                       -- cfg.ConfigValues, category ResourceRole (Chunk 06)
        ResourceTypeValueId            INT NULL,                       -- cfg.ConfigValues, category ResourceType (Chunk 06)
        LocationId                        INT NULL,                       -- org.Locations (Chunk 02)
        CostRatePerHour                      DECIMAL(10,2) NOT NULL,
        BillRatePerHour                         DECIMAL(10,2) NULL,             -- nullable: some rate cards may be cost-only
        EffectiveStartDate                         DATE NULL,
        EffectiveEndDate                              DATE NULL,
        IsActive                                         BIT NOT NULL DEFAULT 1,
        Notes                                               NVARCHAR(500) NULL,
        CreatedDate                                           DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                               NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                               DATETIME2 NULL,
        UpdatedBy                                                   NVARCHAR(200) NULL,
        CONSTRAINT FK_RateCards_Role FOREIGN KEY (ResourceRoleValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_RateCards_Type FOREIGN KEY (ResourceTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_RateCards_Location FOREIGN KEY (LocationId) REFERENCES org.Locations(LocationId),
        CONSTRAINT CK_RateCards_CostRate CHECK (CostRatePerHour >= 0),
        CONSTRAINT CK_RateCards_BillRate CHECK (BillRatePerHour IS NULL OR BillRatePerHour >= 0)
    );
    CREATE INDEX IX_RateCards_RoleType ON ppm.RateCards (ResourceRoleValueId, ResourceTypeValueId);
END
GO

-- =============================================================
-- SECTION 2: ppm.TaskEffort (Module 23)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'TaskEffort'
)
BEGIN
    CREATE TABLE ppm.TaskEffort (
        EffortId          INT IDENTITY(1,1) PRIMARY KEY,
        ScheduleTaskId       INT NOT NULL,
        ResourceId              INT NOT NULL,
        RateCardId                  INT NULL,                       -- explicit override; falls back to
                                                                      -- Role+Type auto-match if NULL (see budgets.js)
        PlannedHours                   DECIMAL(7,2) NOT NULL DEFAULT 0,
        ActualHours                       DECIMAL(7,2) NULL,
        Notes                                 NVARCHAR(500) NULL,
        IsActive                                BIT NOT NULL DEFAULT 1,
        CreatedDate                               DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                   NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                   DATETIME2 NULL,
        UpdatedBy                                       NVARCHAR(200) NULL,
        CONSTRAINT FK_TaskEffort_Task FOREIGN KEY (ScheduleTaskId) REFERENCES ppm.ScheduleTasks(ScheduleTaskId),
        CONSTRAINT FK_TaskEffort_Resource FOREIGN KEY (ResourceId) REFERENCES ppm.Resources(ResourceId),
        CONSTRAINT FK_TaskEffort_RateCard FOREIGN KEY (RateCardId) REFERENCES ppm.RateCards(RateCardId),
        CONSTRAINT CK_TaskEffort_Planned CHECK (PlannedHours >= 0),
        CONSTRAINT CK_TaskEffort_Actual CHECK (ActualHours IS NULL OR ActualHours >= 0)
    );
    CREATE INDEX IX_TaskEffort_ScheduleTaskId ON ppm.TaskEffort (ScheduleTaskId);
    CREATE INDEX IX_TaskEffort_ResourceId ON ppm.TaskEffort (ResourceId);
    -- Filtered unique index (same pattern as ResourceSkills, D019):
    -- one active effort row per task-resource pair; a removed entry
    -- can be re-added later without a leftover inactive row blocking it.
    CREATE UNIQUE INDEX UQ_TaskEffort_ActiveTaskResource
        ON ppm.TaskEffort (ScheduleTaskId, ResourceId) WHERE IsActive = 1;
END
GO

-- =============================================================
-- SECTION 3: ppm.ProjectBudgets (Modules 21 + 25 - editable inputs only)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ProjectBudgets'
)
BEGIN
    CREATE TABLE ppm.ProjectBudgets (
        ProjectBudgetId    INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId             INT NOT NULL UNIQUE,
        BudgetAmount             DECIMAL(14,2) NULL,             -- Module 25 - baseline
        PlannedCost                  DECIMAL(14,2) NULL,             -- Module 21
        ForecastCost                     DECIMAL(14,2) NULL,             -- Module 25 - ETC, judgment-based (not a formula)
        CurrencyCode                        NVARCHAR(3) NOT NULL DEFAULT 'USD',
        Notes                                  NVARCHAR(500) NULL,
        IsActive                                 BIT NOT NULL DEFAULT 1,
        CreatedDate                                DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                    NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                    DATETIME2 NULL,
        UpdatedBy                                        NVARCHAR(200) NULL,
        CONSTRAINT FK_ProjectBudgets_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId)
    );
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 11)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (11, '011_finance_rate_billing', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'ppm.RateCards table exists' AS CheckItem, COUNT(*) AS RecordCount
    FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'RateCards'
UNION ALL
SELECT 'ppm.TaskEffort table exists', COUNT(*)
    FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'TaskEffort'
UNION ALL
SELECT 'ppm.ProjectBudgets table exists', COUNT(*)
    FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ProjectBudgets'
UNION ALL
SELECT 'RateCards FK to ResourceRole valid', COUNT(*)
    FROM sys.foreign_keys WHERE name = 'FK_RateCards_Role'
UNION ALL
SELECT 'TaskEffort filtered unique index exists', COUNT(*)
    FROM sys.indexes WHERE name = 'UQ_TaskEffort_ActiveTaskResource';
-- Expected: all five checks = 1

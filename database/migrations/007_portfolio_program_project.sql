-- =============================================================
-- Migration: 007_portfolio_program_project.sql
-- Chunk:     Chunk 03 - Portfolio / Program / Project Core
-- Version:   v0.9.0
-- Framework Section: Module 02 (Portfolio), Module 03 (Program),
--            Module 04 (Project), Section 8 (Configure First)
--
-- Purpose: First chunk with real business data. Creates the three
-- core PPM entities in the `ppm` schema (created empty back in
-- migration 001), all following the Configure-First principle:
-- every picklist-style attribute (status, type, category, size,
-- complexity, priority) is a foreign key into the existing
-- cfg.ConfigValues engine (migration 003/004), never a hardcoded
-- CHECK constraint list.
--
-- Four independent sections, each separately guarded:
--   1. cfg.ConfigCategories/Values additions - PortfolioStatus,
--      ProgramStatus, and WorkspaceModules (drives which Project
--      Workspace tabs render - reuses the existing generic engine
--      and its existing CRUD UI instead of a bespoke table; see
--      DECISIONS.md D011)
--   2. cfg.NumberingRules addition - Program (Portfolio and
--      Project rules were already seeded by migration 006)
--   3. ppm.Portfolios
--   4. ppm.Programs (references Portfolios)
--   5. ppm.Projects (references Portfolios, optionally Programs,
--      cfg.ConfigValues picklists, and cfg.Lifecycles)
--
-- Safe to re-run: every CREATE and seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 006_numbering_lifecycle_branding.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 6)
BEGIN
    RAISERROR('Migration 006_numbering_lifecycle_branding.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: Additional Configuration Engine categories/values
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'PortfolioStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('PortfolioStatus', 'Portfolio Status', 'Lifecycle status of a Portfolio record.', 1, 80);
    DECLARE @CatPortfolioStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatPortfolioStatus, 'DRAFT', 'Draft', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatPortfolioStatus, 'ACTIVE', 'Active', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatPortfolioStatus, 'ON_HOLD', 'On Hold', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatPortfolioStatus, 'CLOSED', 'Closed', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'ProgramStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProgramStatus', 'Program Status', 'Lifecycle status of a Program record.', 1, 90);
    DECLARE @CatProgramStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProgramStatus, 'DRAFT', 'Draft', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProgramStatus, 'ACTIVE', 'Active', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProgramStatus, 'ON_HOLD', 'On Hold', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProgramStatus, 'COMPLETED', 'Completed', 40, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProgramStatus, 'CANCELLED', 'Cancelled', 50, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

-- WorkspaceModules: drives which Project Workspace tabs render.
-- Deliberately reuses the generic Configuration Engine (rather than
-- a bespoke table) so the existing Configuration UI's Deactivate
-- button already works as an on/off switch for each tab, with zero
-- new admin UI. IsActive = 1 means the tab is enabled/visible.
IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'WorkspaceModules')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('WorkspaceModules', 'Project Workspace Modules', 'Which tabs render inside a Project Workspace.', 1, 100);
    DECLARE @CatWorkspaceModules INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatWorkspaceModules, 'OVERVIEW', 'Overview', 10, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'GAP_ASSESSMENT', 'Gap Assessment', 20, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'SCHEDULE', 'Schedule', 30, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'RESOURCES', 'Resources', 40, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'FINANCIALS', 'Financials', 50, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'RAID', 'RAID', 60, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'GOVERNANCE', 'Governance', 70, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'AUDITS', 'Audits', 80, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'DOCUMENTS', 'Documents', 90, 0, 'Chunk 03 - shell only, no module content yet.'),
        (@CatWorkspaceModules, 'HISTORY', 'History', 100, 0, 'Chunk 03 - shell only, no module content yet.');
END
GO

-- =============================================================
-- SECTION 2: Numbering - add the missing Program rule
-- (Portfolio and Project rules were already seeded by migration 006)
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.NumberingRules WHERE EntityType = 'Program')
BEGIN
    INSERT INTO cfg.NumberingRules (EntityType, Prefix, Separator, SequenceLength, Notes)
    VALUES ('Program', 'PG', '-', 4, 'Starter example - edit via Numbering UI once available.');
END
GO

-- =============================================================
-- SECTION 3: ppm.Portfolios
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Portfolios'
)
BEGIN
    CREATE TABLE ppm.Portfolios (
        PortfolioId       INT IDENTITY(1,1) PRIMARY KEY,
        PortfolioCode      NVARCHAR(20)  NOT NULL UNIQUE,   -- business-visible ID, e.g. PF-001
        PortfolioName       NVARCHAR(200) NOT NULL,
        BusinessUnitId          INT NULL,
        OwnerName                 NVARCHAR(200) NULL,           -- free text; no user/security module yet
        StatusValueId               INT NULL,                       -- cfg.ConfigValues, category PortfolioStatus
        Description                    NVARCHAR(1000) NULL,
        IsActive                          BIT NOT NULL DEFAULT 1,       -- Archive = 0, never a hard delete
        Notes                                NVARCHAR(500) NULL,
        CreatedDate                            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                DATETIME2 NULL,
        UpdatedBy                                    NVARCHAR(200) NULL,
        CONSTRAINT FK_Portfolios_BusinessUnit FOREIGN KEY (BusinessUnitId) REFERENCES org.BusinessUnits(BusinessUnitId),
        CONSTRAINT FK_Portfolios_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );

    CREATE INDEX IX_Portfolios_BusinessUnitId ON ppm.Portfolios (BusinessUnitId);
    CREATE INDEX IX_Portfolios_StatusValueId ON ppm.Portfolios (StatusValueId);
END
GO

-- =============================================================
-- SECTION 4: ppm.Programs (Portfolio mapping required)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Programs'
)
BEGIN
    CREATE TABLE ppm.Programs (
        ProgramId       INT IDENTITY(1,1) PRIMARY KEY,
        ProgramCode      NVARCHAR(20)  NOT NULL UNIQUE,   -- business-visible ID, e.g. PG-0001
        ProgramName       NVARCHAR(200) NOT NULL,
        PortfolioId           INT NOT NULL,
        ProgramManagerName        NVARCHAR(200) NULL,
        StatusValueId                INT NULL,               -- cfg.ConfigValues, category ProgramStatus
        Description                     NVARCHAR(1000) NULL,
        IsActive                           BIT NOT NULL DEFAULT 1,
        Notes                                 NVARCHAR(500) NULL,
        CreatedDate                             DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                 NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                 DATETIME2 NULL,
        UpdatedBy                                     NVARCHAR(200) NULL,
        CONSTRAINT FK_Programs_Portfolio FOREIGN KEY (PortfolioId) REFERENCES ppm.Portfolios(PortfolioId),
        CONSTRAINT FK_Programs_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );

    CREATE INDEX IX_Programs_PortfolioId ON ppm.Programs (PortfolioId);
    CREATE INDEX IX_Programs_StatusValueId ON ppm.Programs (StatusValueId);
END
GO

-- =============================================================
-- SECTION 5: ppm.Projects (Portfolio required, Program optional)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Projects'
)
BEGIN
    CREATE TABLE ppm.Projects (
        ProjectId          INT IDENTITY(1,1) PRIMARY KEY,
        ProjectCode         NVARCHAR(20)  NOT NULL UNIQUE,   -- business-visible ID, e.g. PRJ-00001
        ProjectName          NVARCHAR(200) NOT NULL,
        PortfolioId               INT NOT NULL,
        ProgramId                   INT NULL,                    -- optional per framework Module 04
        ProjectManagerName             NVARCHAR(200) NULL,
        ProjectTypeValueId                INT NULL,                    -- cfg.ConfigValues, category ProjectType
        ProjectCategoryValueId               INT NULL,                    -- category ProjectCategory
        ProjectSizeValueId                      INT NULL,                    -- category ProjectSize
        ProjectComplexityValueId                   INT NULL,                    -- category ProjectComplexity
        ProjectPriorityValueId                        INT NULL,                    -- category ProjectPriority
        StatusValueId                                    INT NULL,                    -- category ProjectStatus
        HealthStatusValueId                                 INT NULL,                    -- category ProjectHealthStatus (RAG)
        LifecycleId                                            INT NULL,                    -- cfg.Lifecycles
        StartDate                                                DATE NULL,
        TargetEndDate                                              DATE NULL,
        Description                                                  NVARCHAR(1000) NULL,
        IsActive                                                       BIT NOT NULL DEFAULT 1,
        Notes                                                             NVARCHAR(500) NULL,
        CreatedDate                                                         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                                             NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                                             DATETIME2 NULL,
        UpdatedBy                                                                 NVARCHAR(200) NULL,
        CONSTRAINT FK_Projects_Portfolio FOREIGN KEY (PortfolioId) REFERENCES ppm.Portfolios(PortfolioId),
        CONSTRAINT FK_Projects_Program FOREIGN KEY (ProgramId) REFERENCES ppm.Programs(ProgramId),
        CONSTRAINT FK_Projects_Type FOREIGN KEY (ProjectTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Category FOREIGN KEY (ProjectCategoryValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Size FOREIGN KEY (ProjectSizeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Complexity FOREIGN KEY (ProjectComplexityValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Priority FOREIGN KEY (ProjectPriorityValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_HealthStatus FOREIGN KEY (HealthStatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Projects_Lifecycle FOREIGN KEY (LifecycleId) REFERENCES cfg.Lifecycles(LifecycleId)
    );

    -- Supports the framework's explicit 250+ project pagination/
    -- search/filter/sort requirement (Module 04).
    CREATE INDEX IX_Projects_PortfolioId ON ppm.Projects (PortfolioId);
    CREATE INDEX IX_Projects_ProgramId ON ppm.Projects (ProgramId);
    CREATE INDEX IX_Projects_StatusValueId ON ppm.Projects (StatusValueId);
    CREATE INDEX IX_Projects_ProjectName ON ppm.Projects (ProjectName);
    CREATE INDEX IX_Projects_IsActive ON ppm.Projects (IsActive);
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 7)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (7, '007_portfolio_program_project', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'PortfolioStatus values' AS CheckItem, COUNT(*) AS RecordCount
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'PortfolioStatus'
UNION ALL
SELECT 'ProgramStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'ProgramStatus'
UNION ALL
SELECT 'WorkspaceModules values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WorkspaceModules'
UNION ALL
SELECT 'NumberingRules (Program)', COUNT(*) FROM cfg.NumberingRules WHERE EntityType = 'Program'
UNION ALL
SELECT 'ppm.Portfolios table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Portfolios'
UNION ALL
SELECT 'ppm.Programs table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Programs'
UNION ALL
SELECT 'ppm.Projects table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Projects';
-- Expected: PortfolioStatus=4, ProgramStatus=5, WorkspaceModules=10,
-- NumberingRules(Program)=1, and all three table-exists checks = 1

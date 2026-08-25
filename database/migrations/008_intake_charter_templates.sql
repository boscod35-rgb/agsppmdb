-- =============================================================
-- Migration: 008_intake_charter_templates.sql
-- Chunk:     Chunk 04 - Project Intake, Charter & Templates
-- Version:   v0.10.0
-- Framework Section: Module 08 (Template Management), Module 09
--            (Project Intake), Module 10 (Project Charter),
--            Module 11 (Process Matrix)
--
-- Purpose: Templates own an ordered Process Matrix (same nested
-- pattern as cfg.Lifecycles/LifecyclePhases from migration 006).
-- Intakes are pre-project requests that Convert into a real
-- ppm.Projects row using the same transactional Numbering pattern
-- established in migration 007 (D012). Charters attach 1:1 to an
-- existing Project and become the first Project Workspace tab with
-- real content instead of a placeholder.
--
-- Explicitly OUT of scope: instantiating a Template's Process
-- Matrix items as an actual WBS checklist on a real project - that
-- is Module 12 (WBS), Chunk 05. This migration only adds the
-- optional TemplateId reference so a Project can record which
-- template it came from.
--
-- Five independent sections, each separately guarded:
--   1. cfg.ConfigCategories/Values additions - IntakeStatus,
--      CharterApprovalStatus, and one new WorkspaceModules value
--      (Charter)
--   2. cfg.NumberingRules addition - Intake
--   3. ppm.ProjectTemplates + ppm.ProcessMatrixItems
--   4. ppm.ProjectIntakes
--   5. ppm.ProjectCharters
--   6. ALTER ppm.Projects to add nullable TemplateId
--
-- Safe to re-run: every CREATE/ALTER/seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 007_portfolio_program_project.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 7)
BEGIN
    RAISERROR('Migration 007_portfolio_program_project.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: Additional Configuration Engine categories/values
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'IntakeStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('IntakeStatus', 'Intake Status', 'Lifecycle status of a Project Intake request.', 1, 110);
    DECLARE @CatIntakeStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatIntakeStatus, 'SUBMITTED', 'Submitted', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatIntakeStatus, 'UNDER_REVIEW', 'Under Review', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatIntakeStatus, 'APPROVED', 'Approved', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatIntakeStatus, 'REJECTED', 'Rejected', 40, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatIntakeStatus, 'CONVERTED', 'Converted to Project', 50, 0, 'Set automatically by the Convert action - not manually assignable in the UI.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'CharterApprovalStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('CharterApprovalStatus', 'Charter Approval Status', 'Approval status of a Project Charter.', 1, 120);
    DECLARE @CatCharterStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatCharterStatus, 'DRAFT', 'Draft', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatCharterStatus, 'PENDING_APPROVAL', 'Pending Approval', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatCharterStatus, 'APPROVED', 'Approved', 30, 0, 'Set automatically by the Approve action - not manually assignable in the UI.'),
        (@CatCharterStatus, 'REJECTED', 'Rejected', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

-- New tab in the Project Workspace shell (built in Chunk 03). Same
-- reuse-the-generic-engine approach as the original 10 values -
-- see DECISIONS.md D011.
IF NOT EXISTS (
    SELECT 1 FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WorkspaceModules' AND cv.ValueCode = 'CHARTER'
)
BEGIN
    DECLARE @CatWorkspaceModules INT = (SELECT CategoryId FROM cfg.ConfigCategories WHERE CategoryCode = 'WorkspaceModules');
    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes)
    VALUES (@CatWorkspaceModules, 'CHARTER', 'Charter', 15, 0, 'Chunk 04 - first workspace tab with real content (Module 10).');
END
GO

-- =============================================================
-- SECTION 2: Numbering - add the missing Intake rule
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.NumberingRules WHERE EntityType = 'Intake')
BEGIN
    INSERT INTO cfg.NumberingRules (EntityType, Prefix, Separator, SequenceLength, Notes)
    VALUES ('Intake', 'INT', '-', 5, 'Starter example - edit via Numbering UI once available.');
END
GO

-- =============================================================
-- SECTION 3: ppm.ProjectTemplates + ppm.ProcessMatrixItems
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ProjectTemplates'
)
BEGIN
    CREATE TABLE ppm.ProjectTemplates (
        TemplateId       INT IDENTITY(1,1) PRIMARY KEY,
        TemplateCode      NVARCHAR(50)  NOT NULL UNIQUE,   -- user-entered, like cfg.Lifecycles.LifecycleCode
        TemplateName       NVARCHAR(200) NOT NULL,
        ProjectTypeValueId     INT NULL,                       -- cfg.ConfigValues, category ProjectType
        LifecycleId               INT NULL,                       -- cfg.Lifecycles - template can pre-select a lifecycle
        Description                  NVARCHAR(1000) NULL,
        IsActive                        BIT NOT NULL DEFAULT 1,
        Notes                              NVARCHAR(500) NULL,
        CreatedDate                          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                              NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                              DATETIME2 NULL,
        UpdatedBy                                  NVARCHAR(200) NULL,
        CONSTRAINT FK_ProjectTemplates_Type FOREIGN KEY (ProjectTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ProjectTemplates_Lifecycle FOREIGN KEY (LifecycleId) REFERENCES cfg.Lifecycles(LifecycleId)
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ProcessMatrixItems'
)
BEGIN
    CREATE TABLE ppm.ProcessMatrixItems (
        ProcessMatrixItemId   INT IDENTITY(1,1) PRIMARY KEY,
        TemplateId              INT NOT NULL,
        ItemName                   NVARCHAR(200) NOT NULL,
        SequenceOrder                 INT NOT NULL DEFAULT 0,
        IsRequired                       BIT NOT NULL DEFAULT 1,
        IsActive                            BIT NOT NULL DEFAULT 1,
        Notes                                  NVARCHAR(500) NULL,
        CreatedDate                              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                  NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                  DATETIME2 NULL,
        UpdatedBy                                      NVARCHAR(200) NULL,
        CONSTRAINT FK_ProcessMatrixItems_Template FOREIGN KEY (TemplateId) REFERENCES ppm.ProjectTemplates(TemplateId)
    );
    CREATE INDEX IX_ProcessMatrixItems_TemplateId ON ppm.ProcessMatrixItems (TemplateId);
END
GO

-- =============================================================
-- SECTION 4: ppm.ProjectIntakes
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ProjectIntakes'
)
BEGIN
    CREATE TABLE ppm.ProjectIntakes (
        IntakeId            INT IDENTITY(1,1) PRIMARY KEY,
        IntakeCode           NVARCHAR(20)  NOT NULL UNIQUE,   -- business-visible ID, e.g. INT-00001
        RequestTitle          NVARCHAR(200) NOT NULL,
        BusinessNeed             NVARCHAR(2000) NULL,
        SponsorName                 NVARCHAR(200) NULL,
        RequestedByName                NVARCHAR(200) NULL,
        BusinessUnitId                    INT NULL,               -- org.BusinessUnits
        ProjectTypeValueId                    INT NULL,               -- cfg.ConfigValues, category ProjectType
        ProjectCategoryValueId                   INT NULL,               -- category ProjectCategory
        PriorityValueId                             INT NULL,               -- category ProjectPriority
        TemplateId                                     INT NULL,               -- ppm.ProjectTemplates
        StatusValueId                                     INT NULL,               -- category IntakeStatus
        RequestedDate                                        DATE NULL,
        ProjectId                                               INT NULL,               -- set once Converted
        Description                                                NVARCHAR(1000) NULL,
        IsActive                                                      BIT NOT NULL DEFAULT 1,
        Notes                                                            NVARCHAR(500) NULL,
        CreatedDate                                                        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                                            NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                                            DATETIME2 NULL,
        UpdatedBy                                                                NVARCHAR(200) NULL,
        CONSTRAINT FK_ProjectIntakes_BusinessUnit FOREIGN KEY (BusinessUnitId) REFERENCES org.BusinessUnits(BusinessUnitId),
        CONSTRAINT FK_ProjectIntakes_Type FOREIGN KEY (ProjectTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ProjectIntakes_Category FOREIGN KEY (ProjectCategoryValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ProjectIntakes_Priority FOREIGN KEY (PriorityValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ProjectIntakes_Template FOREIGN KEY (TemplateId) REFERENCES ppm.ProjectTemplates(TemplateId),
        CONSTRAINT FK_ProjectIntakes_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ProjectIntakes_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId)
    );
    CREATE INDEX IX_ProjectIntakes_StatusValueId ON ppm.ProjectIntakes (StatusValueId);
    CREATE INDEX IX_ProjectIntakes_BusinessUnitId ON ppm.ProjectIntakes (BusinessUnitId);
END
GO

-- =============================================================
-- SECTION 5: ppm.ProjectCharters (1:1 with ppm.Projects)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ProjectCharters'
)
BEGIN
    CREATE TABLE ppm.ProjectCharters (
        CharterId             INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId               INT NOT NULL UNIQUE,
        Objectives                 NVARCHAR(2000) NULL,
        [Scope]                       NVARCHAR(2000) NULL,   -- bracketed: SCOPE is a T-SQL reserved-ish keyword in some contexts
        Assumptions                     NVARCHAR(2000) NULL,
        Constraints                        NVARCHAR(2000) NULL,
        BusinessCase                          NVARCHAR(2000) NULL,
        ApprovalStatusValueId                    INT NULL,               -- category CharterApprovalStatus
        ApprovedByName                              NVARCHAR(200) NULL,
        ApprovedDate                                    DATE NULL,
        IsActive                                           BIT NOT NULL DEFAULT 1,
        Notes                                                 NVARCHAR(500) NULL,
        CreatedDate                                             DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                                 NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                                 DATETIME2 NULL,
        UpdatedBy                                                     NVARCHAR(200) NULL,
        CONSTRAINT FK_ProjectCharters_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_ProjectCharters_Status FOREIGN KEY (ApprovalStatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
END
GO

-- =============================================================
-- SECTION 6: ppm.Projects gets an optional TemplateId reference
-- (additive ALTER on an already-applied table - the table itself
-- was created in migration 007 and is not being edited; only this
-- new migration adds to it, per CLAUDE.md rule 3)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Projects' AND c.name = 'TemplateId'
)
BEGIN
    ALTER TABLE ppm.Projects ADD TemplateId INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Projects_Template'
)
BEGIN
    ALTER TABLE ppm.Projects
        ADD CONSTRAINT FK_Projects_Template FOREIGN KEY (TemplateId) REFERENCES ppm.ProjectTemplates(TemplateId);
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 8)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (8, '008_intake_charter_templates', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'IntakeStatus values' AS CheckItem, COUNT(*) AS RecordCount
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'IntakeStatus'
UNION ALL
SELECT 'CharterApprovalStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'CharterApprovalStatus'
UNION ALL
SELECT 'WorkspaceModules values (now includes Charter)', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WorkspaceModules'
UNION ALL
SELECT 'NumberingRules (Intake)', COUNT(*) FROM cfg.NumberingRules WHERE EntityType = 'Intake'
UNION ALL
SELECT 'ppm.ProjectTemplates table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ProjectTemplates'
UNION ALL
SELECT 'ppm.ProcessMatrixItems table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ProcessMatrixItems'
UNION ALL
SELECT 'ppm.ProjectIntakes table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ProjectIntakes'
UNION ALL
SELECT 'ppm.ProjectCharters table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ProjectCharters'
UNION ALL
SELECT 'ppm.Projects.TemplateId column exists', COUNT(*) FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Projects' AND c.name = 'TemplateId';
-- Expected: IntakeStatus=5, CharterApprovalStatus=4,
-- WorkspaceModules=11, NumberingRules(Intake)=1, and all five
-- table/column-exists checks = 1

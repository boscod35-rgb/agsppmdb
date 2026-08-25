-- =============================================================
-- Migration: 010_resource_rmg.sql
-- Chunk:     Chunk 06 - Resource / RMG
-- Version:   v0.12.0
-- Framework Section: Module 16 (Resource Master/RMG), Module 17
--            (Staffing & Allocation), Module 18 (Baseline vs Actual
--            Resource Tracking), Module 19 (Capacity & Utilization),
--            Module 20 (Skills/Competency Matrix)
--
-- Purpose: ppm.Resources is the resource master (Module 16).
-- ppm.ResourceAllocations does double duty for Modules 17 and 18 -
-- Planned and Actual allocation percentages live as two columns on
-- the same row, rather than a separate snapshot/versioning table
-- that would duplicate a future dedicated Baseline Engine (see
-- DECISIONS.md D017). Module 19 (Capacity & Utilization) gets no
-- new table at all - it is a derived computation over existing
-- allocation data, exposed via an API endpoint (see D018). Module
-- 20 (Skills) reuses the Configuration Engine for both the skill
-- vocabulary and proficiency levels (see D019), with
-- ppm.ResourceSkills as the only new table it needs.
--
-- Five independent sections, each separately guarded:
--   1. cfg.ConfigCategories/Values additions - ResourceType,
--      ResourceRole, AllocationStatus, Skill, SkillProficiencyLevel
--   2. cfg.NumberingRules addition - Resource
--   3. ppm.Resources
--   4. ppm.ResourceAllocations
--   5. ppm.ResourceSkills
--
-- Safe to re-run: every CREATE/seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 009_wbs_schedule_delivery.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 9)
BEGIN
    RAISERROR('Migration 009_wbs_schedule_delivery.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: Additional Configuration Engine categories/values
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'ResourceType')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ResourceType', 'Resource Type', 'Employment/engagement type of a Resource (Module 16).', 1, 180);
    DECLARE @CatResourceType INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatResourceType, 'EMPLOYEE', 'Employee', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceType, 'CONTRACTOR', 'Contractor', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceType, 'VENDOR', 'Vendor', 30, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'ResourceRole')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ResourceRole', 'Resource Role', 'Functional role of a Resource (Module 16).', 1, 190);
    DECLARE @CatResourceRole INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatResourceRole, 'PROJECT_MANAGER', 'Project Manager', 10, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceRole, 'DEVELOPER', 'Developer', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceRole, 'BUSINESS_ANALYST', 'Business Analyst', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceRole, 'QA_TESTER', 'QA / Tester', 40, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatResourceRole, 'ARCHITECT', 'Architect', 50, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'AllocationStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('AllocationStatus', 'Resource Allocation Status', 'Status of a Resource Allocation to a Project (Module 17).', 1, 200);
    DECLARE @CatAllocationStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatAllocationStatus, 'PLANNED', 'Planned', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatAllocationStatus, 'ACTIVE', 'Active', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatAllocationStatus, 'ENDED', 'Ended', 30, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'Skill')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('Skill', 'Skill', 'Skill vocabulary for the Resource Competency Matrix (Module 20).', 1, 210);
    DECLARE @CatSkill INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatSkill, 'PROJECT_MANAGEMENT', 'Project Management', 10, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatSkill, 'SOFTWARE_DEVELOPMENT', 'Software Development', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatSkill, 'BUSINESS_ANALYSIS', 'Business Analysis', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatSkill, 'CLOUD_INFRASTRUCTURE', 'Cloud Infrastructure', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'SkillProficiencyLevel')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('SkillProficiencyLevel', 'Skill Proficiency Level', 'Proficiency scale for a Resource''s Skill (Module 20).', 1, 220);
    DECLARE @CatProficiency INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProficiency, 'BEGINNER', 'Beginner', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProficiency, 'INTERMEDIATE', 'Intermediate', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProficiency, 'ADVANCED', 'Advanced', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProficiency, 'EXPERT', 'Expert', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

-- =============================================================
-- SECTION 2: Numbering - add the missing Resource rule
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.NumberingRules WHERE EntityType = 'Resource')
BEGIN
    INSERT INTO cfg.NumberingRules (EntityType, Prefix, Separator, SequenceLength, Notes)
    VALUES ('Resource', 'RES', '-', 5, 'Starter example - edit via Numbering UI once available.');
END
GO

-- =============================================================
-- SECTION 3: ppm.Resources (Resource Master)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Resources'
)
BEGIN
    CREATE TABLE ppm.Resources (
        ResourceId          INT IDENTITY(1,1) PRIMARY KEY,
        ResourceCode          NVARCHAR(20)  NOT NULL UNIQUE,   -- business-visible ID, e.g. RES-00001
        ResourceName            NVARCHAR(200) NOT NULL,
        Email                      NVARCHAR(200) NULL,
        BusinessUnitId               INT NULL,                       -- org.BusinessUnits
        ResourceTypeValueId              INT NULL,                       -- cfg.ConfigValues, category ResourceType
        ResourceRoleValueId                 INT NULL,                       -- cfg.ConfigValues, category ResourceRole
        DefaultCapacityHoursPerWeek            DECIMAL(5,2) NOT NULL DEFAULT 40,
        IsActive                                  BIT NOT NULL DEFAULT 1,
        Notes                                        NVARCHAR(500) NULL,
        CreatedDate                                    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                        NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                        DATETIME2 NULL,
        UpdatedBy                                            NVARCHAR(200) NULL,
        CONSTRAINT FK_Resources_BusinessUnit FOREIGN KEY (BusinessUnitId) REFERENCES org.BusinessUnits(BusinessUnitId),
        CONSTRAINT FK_Resources_Type FOREIGN KEY (ResourceTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_Resources_Role FOREIGN KEY (ResourceRoleValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
    CREATE INDEX IX_Resources_BusinessUnitId ON ppm.Resources (BusinessUnitId);
END
GO

-- =============================================================
-- SECTION 4: ppm.ResourceAllocations (Modules 17 + 18 combined)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ResourceAllocations'
)
BEGIN
    CREATE TABLE ppm.ResourceAllocations (
        AllocationId           INT IDENTITY(1,1) PRIMARY KEY,
        ResourceId                INT NOT NULL,
        ProjectId                    INT NOT NULL,
        PlannedAllocationPercent        DECIMAL(5,2) NOT NULL DEFAULT 0,   -- Module 17 - Staffing & Allocation
        ActualAllocationPercent            DECIMAL(5,2) NULL,                 -- Module 18 - Baseline vs Actual
        StartDate                             DATE NULL,
        EndDate                                  DATE NULL,
        StatusValueId                               INT NULL,                       -- cfg.ConfigValues, category AllocationStatus
        IsActive                                       BIT NOT NULL DEFAULT 1,
        Notes                                             NVARCHAR(500) NULL,
        CreatedDate                                         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                             NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                             DATETIME2 NULL,
        UpdatedBy                                                 NVARCHAR(200) NULL,
        CONSTRAINT FK_ResourceAllocations_Resource FOREIGN KEY (ResourceId) REFERENCES ppm.Resources(ResourceId),
        CONSTRAINT FK_ResourceAllocations_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_ResourceAllocations_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT CK_ResourceAllocations_Planned CHECK (PlannedAllocationPercent BETWEEN 0 AND 100),
        CONSTRAINT CK_ResourceAllocations_Actual CHECK (ActualAllocationPercent IS NULL OR ActualAllocationPercent BETWEEN 0 AND 100)
    );
    CREATE INDEX IX_ResourceAllocations_ResourceId ON ppm.ResourceAllocations (ResourceId);
    CREATE INDEX IX_ResourceAllocations_ProjectId ON ppm.ResourceAllocations (ProjectId);
END
GO

-- =============================================================
-- SECTION 5: ppm.ResourceSkills (Module 20)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ResourceSkills'
)
BEGIN
    CREATE TABLE ppm.ResourceSkills (
        ResourceSkillId       INT IDENTITY(1,1) PRIMARY KEY,
        ResourceId               INT NOT NULL,
        SkillValueId                 INT NOT NULL,                       -- cfg.ConfigValues, category Skill
        ProficiencyLevelValueId          INT NULL,                       -- cfg.ConfigValues, category SkillProficiencyLevel
        Notes                                NVARCHAR(500) NULL,
        IsActive                               BIT NOT NULL DEFAULT 1,
        CreatedDate                              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                  NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                  DATETIME2 NULL,
        UpdatedBy                                      NVARCHAR(200) NULL,
        CONSTRAINT FK_ResourceSkills_Resource FOREIGN KEY (ResourceId) REFERENCES ppm.Resources(ResourceId),
        CONSTRAINT FK_ResourceSkills_Skill FOREIGN KEY (SkillValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT FK_ResourceSkills_Proficiency FOREIGN KEY (ProficiencyLevelValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
    CREATE INDEX IX_ResourceSkills_ResourceId ON ppm.ResourceSkills (ResourceId);
    -- Filtered unique index (not a table constraint) so a skill can
    -- be removed (IsActive = 0) and re-added later without a
    -- leftover inactive row blocking the new insert.
    CREATE UNIQUE INDEX UQ_ResourceSkills_ActiveSkillPerResource
        ON ppm.ResourceSkills (ResourceId, SkillValueId) WHERE IsActive = 1;
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 10)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (10, '010_resource_rmg', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'ResourceType values' AS CheckItem, COUNT(*) AS RecordCount
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'ResourceType'
UNION ALL
SELECT 'ResourceRole values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'ResourceRole'
UNION ALL
SELECT 'AllocationStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'AllocationStatus'
UNION ALL
SELECT 'Skill values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'Skill'
UNION ALL
SELECT 'SkillProficiencyLevel values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'SkillProficiencyLevel'
UNION ALL
SELECT 'NumberingRules (Resource)', COUNT(*) FROM cfg.NumberingRules WHERE EntityType = 'Resource'
UNION ALL
SELECT 'ppm.Resources table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Resources'
UNION ALL
SELECT 'ppm.ResourceAllocations table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ResourceAllocations'
UNION ALL
SELECT 'ppm.ResourceSkills table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ResourceSkills';
-- Expected: ResourceType=3, ResourceRole=5, AllocationStatus=3,
-- Skill=4, SkillProficiencyLevel=4, NumberingRules(Resource)=1, and
-- all three table-exists checks = 1

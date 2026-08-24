-- =============================================================
-- Migration: 003_config_engine.sql
-- Chunk:     Chunk 02 - Database Foundation + Configuration Engine
-- Version:   v0.5.0
-- Framework Section: 8 (Configure First), Module 05 (Configuration
--            Engine)
--
-- Purpose: Generic configuration engine core - one reusable
-- category/value pattern in the existing cfg schema, seeded with
-- the picklist-style categories from Module 05's initial config
-- list (Project Type, Category, Size, Complexity, Priority,
-- Status, Health Status). Organization (Module 01), Numbering
-- Rules (Module 06), and Lifecycle/Stage-Gate (Module 07) are
-- deliberately NOT included here - each needs its own structure
-- (hierarchy, pattern-generation, stage/gate rules) rather than a
-- flat picklist, and gets its own migration later. See
-- DECISIONS.md for the scope reasoning if it needs revisiting.
--
-- Safe to re-run: schema/table creation is existence-checked, and
-- the seed insert is guarded so re-running this script does not
-- duplicate rows.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 002_cmdb.sql to have already been applied.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Guard: require migration 002 to already be applied
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 2)
BEGIN
    RAISERROR('Migration 002_cmdb.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- -------------------------------------------------------------
-- 1. cfg.ConfigCategories
--    The set of configurable picklists (e.g. "Project Type").
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'ConfigCategories'
)
BEGIN
    CREATE TABLE cfg.ConfigCategories (
        CategoryId       INT IDENTITY(1,1) PRIMARY KEY,
        CategoryCode      NVARCHAR(50)    NOT NULL,
        CategoryName       NVARCHAR(200)   NOT NULL,
        Description          NVARCHAR(500)   NULL,
        IsSystemCategory        BIT             NOT NULL DEFAULT 0,  -- seeded by migration, not user-created
        SortOrder                  INT             NOT NULL DEFAULT 0,
        CreatedDate                  DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                      NVARCHAR(200)   NOT NULL DEFAULT SUSER_SNAME(),
        CONSTRAINT UQ_ConfigCategories_Code UNIQUE (CategoryCode)
    );
END
GO

-- -------------------------------------------------------------
-- 2. cfg.ConfigValues
--    The picklist entries belonging to each category.
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'ConfigValues'
)
BEGIN
    CREATE TABLE cfg.ConfigValues (
        ConfigValueId    INT IDENTITY(1,1) PRIMARY KEY,
        CategoryId         INT             NOT NULL,
        ValueCode            NVARCHAR(50)    NOT NULL,
        ValueLabel             NVARCHAR(200)   NOT NULL,
        SortOrder                 INT             NOT NULL DEFAULT 0,
        IsActive                    BIT             NOT NULL DEFAULT 1,
        IsDefault                     BIT             NOT NULL DEFAULT 0,
        Notes                           NVARCHAR(500)   NULL,
        CreatedDate                       DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                           NVARCHAR(200)   NOT NULL DEFAULT SUSER_SNAME(),
        CONSTRAINT UQ_ConfigValues_Category_Code UNIQUE (CategoryId, ValueCode),
        CONSTRAINT FK_ConfigValues_Category
            FOREIGN KEY (CategoryId) REFERENCES cfg.ConfigCategories(CategoryId)
    );

    CREATE INDEX IX_ConfigValues_CategoryId
        ON cfg.ConfigValues (CategoryId);
END
GO

-- -------------------------------------------------------------
-- 3. Seed data
--    Starter/example values only - expected to be edited once
--    the Configuration UI supports Create/Update/Delete.
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'ProjectType')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectType', 'Project Type', 'Classifies the nature of the project.', 1, 10);
    DECLARE @CatProjectType INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectCategory', 'Category', 'Classifies why the project exists.', 1, 20);
    DECLARE @CatProjectCategory INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectSize', 'Size', 'Relative sizing for reporting and governance thresholds.', 1, 30);
    DECLARE @CatProjectSize INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectComplexity', 'Complexity', 'Delivery complexity rating.', 1, 40);
    DECLARE @CatProjectComplexity INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectPriority', 'Priority', 'Relative priority for portfolio balancing.', 1, 50);
    DECLARE @CatProjectPriority INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectStatus', 'Status', 'Lifecycle status of the project record.', 1, 60);
    DECLARE @CatProjectStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('ProjectHealthStatus', 'Health Status', 'RAG rating used on dashboards and roll-ups.', 1, 70);
    DECLARE @CatProjectHealthStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectType, 'SOFTWARE_DELIVERY', 'Software Delivery', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectType, 'INFRASTRUCTURE', 'Infrastructure', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectType, 'BUSINESS_CHANGE', 'Business Change', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectType, 'RESEARCH', 'Research', 40, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectCategory, 'STRATEGIC', 'Strategic', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectCategory, 'OPERATIONAL', 'Operational', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectCategory, 'COMPLIANCE', 'Compliance', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectCategory, 'MAINTENANCE', 'Maintenance', 40, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectSize, 'SMALL', 'Small', 10, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectSize, 'MEDIUM', 'Medium', 20, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectSize, 'LARGE', 'Large', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectSize, 'ENTERPRISE', 'Enterprise', 40, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectComplexity, 'LOW', 'Low', 10, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectComplexity, 'MEDIUM', 'Medium', 20, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectComplexity, 'HIGH', 'High', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectComplexity, 'VERY_HIGH', 'Very High', 40, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectPriority, 'LOW', 'Low', 10, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectPriority, 'MEDIUM', 'Medium', 20, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectPriority, 'HIGH', 'High', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectPriority, 'CRITICAL', 'Critical', 40, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectStatus, 'DRAFT', 'Draft', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectStatus, 'ACTIVE', 'Active', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectStatus, 'ON_HOLD', 'On Hold', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectStatus, 'COMPLETED', 'Completed', 40, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectStatus, 'CANCELLED', 'Cancelled', 50, 0, 'Starter example - edit via Configuration UI once available.');

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatProjectHealthStatus, 'GREEN', 'Green', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectHealthStatus, 'YELLOW', 'Yellow', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatProjectHealthStatus, 'RED', 'Red', 30, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

-- -------------------------------------------------------------
-- 4. Record this migration in system.SchemaVersions
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 3)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (3, '003_config_engine', 'Applied');
END
GO

-- -------------------------------------------------------------
-- 5. Verification query
-- -------------------------------------------------------------

SELECT
    cc.CategoryCode,
    cc.CategoryName,
    COUNT(cv.ConfigValueId) AS ValueCount
FROM cfg.ConfigCategories cc
LEFT JOIN cfg.ConfigValues cv ON cv.CategoryId = cc.CategoryId
GROUP BY cc.CategoryCode, cc.CategoryName, cc.SortOrder
ORDER BY cc.SortOrder;
-- Expected: 7 categories, each with at least 3 values

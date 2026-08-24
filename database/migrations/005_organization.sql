-- =============================================================
-- Migration: 005_organization.sql
-- Chunk:     Chunk 02 - Database Foundation + Configuration Engine
-- Version:   v0.7.0
-- Framework Section: 88 (Settings Navigation - Organization),
--            Module 01 (Organization)
--
-- Purpose: Organization module core - Business Units, Departments,
-- Locations. Lives in the `org` schema created (but left empty)
-- back in migration 001. Departments reference a Business Unit;
-- Locations are standalone. Same Create/Update/Deactivate pattern
-- as the Configuration Engine (migration 004) - soft-delete only,
-- no hard DELETE, so nothing is ever silently lost.
--
-- Safe to re-run: schema/table creation is existence-checked, and
-- the seed insert is guarded so re-running this script does not
-- duplicate rows.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 004_config_crud.sql to have already been applied.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Guard: require migration 004 to already be applied
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 4)
BEGIN
    RAISERROR('Migration 004_config_crud.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- -------------------------------------------------------------
-- 1. org.BusinessUnits
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'org' AND t.name = 'BusinessUnits'
)
BEGIN
    CREATE TABLE org.BusinessUnits (
        BusinessUnitId    INT IDENTITY(1,1) PRIMARY KEY,
        BusinessUnitCode   NVARCHAR(50)  NOT NULL UNIQUE,   -- e.g. IT
        BusinessUnitName    NVARCHAR(200) NOT NULL,          -- e.g. Information Technology
        IsActive               BIT NOT NULL DEFAULT 1,
        Notes                    NVARCHAR(500) NULL,
        CreatedDate                DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                    NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                    DATETIME2 NULL,
        UpdatedBy                        NVARCHAR(200) NULL
    );
END
GO

-- -------------------------------------------------------------
-- 2. org.Departments (references BusinessUnits)
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'org' AND t.name = 'Departments'
)
BEGIN
    CREATE TABLE org.Departments (
        DepartmentId    INT IDENTITY(1,1) PRIMARY KEY,
        DepartmentCode   NVARCHAR(50)  NOT NULL UNIQUE,   -- e.g. INFRA
        DepartmentName    NVARCHAR(200) NOT NULL,          -- e.g. Infrastructure
        BusinessUnitId       INT NOT NULL,
        IsActive                BIT NOT NULL DEFAULT 1,
        Notes                     NVARCHAR(500) NULL,
        CreatedDate                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                     NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                     DATETIME2 NULL,
        UpdatedBy                         NVARCHAR(200) NULL,
        CONSTRAINT FK_Departments_BusinessUnit
            FOREIGN KEY (BusinessUnitId) REFERENCES org.BusinessUnits(BusinessUnitId)
    );

    CREATE INDEX IX_Departments_BusinessUnitId ON org.Departments (BusinessUnitId);
END
GO

-- -------------------------------------------------------------
-- 3. org.Locations (standalone)
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'org' AND t.name = 'Locations'
)
BEGIN
    CREATE TABLE org.Locations (
        LocationId    INT IDENTITY(1,1) PRIMARY KEY,
        LocationCode   NVARCHAR(50)  NOT NULL UNIQUE,   -- e.g. SEA-HQ
        LocationName    NVARCHAR(200) NOT NULL,          -- e.g. Southeast Asia HQ
        Country            NVARCHAR(100) NULL,
        TimeZone             NVARCHAR(100) NULL,           -- e.g. Asia/Singapore
        IsActive                BIT NOT NULL DEFAULT 1,
        Notes                     NVARCHAR(500) NULL,
        CreatedDate                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                     NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                     DATETIME2 NULL,
        UpdatedBy                         NVARCHAR(200) NULL
    );
END
GO

-- -------------------------------------------------------------
-- 4. Seed data - starter examples, editable via the UI
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM org.BusinessUnits WHERE BusinessUnitCode = 'CORP')
BEGIN
    INSERT INTO org.BusinessUnits (BusinessUnitCode, BusinessUnitName, Notes)
    VALUES
        ('CORP', 'Corporate', 'Starter example - edit via Organization UI once available.'),
        ('IT', 'Information Technology', 'Starter example - edit via Organization UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM org.Departments WHERE DepartmentCode = 'PMO')
BEGIN
    DECLARE @CorpId INT = (SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = 'CORP');
    DECLARE @ItId INT = (SELECT BusinessUnitId FROM org.BusinessUnits WHERE BusinessUnitCode = 'IT');

    INSERT INTO org.Departments (DepartmentCode, DepartmentName, BusinessUnitId, Notes)
    VALUES
        ('PMO', 'Project Management Office', @CorpId, 'Starter example - edit via Organization UI once available.'),
        ('INFRA', 'Infrastructure', @ItId, 'Starter example - edit via Organization UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM org.Locations WHERE LocationCode = 'SEA-HQ')
BEGIN
    INSERT INTO org.Locations (LocationCode, LocationName, Country, TimeZone, Notes)
    VALUES
        ('SEA-HQ', 'Southeast Asia HQ', 'Singapore', 'Asia/Singapore', 'Starter example - edit via Organization UI once available.');
END
GO

-- -------------------------------------------------------------
-- 5. Record this migration in system.SchemaVersions
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 5)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (5, '005_organization', 'Applied');
END
GO

-- -------------------------------------------------------------
-- 6. Verification query
-- -------------------------------------------------------------

SELECT 'BusinessUnits' AS TableName, COUNT(*) AS RowCount FROM org.BusinessUnits
UNION ALL
SELECT 'Departments', COUNT(*) FROM org.Departments
UNION ALL
SELECT 'Locations', COUNT(*) FROM org.Locations;
-- Expected: BusinessUnits=2, Departments=2, Locations=1

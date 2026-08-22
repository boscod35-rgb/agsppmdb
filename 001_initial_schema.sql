-- =============================================================
-- Migration: 001_initial_schema.sql
-- Chunk:     CHUNK 01 - Database Foundation
-- Version:   v0.2.0
-- Framework Section: 82 (Logical Database Domains), 92 (Migration
--            Strategy), 66 (Audit Trail)
--
-- Purpose: Create the 15 logical schemas the platform is organized
-- into, plus the two system tables that track migration history
-- and change auditing. No business tables yet - that starts in
-- CHUNK 02 onward.
--
-- Safe to re-run: every statement checks for existence first, so
-- running this twice against the same database is a no-op the
-- second time, not an error.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Do not apply to
-- PPM_PROD until PROD is provisioned and this same file has been
-- validated on DEV and TEST without modification.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Logical schemas (Section 82)
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'cfg')
    EXEC('CREATE SCHEMA cfg');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'org')
    EXEC('CREATE SCHEMA org');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'ppm')
    EXEC('CREATE SCHEMA ppm');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'schedule')
    EXEC('CREATE SCHEMA schedule');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'resource')
    EXEC('CREATE SCHEMA resource');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'finance')
    EXEC('CREATE SCHEMA finance');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'raid')
    EXEC('CREATE SCHEMA raid');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'gov')
    EXEC('CREATE SCHEMA gov');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'audit')
    EXEC('CREATE SCHEMA audit');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'assessment')
    EXEC('CREATE SCHEMA assessment');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'workflow')
    EXEC('CREATE SCHEMA workflow');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'notify')
    EXEC('CREATE SCHEMA notify');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'document')
    EXEC('CREATE SCHEMA document');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'security')
    EXEC('CREATE SCHEMA security');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'system')
    EXEC('CREATE SCHEMA system');
GO

-- -------------------------------------------------------------
-- 2. system.SchemaVersions (Section 92)
--    Tracks every migration ever applied to this database.
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'system' AND t.name = 'SchemaVersions'
)
BEGIN
    CREATE TABLE system.SchemaVersions (
        VersionId       INT IDENTITY(1,1) PRIMARY KEY,
        MigrationNumber INT             NOT NULL,
        MigrationName   NVARCHAR(200)   NOT NULL,
        AppliedDate     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        AppliedBy       NVARCHAR(200)   NOT NULL DEFAULT SUSER_SNAME(),
        Checksum        NVARCHAR(64)    NULL,
        Status          NVARCHAR(20)    NOT NULL DEFAULT 'Applied'
            CONSTRAINT CK_SchemaVersions_Status
            CHECK (Status IN ('Applied', 'Failed', 'RolledBack')),
        CONSTRAINT UQ_SchemaVersions_MigrationNumber UNIQUE (MigrationNumber)
    );
END
GO

-- -------------------------------------------------------------
-- 3. system.AuditLog (Section 66)
--    Central change history for critical field-level changes
--    across all modules. Individual modules write here; this
--    migration only creates the table.
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'system' AND t.name = 'AuditLog'
)
BEGIN
    CREATE TABLE system.AuditLog (
        AuditLogId   BIGINT IDENTITY(1,1) PRIMARY KEY,
        EntityName   NVARCHAR(100)  NOT NULL,   -- e.g. 'ppm.Projects'
        RecordId     NVARCHAR(100)  NOT NULL,   -- internal key of the changed record
        FieldName    NVARCHAR(100)  NULL,       -- null = whole-record event (create/delete)
        OldValue     NVARCHAR(MAX)  NULL,
        NewValue     NVARCHAR(MAX)  NULL,
        ChangedBy    NVARCHAR(200)  NOT NULL,
        ChangedDate  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        Reason       NVARCHAR(500)  NULL,
        Source       NVARCHAR(100)  NOT NULL DEFAULT 'API'  -- API, Import, System, etc.
    );

    CREATE INDEX IX_AuditLog_Entity_Record
        ON system.AuditLog (EntityName, RecordId);
    CREATE INDEX IX_AuditLog_ChangedDate
        ON system.AuditLog (ChangedDate);
END
GO

-- -------------------------------------------------------------
-- 4. Record this migration in system.SchemaVersions
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 1)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (1, '001_initial_schema', 'Applied');
END
GO

-- -------------------------------------------------------------
-- 5. Verification query - run after the script to confirm
-- -------------------------------------------------------------

SELECT
    (SELECT COUNT(*) FROM sys.schemas WHERE name IN
        ('cfg','org','ppm','schedule','resource','finance','raid',
         'gov','audit','assessment','workflow','notify','document',
         'security','system')) AS SchemasCreated,
    (SELECT COUNT(*) FROM system.SchemaVersions)                 AS MigrationsApplied,
    (SELECT MAX(MigrationNumber) FROM system.SchemaVersions)     AS LatestMigration;
-- Expected result: SchemasCreated = 15, MigrationsApplied = 1, LatestMigration = 1

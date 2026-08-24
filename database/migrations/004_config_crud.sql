-- =============================================================
-- Migration: 004_config_crud.sql
-- Chunk:     Chunk 02 - Database Foundation + Configuration Engine
-- Version:   v0.6.0
-- Framework Section: 8 (Configure First), Module 05 (Configuration
--            Engine) - CRUD slice
--
-- Purpose: Add UpdatedDate / UpdatedBy tracking columns to
-- cfg.ConfigValues so the new Create/Update/Deactivate API can
-- record when a value was last changed. These columns did not
-- exist in migration 003 (which only needed CreatedDate/CreatedBy
-- for the initial seed) - this is a new, additive migration rather
-- than an edit to 003, per DB_SCHEMA.md's rule against modifying
-- already-applied migrations.
--
-- Safe to re-run: column addition is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 003_config_engine.sql to have already been applied.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Guard: require migration 003 to already be applied
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 3)
BEGIN
    RAISERROR('Migration 003_config_engine.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- -------------------------------------------------------------
-- 1. Add UpdatedDate / UpdatedBy to cfg.ConfigValues
-- -------------------------------------------------------------

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('cfg.ConfigValues') AND name = 'UpdatedDate'
)
BEGIN
    ALTER TABLE cfg.ConfigValues ADD UpdatedDate DATETIME2 NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('cfg.ConfigValues') AND name = 'UpdatedBy'
)
BEGIN
    ALTER TABLE cfg.ConfigValues ADD UpdatedBy NVARCHAR(200) NULL;
END
GO

-- -------------------------------------------------------------
-- 2. Record this migration in system.SchemaVersions
-- -------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 4)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (4, '004_config_crud', 'Applied');
END
GO

-- -------------------------------------------------------------
-- 3. Verification query
-- -------------------------------------------------------------

SELECT
    COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'cfg' AND TABLE_NAME = 'ConfigValues'
    AND COLUMN_NAME IN ('UpdatedDate', 'UpdatedBy')
ORDER BY COLUMN_NAME;
-- Expected: 2 rows - UpdatedBy (nvarchar, YES) and UpdatedDate (datetime2, YES)

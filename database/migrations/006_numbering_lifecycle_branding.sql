-- =============================================================
-- Migration: 006_numbering_lifecycle_branding.sql
-- Chunk:     Chunk 02 - Database Foundation + Configuration Engine
-- Version:   v0.8.0
-- Framework Section: 7 (Numbering), Section 6/58 (Lifecycle/Gates),
--            Section 106 (Branding & Theme Engine)
--
-- Purpose: Three modules bundled into one migration at the user's
-- request, to move through the remaining Chunk 02 items faster.
-- Each section below is independent and separately guarded, so a
-- problem in one section does not prevent the others from applying.
--
-- 1. cfg.NumberingRules       - Module 06
-- 2. cfg.Lifecycles + cfg.LifecyclePhases - Module 07
-- 3. cfg.BrandThemes          - Section 106 (data model only; the
--    live app does not read from this table yet - that's a
--    separate future step)
--
-- Safe to re-run: every CREATE and seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 005_organization.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 5)
BEGIN
    RAISERROR('Migration 005_organization.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: Numbering (Module 06)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'NumberingRules'
)
BEGIN
    CREATE TABLE cfg.NumberingRules (
        NumberingRuleId    INT IDENTITY(1,1) PRIMARY KEY,
        EntityType           NVARCHAR(50) NOT NULL UNIQUE,   -- e.g. Project, Risk, Issue
        Prefix                  NVARCHAR(20) NOT NULL DEFAULT '',
        Suffix                    NVARCHAR(20) NOT NULL DEFAULT '',
        Separator                   NVARCHAR(5) NOT NULL DEFAULT '-',
        SequenceLength                 INT NOT NULL DEFAULT 5,
        StartingNumber                    INT NOT NULL DEFAULT 1,
        CurrentSequence                      INT NOT NULL DEFAULT 0,
        ResetRule                               NVARCHAR(20) NOT NULL DEFAULT 'Never'
            CONSTRAINT CK_NumberingRules_ResetRule
            CHECK (ResetRule IN ('Never', 'Monthly', 'Annual')),
        IsActive                                   BIT NOT NULL DEFAULT 1,
        Notes                                         NVARCHAR(500) NULL,
        CreatedDate                                     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                         NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                         DATETIME2 NULL,
        UpdatedBy                                             NVARCHAR(200) NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.NumberingRules WHERE EntityType = 'Project')
BEGIN
    INSERT INTO cfg.NumberingRules (EntityType, Prefix, Separator, SequenceLength, Notes)
    VALUES
        ('Project', 'PRJ', '-', 5, 'Starter example - edit via Numbering UI once available.'),
        ('Risk', 'RSK', '-', 5, 'Starter example - edit via Numbering UI once available.'),
        ('Issue', 'ISS', '-', 5, 'Starter example - edit via Numbering UI once available.'),
        ('Portfolio', 'PF', '-', 3, 'Starter example - edit via Numbering UI once available.');
END
GO

-- =============================================================
-- SECTION 2: Lifecycle / Stage-Gate (Module 07)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'Lifecycles'
)
BEGIN
    CREATE TABLE cfg.Lifecycles (
        LifecycleId    INT IDENTITY(1,1) PRIMARY KEY,
        LifecycleCode   NVARCHAR(50) NOT NULL UNIQUE,
        LifecycleName    NVARCHAR(200) NOT NULL,
        Version              INT NOT NULL DEFAULT 1,
        IsActive                BIT NOT NULL DEFAULT 1,
        Notes                     NVARCHAR(500) NULL,
        CreatedDate                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                     NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                     DATETIME2 NULL,
        UpdatedBy                         NVARCHAR(200) NULL
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'LifecyclePhases'
)
BEGIN
    CREATE TABLE cfg.LifecyclePhases (
        PhaseId    INT IDENTITY(1,1) PRIMARY KEY,
        LifecycleId  INT NOT NULL,
        PhaseName      NVARCHAR(200) NOT NULL,
        SequenceOrder    INT NOT NULL DEFAULT 0,
        IsRequired          BIT NOT NULL DEFAULT 1,
        IsActive                BIT NOT NULL DEFAULT 1,
        Notes                     NVARCHAR(500) NULL,
        CreatedDate                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                     NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                     DATETIME2 NULL,
        UpdatedBy                         NVARCHAR(200) NULL,
        CONSTRAINT FK_LifecyclePhases_Lifecycle
            FOREIGN KEY (LifecycleId) REFERENCES cfg.Lifecycles(LifecycleId)
    );
    CREATE INDEX IX_LifecyclePhases_LifecycleId ON cfg.LifecyclePhases (LifecycleId);
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.Lifecycles WHERE LifecycleCode = 'STD-PROJECT')
BEGIN
    INSERT INTO cfg.Lifecycles (LifecycleCode, LifecycleName, Notes)
    VALUES ('STD-PROJECT', 'Standard Project Lifecycle', 'Starter example - edit via Lifecycle UI once available.');

    DECLARE @LifecycleId INT = SCOPE_IDENTITY();

    INSERT INTO cfg.LifecyclePhases (LifecycleId, PhaseName, SequenceOrder, IsRequired)
    VALUES
        (@LifecycleId, 'Initiation', 10, 1),
        (@LifecycleId, 'Planning', 20, 1),
        (@LifecycleId, 'Execution', 30, 1),
        (@LifecycleId, 'Closure', 40, 1);
END
GO

-- =============================================================
-- SECTION 3: Branding & Theme Engine (Section 106) - data model
-- only. The live app does not read from this table yet.
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'cfg' AND t.name = 'BrandThemes'
)
BEGIN
    CREATE TABLE cfg.BrandThemes (
        ThemeId    INT IDENTITY(1,1) PRIMARY KEY,
        ThemeCode   NVARCHAR(50) NOT NULL UNIQUE,
        ThemeName    NVARCHAR(200) NOT NULL,
        IsDefault        BIT NOT NULL DEFAULT 0,
        IsActive             BIT NOT NULL DEFAULT 1,
        CompanyName              NVARCHAR(200) NULL,
        Tagline                    NVARCHAR(300) NULL,
        ColorPrimary                  NVARCHAR(20) NULL,
        ColorSecondary                    NVARCHAR(20) NULL,
        ColorAccent                          NVARCHAR(20) NULL,
        ColorStatusGreen                        NVARCHAR(20) NULL,
        ColorStatusAmber                            NVARCHAR(20) NULL,
        ColorStatusRed                                  NVARCHAR(20) NULL,
        Notes                                              NVARCHAR(500) NULL,
        CreatedDate                                            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                                NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                                DATETIME2 NULL,
        UpdatedBy                                                    NVARCHAR(200) NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.BrandThemes WHERE ThemeCode = 'THEME-DEFAULT')
BEGIN
    INSERT INTO cfg.BrandThemes (
        ThemeCode, ThemeName, IsDefault, CompanyName, Tagline,
        ColorPrimary, ColorSecondary, ColorAccent,
        ColorStatusGreen, ColorStatusAmber, ColorStatusRed, Notes
    )
    VALUES (
        'THEME-DEFAULT', 'Accent Gold (Baseline)', 1, 'PPM Enterprise Platform',
        'Configure it yourself.',
        '#B8860B', '#1B2A4A', '#D4AF37',
        '#1A7F37', '#C77700', '#B3261E',
        'Proposed baseline, not extracted from any brand asset. Not yet applied to the live app - management UI only for now.'
    );
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 6)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (6, '006_numbering_lifecycle_branding', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'NumberingRules' AS TableName, COUNT(*) AS RecordCount FROM cfg.NumberingRules
UNION ALL
SELECT 'Lifecycles', COUNT(*) FROM cfg.Lifecycles
UNION ALL
SELECT 'LifecyclePhases', COUNT(*) FROM cfg.LifecyclePhases
UNION ALL
SELECT 'BrandThemes', COUNT(*) FROM cfg.BrandThemes;
-- Expected: NumberingRules=4, Lifecycles=1, LifecyclePhases=4, BrandThemes=1

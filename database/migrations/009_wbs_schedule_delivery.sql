-- =============================================================
-- Migration: 009_wbs_schedule_delivery.sql
-- Chunk:     Chunk 05 - WBS, Schedule & Delivery Planning
-- Version:   v0.11.0
-- Framework Section: Module 12 (WBS/Breakdown Checklist), Module 13
--            (Schedule Management), Module 14 (Milestone &
--            Phase-Gate Tracking), Module 15 (Deliverables Management)
--
-- Purpose: WBS is a self-referencing hierarchy per project with
-- reorder support and green/red path marking (Module 12). Schedule
-- Tasks + Dependencies, Milestones (including phase gates tied back
-- to a project's Lifecycle Phases from Chunk 02), and Deliverables
-- are three independent-but-related tables per the framework's own
-- Chunk 05 grouping (Modules 13/14/15).
--
-- Also closes the loop deferred in Chunk 04 (D014 / migration 008
-- notes): a project's Template -> Process Matrix items can now be
-- instantiated as real ppm.WbsItems via an API action (not part of
-- this migration - see wbsItems.js generate-from-template).
--
-- Six independent sections, each separately guarded:
--   1. cfg.ConfigCategories/Values additions - WbsPathType,
--      TaskStatus, DependencyType, MilestoneStatus,
--      DeliverableAcceptanceStatus, and one new WorkspaceModules
--      value (WBS)
--   2. ppm.WbsItems
--   3. ppm.ScheduleTasks + ppm.TaskDependencies
--   4. ppm.Milestones
--   5. ppm.Deliverables
--
-- Safe to re-run: every CREATE/seed INSERT is existence-checked.
--
-- Apply order: PPM_DEV first, then PPM_TEST. Requires migration
-- 008_intake_charter_templates.sql to have already been applied.
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 8)
BEGIN
    RAISERROR('Migration 008_intake_charter_templates.sql must be applied first.', 16, 1);
    RETURN;
END
GO

-- =============================================================
-- SECTION 1: Additional Configuration Engine categories/values
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'WbsPathType')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('WbsPathType', 'WBS Path Type', 'Decision/control path marker on a WBS item (Module 12).', 1, 130);
    DECLARE @CatWbsPathType INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatWbsPathType, 'NEUTRAL', 'Neutral', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatWbsPathType, 'GREEN', 'Green Path', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatWbsPathType, 'RED', 'Red Path', 30, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'TaskStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('TaskStatus', 'Schedule Task Status', 'Status of a Schedule Task (Module 13).', 1, 140);
    DECLARE @CatTaskStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatTaskStatus, 'NOT_STARTED', 'Not Started', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatTaskStatus, 'IN_PROGRESS', 'In Progress', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatTaskStatus, 'COMPLETE', 'Complete', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatTaskStatus, 'BLOCKED', 'Blocked', 40, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatTaskStatus, 'CANCELLED', 'Cancelled', 50, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'DependencyType')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('DependencyType', 'Task Dependency Type', 'Relationship type between two Schedule Tasks (Module 13).', 1, 150);
    DECLARE @CatDependencyType INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatDependencyType, 'FS', 'Finish-to-Start', 10, 1, 'Standard PM dependency type - starter example.'),
        (@CatDependencyType, 'SS', 'Start-to-Start', 20, 0, 'Standard PM dependency type - starter example.'),
        (@CatDependencyType, 'FF', 'Finish-to-Finish', 30, 0, 'Standard PM dependency type - starter example.'),
        (@CatDependencyType, 'SF', 'Start-to-Finish', 40, 0, 'Standard PM dependency type - starter example.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'MilestoneStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('MilestoneStatus', 'Milestone Status', 'Status of a Milestone or Phase Gate (Module 14).', 1, 160);
    DECLARE @CatMilestoneStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatMilestoneStatus, 'PLANNED', 'Planned', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatMilestoneStatus, 'AT_RISK', 'At Risk', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatMilestoneStatus, 'ACHIEVED', 'Achieved', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatMilestoneStatus, 'MISSED', 'Missed', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

IF NOT EXISTS (SELECT 1 FROM cfg.ConfigCategories WHERE CategoryCode = 'DeliverableAcceptanceStatus')
BEGIN
    INSERT INTO cfg.ConfigCategories (CategoryCode, CategoryName, Description, IsSystemCategory, SortOrder)
    VALUES ('DeliverableAcceptanceStatus', 'Deliverable Acceptance Status', 'Acceptance status of a Deliverable (Module 15).', 1, 170);
    DECLARE @CatDeliverableStatus INT = SCOPE_IDENTITY();

    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes) VALUES
        (@CatDeliverableStatus, 'PENDING', 'Pending', 10, 1, 'Starter example - edit via Configuration UI once available.'),
        (@CatDeliverableStatus, 'ACCEPTED', 'Accepted', 20, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatDeliverableStatus, 'REJECTED', 'Rejected', 30, 0, 'Starter example - edit via Configuration UI once available.'),
        (@CatDeliverableStatus, 'RESUBMIT', 'Resubmit', 40, 0, 'Starter example - edit via Configuration UI once available.');
END
GO

-- New WBS tab in the Project Workspace shell. The existing SCHEDULE
-- value (seeded in migration 007) now gets real content too - no
-- new WorkspaceModules row needed for it.
IF NOT EXISTS (
    SELECT 1 FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WorkspaceModules' AND cv.ValueCode = 'WBS'
)
BEGIN
    DECLARE @CatWorkspaceModules INT = (SELECT CategoryId FROM cfg.ConfigCategories WHERE CategoryCode = 'WorkspaceModules');
    INSERT INTO cfg.ConfigValues (CategoryId, ValueCode, ValueLabel, SortOrder, IsDefault, Notes)
    VALUES (@CatWorkspaceModules, 'WBS', 'WBS', 25, 0, 'Chunk 05 - real content (Module 12), distinct UI from the Schedule tab.');
END
GO

-- =============================================================
-- SECTION 2: ppm.WbsItems (self-referencing hierarchy per project)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'WbsItems'
)
BEGIN
    CREATE TABLE ppm.WbsItems (
        WbsItemId          INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId            INT NOT NULL,
        ParentWbsItemId        INT NULL,                       -- self-reference, NULL = top level
        ItemName                 NVARCHAR(300) NOT NULL,
        SequenceOrder               INT NOT NULL DEFAULT 0,        -- for reorder / move up-down within the same parent
        IsComplete                     BIT NOT NULL DEFAULT 0,        -- checkbox completion
        PathTypeValueId                   INT NULL,                       -- cfg.ConfigValues, category WbsPathType
        Notes                                NVARCHAR(1000) NULL,
        IsActive                               BIT NOT NULL DEFAULT 1,
        CreatedDate                              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                  NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                  DATETIME2 NULL,
        UpdatedBy                                      NVARCHAR(200) NULL,
        CONSTRAINT FK_WbsItems_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_WbsItems_Parent FOREIGN KEY (ParentWbsItemId) REFERENCES ppm.WbsItems(WbsItemId),
        CONSTRAINT FK_WbsItems_PathType FOREIGN KEY (PathTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
    CREATE INDEX IX_WbsItems_ProjectId ON ppm.WbsItems (ProjectId);
    CREATE INDEX IX_WbsItems_ParentWbsItemId ON ppm.WbsItems (ParentWbsItemId);
END
GO

-- =============================================================
-- SECTION 3: ppm.ScheduleTasks + ppm.TaskDependencies
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'ScheduleTasks'
)
BEGIN
    CREATE TABLE ppm.ScheduleTasks (
        ScheduleTaskId   INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId          INT NOT NULL,
        TaskName             NVARCHAR(300) NOT NULL,
        StartDate               DATE NULL,
        DueDate                    DATE NULL,
        PercentComplete               INT NOT NULL DEFAULT 0,        -- 0-100
        StatusValueId                   INT NULL,                       -- cfg.ConfigValues, category TaskStatus
        Notes                              NVARCHAR(1000) NULL,
        IsActive                             BIT NOT NULL DEFAULT 1,
        CreatedDate                            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                DATETIME2 NULL,
        UpdatedBy                                    NVARCHAR(200) NULL,
        CONSTRAINT FK_ScheduleTasks_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_ScheduleTasks_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT CK_ScheduleTasks_PercentComplete CHECK (PercentComplete BETWEEN 0 AND 100)
    );
    CREATE INDEX IX_ScheduleTasks_ProjectId ON ppm.ScheduleTasks (ProjectId);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'TaskDependencies'
)
BEGIN
    CREATE TABLE ppm.TaskDependencies (
        TaskDependencyId   INT IDENTITY(1,1) PRIMARY KEY,
        TaskId                INT NOT NULL,                       -- the dependent / successor task
        DependsOnTaskId          INT NOT NULL,                       -- the predecessor task
        DependencyTypeValueId       INT NULL,                       -- cfg.ConfigValues, category DependencyType
        CreatedDate                    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                        NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        CONSTRAINT FK_TaskDependencies_Task FOREIGN KEY (TaskId) REFERENCES ppm.ScheduleTasks(ScheduleTaskId),
        CONSTRAINT FK_TaskDependencies_DependsOn FOREIGN KEY (DependsOnTaskId) REFERENCES ppm.ScheduleTasks(ScheduleTaskId),
        CONSTRAINT FK_TaskDependencies_Type FOREIGN KEY (DependencyTypeValueId) REFERENCES cfg.ConfigValues(ConfigValueId),
        CONSTRAINT CK_TaskDependencies_NotSelf CHECK (TaskId <> DependsOnTaskId),
        CONSTRAINT UQ_TaskDependencies UNIQUE (TaskId, DependsOnTaskId)
    );
    CREATE INDEX IX_TaskDependencies_TaskId ON ppm.TaskDependencies (TaskId);
END
GO

-- =============================================================
-- SECTION 4: ppm.Milestones (includes phase gates)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Milestones'
)
BEGIN
    CREATE TABLE ppm.Milestones (
        MilestoneId       INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId           INT NOT NULL,
        MilestoneName          NVARCHAR(300) NOT NULL,
        PlannedDate                DATE NULL,
        ActualDate                    DATE NULL,
        IsPhaseGate                      BIT NOT NULL DEFAULT 0,
        LifecyclePhaseId                    INT NULL,                       -- cfg.LifecyclePhases - ties a phase-gate milestone
                                                                              -- to the project's lifecycle phase structure (Chunk 02)
        StatusValueId                          INT NULL,                       -- cfg.ConfigValues, category MilestoneStatus
        ApprovedByName                            NVARCHAR(200) NULL,             -- free text, no auth system yet - same pattern as Charter
        ApprovedDate                                 DATE NULL,
        Notes                                           NVARCHAR(1000) NULL,
        IsActive                                           BIT NOT NULL DEFAULT 1,
        CreatedDate                                          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                              NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                              DATETIME2 NULL,
        UpdatedBy                                                  NVARCHAR(200) NULL,
        CONSTRAINT FK_Milestones_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_Milestones_LifecyclePhase FOREIGN KEY (LifecyclePhaseId) REFERENCES cfg.LifecyclePhases(PhaseId),
        CONSTRAINT FK_Milestones_Status FOREIGN KEY (StatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
    CREATE INDEX IX_Milestones_ProjectId ON ppm.Milestones (ProjectId);
END
GO

-- =============================================================
-- SECTION 5: ppm.Deliverables
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'ppm' AND t.name = 'Deliverables'
)
BEGIN
    CREATE TABLE ppm.Deliverables (
        DeliverableId      INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId             INT NOT NULL,
        DeliverableName          NVARCHAR(300) NOT NULL,
        OwnerName                   NVARCHAR(200) NULL,
        PlannedDate                    DATE NULL,
        ActualDate                        DATE NULL,
        MilestoneId                          INT NULL,                       -- ppm.Milestones, optional link
        AcceptanceStatusValueId                 INT NULL,                       -- cfg.ConfigValues, category DeliverableAcceptanceStatus
        Notes                                      NVARCHAR(1000) NULL,
        IsActive                                     BIT NOT NULL DEFAULT 1,
        CreatedDate                                    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy                                        NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME(),
        UpdatedDate                                        DATETIME2 NULL,
        UpdatedBy                                            NVARCHAR(200) NULL,
        CONSTRAINT FK_Deliverables_Project FOREIGN KEY (ProjectId) REFERENCES ppm.Projects(ProjectId),
        CONSTRAINT FK_Deliverables_Milestone FOREIGN KEY (MilestoneId) REFERENCES ppm.Milestones(MilestoneId),
        CONSTRAINT FK_Deliverables_Status FOREIGN KEY (AcceptanceStatusValueId) REFERENCES cfg.ConfigValues(ConfigValueId)
    );
    CREATE INDEX IX_Deliverables_ProjectId ON ppm.Deliverables (ProjectId);
END
GO

-- =============================================================
-- Record this migration
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM system.SchemaVersions WHERE MigrationNumber = 9)
BEGIN
    INSERT INTO system.SchemaVersions (MigrationNumber, MigrationName, Status)
    VALUES (9, '009_wbs_schedule_delivery', 'Applied');
END
GO

-- =============================================================
-- Verification query
-- =============================================================

SELECT 'WbsPathType values' AS CheckItem, COUNT(*) AS RecordCount
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WbsPathType'
UNION ALL
SELECT 'TaskStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'TaskStatus'
UNION ALL
SELECT 'DependencyType values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'DependencyType'
UNION ALL
SELECT 'MilestoneStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'MilestoneStatus'
UNION ALL
SELECT 'DeliverableAcceptanceStatus values', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'DeliverableAcceptanceStatus'
UNION ALL
SELECT 'WorkspaceModules values (now includes WBS)', COUNT(*)
    FROM cfg.ConfigValues cv JOIN cfg.ConfigCategories cc ON cc.CategoryId = cv.CategoryId
    WHERE cc.CategoryCode = 'WorkspaceModules'
UNION ALL
SELECT 'ppm.WbsItems table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'WbsItems'
UNION ALL
SELECT 'ppm.ScheduleTasks table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'ScheduleTasks'
UNION ALL
SELECT 'ppm.TaskDependencies table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'TaskDependencies'
UNION ALL
SELECT 'ppm.Milestones table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Milestones'
UNION ALL
SELECT 'ppm.Deliverables table exists', COUNT(*) FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'ppm' AND t.name = 'Deliverables';
-- Expected: WbsPathType=3, TaskStatus=5, DependencyType=4,
-- MilestoneStatus=4, DeliverableAcceptanceStatus=4,
-- WorkspaceModules=12, and all five table-exists checks = 1

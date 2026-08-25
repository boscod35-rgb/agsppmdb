# DB_SCHEMA.md

Database schema and migration reference. This is the source of
truth for what exists in the database — check here before assuming
a table exists.

## How migrations are run

No local SQL tooling. Migrations are applied through the Azure
Portal's browser-based **Query Editor**:

1. Azure Portal -> the target database (e.g. `PPM_DEV`) -> **Query
   editor (preview)**
2. Sign in with **SQL authentication** (not Microsoft Entra) using
   that environment's admin login
3. **New query**, paste the full migration file contents, click
   **Run**
4. Check the verification query at the bottom of the script — every
   migration file ends with one

Apply order is always **DEV first, then TEST**. PROD does not exist
yet (see `DECISIONS.md`, D002).

**Never edit an already-applied migration file.** If a mistake is
found in a migration that's already run against DEV or TEST, write
a new numbered migration that corrects it — never modify the
original file. (framework Section 92)

## Migration log

| # | File | Applied to | Purpose |
|---|---|---|---|
| 001 | `001_initial_schema.sql` | DEV, TEST | 15 schemas + `system.SchemaVersions` + `system.AuditLog` |
| 002 | `002_cmdb.sql` | DEV, TEST | `cmdb` schema + `cmdb.AzureResources` + seed data |
| 003 | `003_config_engine.sql` | DEV, TEST | `cfg.ConfigCategories` + `cfg.ConfigValues` + seed data (Configuration Engine core, Module 05) |
| 004 | `004_config_crud.sql` | DEV, TEST | `UpdatedDate` + `UpdatedBy` columns on `cfg.ConfigValues` (Configuration Engine CRUD) |
| 005 | `005_organization.sql` | DEV, TEST | `org.BusinessUnits` + `org.Departments` + `org.Locations` + seed data (Module 01) |
| 006 | `006_numbering_lifecycle_branding.sql` | DEV, TEST | `cfg.NumberingRules` (Module 06) + `cfg.Lifecycles`/`cfg.LifecyclePhases` (Module 07) + `cfg.BrandThemes` (Section 106, data model only) |
| 007 | `007_portfolio_program_project.sql` | DEV, TEST | `ppm.Portfolios` + `ppm.Programs` + `ppm.Projects` (Modules 02/03/04); `PortfolioStatus`/`ProgramStatus`/`WorkspaceModules` config categories; Program numbering rule |
| 008 | `008_intake_charter_templates.sql` | DEV, TEST | `ppm.ProjectTemplates` + `ppm.ProcessMatrixItems` + `ppm.ProjectIntakes` + `ppm.ProjectCharters` (Modules 08/09/10/11); `IntakeStatus`/`CharterApprovalStatus` config categories + `CHARTER` WorkspaceModules value; Intake numbering rule; adds `ppm.Projects.TemplateId` |
| 009 | `009_wbs_schedule_delivery.sql` | DEV, TEST | `ppm.WbsItems` + `ppm.ScheduleTasks` + `ppm.TaskDependencies` + `ppm.Milestones` + `ppm.Deliverables` (Modules 12/13/14/15); `WbsPathType`/`TaskStatus`/`DependencyType`/`MilestoneStatus`/`DeliverableAcceptanceStatus` config categories + `WBS` WorkspaceModules value |

Every database independently tracks which migrations it has via its
own `system.SchemaVersions` table — DEV and TEST each have their own
copy of this table, not a shared one.

## Schemas (15, created by migration 001)

```
cfg          org          ppm          schedule     resource
finance      raid         gov          audit        assessment
workflow     notify       document     security     system
```

Plus `cmdb` (created by migration 002 — not in the original 15,
added when the CMDB module was scoped).

As of migration 007: `system`, `cmdb`, `cfg`, `org`, and `ppm` are in
use. `ppm` holds the first true business-data tables (Portfolios,
Programs, Projects). `schedule`, `resource`, `finance`, `raid`,
`gov`, `audit`, `assessment`, `workflow`, `notify`, `document`, and
`security` remain empty — those come in Chunk 04 onward per
`CURRENT_STATUS.md`.

## system.SchemaVersions

```sql
VersionId        INT IDENTITY PRIMARY KEY
MigrationNumber   INT NOT NULL UNIQUE
MigrationName      NVARCHAR(200) NOT NULL
AppliedDate         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
AppliedBy             NVARCHAR(200) NOT NULL DEFAULT SUSER_SNAME()
Checksum               NVARCHAR(64) NULL
Status                  NVARCHAR(20) NOT NULL DEFAULT 'Applied'
                        CHECK (Status IN ('Applied','Failed','RolledBack'))
```

## system.AuditLog

```sql
AuditLogId    BIGINT IDENTITY PRIMARY KEY
EntityName     NVARCHAR(100) NOT NULL     -- e.g. 'ppm.Projects'
RecordId        NVARCHAR(100) NOT NULL
FieldName        NVARCHAR(100) NULL        -- null = whole-record event
OldValue          NVARCHAR(MAX) NULL
NewValue           NVARCHAR(MAX) NULL
ChangedBy           NVARCHAR(200) NOT NULL
ChangedDate          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
Reason                NVARCHAR(500) NULL
Source                 NVARCHAR(100) NOT NULL DEFAULT 'API'
```

Not yet written to by anything — created as infrastructure ahead of
the modules that will use it.

## cmdb.AzureResources

```sql
ResourceId          INT IDENTITY PRIMARY KEY
ResourceCode          NVARCHAR(20) NOT NULL UNIQUE   -- e.g. AZR-00001
Environment             NVARCHAR(10) NOT NULL CHECK IN ('DEV','TEST','PROD')
ResourceType              NVARCHAR(50) NOT NULL       -- e.g. 'SQL Server'
ResourceName                NVARCHAR(200) NOT NULL
ResourceGroup                 NVARCHAR(100) NOT NULL
Region                          NVARCHAR(50) NULL
SubscriptionId                    NVARCHAR(100) NULL
Endpoint                           NVARCHAR(500) NULL   -- URL or FQDN
AdminLogin                          NVARCHAR(100) NULL   -- username ONLY, never a secret
ParentResourceId                     INT NULL FK -> self
Status                                 NVARCHAR(20) DEFAULT 'Active'
                                       CHECK IN ('Active','Paused','Deprecated','Decommissioned')
Notes                                   NVARCHAR(1000) NULL
CreatedDate                              DATETIME2 DEFAULT SYSUTCDATETIME()
CreatedBy                                 NVARCHAR(200) DEFAULT SUSER_SNAME()
LastVerifiedDate                            DATETIME2 NULL
```

Seeded with 8 rows (AZR-00001 through AZR-00008) documenting the
actual DEV and TEST resources — see `002_cmdb.sql` for exact values,
or query the live table via `/api/cmdb/azure-resources`, or view it
in the app at Administration -> CMDB -> Azure Info.

## cfg.ConfigCategories

```sql
CategoryId          INT IDENTITY PRIMARY KEY
CategoryCode          NVARCHAR(50) NOT NULL UNIQUE   -- e.g. ProjectType
CategoryName            NVARCHAR(200) NOT NULL         -- e.g. Project Type
Description               NVARCHAR(500) NULL
IsSystemCategory            BIT DEFAULT 0                  -- seeded by migration, not user-created
SortOrder                     INT DEFAULT 0
CreatedDate                     DATETIME2 DEFAULT SYSUTCDATETIME()
CreatedBy                         NVARCHAR(200) DEFAULT SUSER_SNAME()
```

## cfg.ConfigValues

```sql
ConfigValueId       INT IDENTITY PRIMARY KEY
CategoryId            INT NOT NULL FK -> cfg.ConfigCategories
ValueCode               NVARCHAR(50) NOT NULL           -- e.g. SOFTWARE_DELIVERY
ValueLabel                 NVARCHAR(200) NOT NULL          -- e.g. Software Delivery
SortOrder                     INT DEFAULT 0
IsActive                         BIT DEFAULT 1
IsDefault                           BIT DEFAULT 0
Notes                                 NVARCHAR(500) NULL
CreatedDate                             DATETIME2 DEFAULT SYSUTCDATETIME()
CreatedBy                                 NVARCHAR(200) DEFAULT SUSER_SNAME()
UpdatedDate                                 DATETIME2 NULL   -- added in migration 004
UpdatedBy                                     NVARCHAR(200) NULL   -- added in migration 004
UNIQUE (CategoryId, ValueCode)
```

Seeded with 10 categories total as of migration 007: the original 7
Module 05 picklists (Project Type, Category, Size, Complexity,
Priority, Status, Health Status), plus `PortfolioStatus`,
`ProgramStatus`, and `WorkspaceModules` added in migration 007.
Organization (Module 01), Numbering Rules (Module 06), and
Lifecycle/Stage-Gate (Module 07) are still deliberately not modeled
as `cfg.ConfigValues` rows — each needed its own structure and got
its own migration (005, 006, 006 respectively).

Full CRUD is live via `/api/config/values` (see `API_CONTRACTS.md`):
create, update, and deactivate (soft-delete — `IsActive = 0`, never
a hard `DELETE`) are all supported and verified end-to-end on both
environments (migration `004_config_crud.sql`).

## org.BusinessUnits / org.Departments / org.Locations

```sql
org.BusinessUnits: BusinessUnitId PK, BusinessUnitCode UNIQUE, BusinessUnitName,
  IsActive, Notes, CreatedDate/By, UpdatedDate/By
org.Departments:   DepartmentId PK, DepartmentCode UNIQUE, DepartmentName,
  BusinessUnitId FK -> org.BusinessUnits, IsActive, Notes, CreatedDate/By, UpdatedDate/By
org.Locations:     LocationId PK, LocationCode UNIQUE, LocationName, Country, TimeZone,
  IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/org/{resource}/{id?}` (`resource` = `business-units`,
`departments`, or `locations`). Applied and verified DEV + TEST
(migration `005_organization.sql`).

## cfg.NumberingRules

```sql
NumberingRuleId  INT IDENTITY PRIMARY KEY
EntityType         NVARCHAR(50) NOT NULL UNIQUE   -- Portfolio, Program, Project, Risk, Issue
Prefix                NVARCHAR(20) DEFAULT ''
Suffix                  NVARCHAR(20) DEFAULT ''
Separator                 NVARCHAR(5) DEFAULT '-'
SequenceLength               INT DEFAULT 5
StartingNumber                  INT DEFAULT 1
CurrentSequence                    INT DEFAULT 0   -- real, atomic increment as of migration 007 (D012)
ResetRule                             NVARCHAR(20) DEFAULT 'Never' CHECK IN ('Never','Monthly','Annual')
IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

`GET /api/config/numbering/{id?}/preview` still exists for the
Numbering admin UI. Real generation (used by Portfolio/Program/Project
create) lives inline in `portfolios.js`/`programs.js`/`projects.js` —
see `API_CONTRACTS.md`.

## cfg.Lifecycles / cfg.LifecyclePhases

```sql
cfg.Lifecycles:       LifecycleId PK, LifecycleCode UNIQUE, LifecycleName, Version,
  IsActive, Notes, CreatedDate/By, UpdatedDate/By
cfg.LifecyclePhases:  PhaseId PK, LifecycleId FK -> cfg.Lifecycles, PhaseName,
  SequenceOrder, IsRequired, IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

Full CRUD (including nested phase management) via
`/api/config/lifecycle/{id?}/{sub?}/{subId?}`. Seeded with one
Standard Project Lifecycle (Initiation/Planning/Execution/Closure).
Lifecycle Gates (approval requirements between phases) are **not**
built — only the phase structure itself.

## cfg.BrandThemes

Data model + management UI only — the live app does not read from
this table yet. See `006_numbering_lifecycle_branding.sql` for the
full column list; not repeated here since nothing consumes it at
runtime yet.

## ppm.Portfolios / ppm.Programs / ppm.Projects

The first business-data tables in the platform (Chunk 03, migration
`007_portfolio_program_project.sql`). Every picklist-style attribute
is a foreign key into `cfg.ConfigValues`, never a hardcoded list —
Configure First applies here same as everywhere else.

```sql
ppm.Portfolios: PortfolioId PK, PortfolioCode UNIQUE, PortfolioName,
  BusinessUnitId FK -> org.BusinessUnits (nullable),
  OwnerName (free text - no security module yet), StatusValueId FK -> cfg.ConfigValues,
  Description, IsActive (Archive = 0), Notes, CreatedDate/By, UpdatedDate/By

ppm.Programs: ProgramId PK, ProgramCode UNIQUE, ProgramName,
  PortfolioId FK -> ppm.Portfolios (required), ProgramManagerName,
  StatusValueId FK -> cfg.ConfigValues, Description, IsActive, Notes, CreatedDate/By, UpdatedDate/By

ppm.Projects: ProjectId PK, ProjectCode UNIQUE, ProjectName,
  PortfolioId FK -> ppm.Portfolios (required), ProgramId FK -> ppm.Programs (nullable),
  ProjectManagerName,
  ProjectTypeValueId / ProjectCategoryValueId / ProjectSizeValueId /
  ProjectComplexityValueId / ProjectPriorityValueId / StatusValueId /
  HealthStatusValueId  -- all FK -> cfg.ConfigValues, all nullable
  LifecycleId FK -> cfg.Lifecycles (nullable),
  StartDate, TargetEndDate, Description, IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

`ppm.Projects` is indexed on `PortfolioId`, `ProgramId`,
`StatusValueId`, `ProjectName`, and `IsActive` to support the
framework's explicit 250+ project pagination/search/filter/sort
requirement. Full CRUD + paginated list via `/api/ppm/portfolios`,
`/api/ppm/programs`, `/api/ppm/projects` (see `API_CONTRACTS.md`).
"Archive" is the UI label for the same `IsActive = 0` soft-delete
convention used everywhere else in this codebase.

## ppm.ProjectTemplates / ppm.ProcessMatrixItems

Chunk 04, migration `008_intake_charter_templates.sql`. Same
nested-items pattern as `cfg.Lifecycles`/`LifecyclePhases`.

```sql
ppm.ProjectTemplates:    TemplateId PK, TemplateCode UNIQUE (user-entered, not Numbering-generated),
  TemplateName, ProjectTypeValueId FK -> cfg.ConfigValues (nullable),
  LifecycleId FK -> cfg.Lifecycles (nullable), Description, IsActive,
  Notes, CreatedDate/By, UpdatedDate/By

ppm.ProcessMatrixItems: ProcessMatrixItemId PK, TemplateId FK -> ppm.ProjectTemplates (required),
  ItemName, SequenceOrder, IsRequired, IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/ppm/templates/{id?}/{sub?}/{subId?}` (`sub` =
`items` for the nested Process Matrix). Configuration only — nothing
yet instantiates a template's items as a real WBS checklist on a
project (Module 12, Chunk 05).

## ppm.ProjectIntakes

Chunk 04, Module 09. Pre-project requests — `IntakeCode` is
Numbering-generated (`INT-#####`), same transactional pattern as
Portfolio/Program/Project (D012).

```sql
ppm.ProjectIntakes: IntakeId PK, IntakeCode UNIQUE, RequestTitle,
  BusinessNeed, SponsorName, RequestedByName,
  BusinessUnitId FK -> org.BusinessUnits (nullable),
  ProjectTypeValueId / ProjectCategoryValueId / PriorityValueId FK -> cfg.ConfigValues (all nullable),
  TemplateId FK -> ppm.ProjectTemplates (nullable),
  StatusValueId FK -> cfg.ConfigValues, category IntakeStatus,
  RequestedDate, ProjectId FK -> ppm.Projects (nullable - set on Convert),
  Description, IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/ppm/intakes/{id?}`. An intake becomes read-only
for PUT once `ProjectId` is set (converted). `POST /{id}/convert`
creates a real `ppm.Projects` row (see D014 — fields are copied
forward, not referenced live) using the same atomic Numbering
increment as `POST /api/ppm/projects`.

## ppm.ProjectCharters

Chunk 04, Module 10. One charter per project (`UNIQUE` on
`ProjectId`) — the first Project Workspace tab with real content
(see D013).

```sql
ppm.ProjectCharters: CharterId PK, ProjectId FK -> ppm.Projects UNIQUE,
  Objectives, [Scope], Assumptions, Constraints, BusinessCase,
  ApprovalStatusValueId FK -> cfg.ConfigValues (category CharterApprovalStatus),
  ApprovedByName, ApprovedDate, IsActive, Notes, CreatedDate/By, UpdatedDate/By
```

Addressed by `ProjectId`, not its own id: `GET/POST/PUT
/api/ppm/charters/{projectId}` + `POST /{projectId}/approve` (stamps
`ApprovedByName`/`ApprovedDate`, sets status to `APPROVED`). No auth
system exists yet, so `approvedByName` is free text supplied by
whoever clicks Approve — same convention as every other "who did
this" field in the platform.

## ppm.Projects.TemplateId (added in migration 008)

Nullable `INT` FK to `ppm.ProjectTemplates`, added via `ALTER TABLE`
on the already-applied `ppm.Projects` table (migration 007 itself
was not edited — this is a new migration adding to it, per
`CLAUDE.md` rule 3). Purely a record of which template a project
came from; does not drive any automatic checklist generation yet.

## ppm.WbsItems

Chunk 05, migration `009_wbs_schedule_delivery.sql`. Self-referencing
hierarchy per project (Module 12).

```sql
ppm.WbsItems: WbsItemId PK, ProjectId FK -> ppm.Projects (required),
  ParentWbsItemId FK -> ppm.WbsItems (nullable, self-ref - NULL = top level),
  ItemName, SequenceOrder (reorder within siblings sharing the same parent),
  IsComplete (checkbox), PathTypeValueId FK -> cfg.ConfigValues (category WbsPathType, nullable),
  Notes, IsActive, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/ppm/wbs/{projectId}/{itemId?}/{action?}`, plus
`toggle` (flip `IsComplete`), `move-up`/`move-down` (swap
`SequenceOrder` with the adjacent sibling, transactional), and
`generate-from-template` (instantiates the project's Template's
Process Matrix items as top-level WBS items — see D015; only runs on
an empty WBS). Archiving an item recursively archives its
descendants via a CTE, so nothing orphaned-looking stays visible.

## ppm.ScheduleTasks / ppm.TaskDependencies

Chunk 05, Module 13.

```sql
ppm.ScheduleTasks: ScheduleTaskId PK, ProjectId FK -> ppm.Projects (required),
  TaskName, StartDate, DueDate, PercentComplete (0-100, CHECK constrained),
  StatusValueId FK -> cfg.ConfigValues (category TaskStatus),
  Notes, IsActive, CreatedDate/By, UpdatedDate/By

ppm.TaskDependencies: TaskDependencyId PK,
  TaskId FK -> ppm.ScheduleTasks (the dependent/successor task),
  DependsOnTaskId FK -> ppm.ScheduleTasks (the predecessor task),
  DependencyTypeValueId FK -> cfg.ConfigValues (category DependencyType: FS/SS/FF/SF),
  CreatedDate/By.
  CHECK(TaskId <> DependsOnTaskId) blocks self-dependency;
  UNIQUE(TaskId, DependsOnTaskId) blocks duplicate links.
```

Full CRUD via `/api/ppm/schedule/tasks/{projectId}/{taskId?}/{sub?}/{subId?}`
(`sub` = `dependencies`). No WBS-to-Schedule linkage yet — the two
structures are independent this round.

## ppm.Milestones

Chunk 05, Module 14. Includes phase-gate milestones.

```sql
ppm.Milestones: MilestoneId PK, ProjectId FK -> ppm.Projects (required),
  MilestoneName, PlannedDate, ActualDate, IsPhaseGate,
  LifecyclePhaseId FK -> cfg.LifecyclePhases (nullable — ties a phase-gate
  milestone back to the project's lifecycle phase structure from Chunk 02),
  StatusValueId FK -> cfg.ConfigValues (category MilestoneStatus),
  ApprovedByName, ApprovedDate (free text, no auth system yet — same
  pattern as Charter, see D013), Notes, IsActive, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/ppm/milestones/{projectId}/{id?}` + `POST
/{id}/approve` (sets `StatusValueId = ACHIEVED`, stamps
`ApprovedByName`/`ApprovedDate`, and backfills `ActualDate` if not
already set).

## ppm.Deliverables

Chunk 05, Module 15.

```sql
ppm.Deliverables: DeliverableId PK, ProjectId FK -> ppm.Projects (required),
  DeliverableName, OwnerName, PlannedDate, ActualDate,
  MilestoneId FK -> ppm.Milestones (nullable, optional link),
  AcceptanceStatusValueId FK -> cfg.ConfigValues (category DeliverableAcceptanceStatus),
  Notes, IsActive, CreatedDate/By, UpdatedDate/By
```

Full CRUD via `/api/ppm/deliverables/{projectId}/{id?}`.

## Credentials reference (usernames and env var names ONLY — no
## passwords appear in this file or anywhere in the repo)

| Environment | SQL admin login | Env var names on the Static Web App |
|---|---|---|
| DEV | `agsadmin` | `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` |
| TEST | `agsadmin` | same five |
| PROD | N/A — will use Managed Identity, not a SQL login | N/A |

Environment variable names must be typed in **exact uppercase** —
Azure does not warn on or normalize casing, and the Function code
reads `process.env.DB_SERVER` case-sensitively (this caused a real
bug during CHUNK 00 — see `DECISIONS.md` context).

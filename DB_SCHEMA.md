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
| 003 | `003_config_engine.sql` | **Not yet applied** | `cfg.ConfigCategories` + `cfg.ConfigValues` + seed data (Configuration Engine core, Module 05) |

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

All currently empty except `system` and `cmdb` — no business tables
exist yet (Portfolio, Project, RAID, etc. all come in later chunks
per `CURRENT_STATUS.md`).

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
UNIQUE (CategoryId, ValueCode)
```

Seeded with 7 categories (Project Type, Category, Size, Complexity,
Priority, Status, Health Status) matching Module 05's initial config
list, each with a handful of starter/example values — see
`003_config_engine.sql` for exact values. Organization (Module 01),
Numbering Rules (Module 06), and Lifecycle/Stage-Gate (Module 07)
are deliberately not modeled as `cfg.ConfigValues` rows — each needs
its own structure and gets its own future migration.

**Not yet applied to DEV or TEST** — migration 003 is code-complete
but has not been run through the Azure Portal Query Editor yet.

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

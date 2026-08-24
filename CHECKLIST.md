# CHECKLIST.md

Master build checklist for the Enterprise PMO Platform. This is the
single document to paste/upload into a new chat to resume work with
no loss of context.

## How to use this in a new chat

1. Paste or upload this file first.
2. Also upload the 8 companion docs from the repo root if available:
   `CLAUDE.md`, `PROJECT_SCOPE.md`, `PROJECT_CONTEXT.md`,
   `CURRENT_STATUS.md`, `DECISIONS.md`, `DB_SCHEMA.md`,
   `API_CONTRACTS.md`, `CHANGELOG.md` — this file is the fast
   at-a-glance summary; those are the detailed source of truth if
   anything here needs double-checking.
3. If available, also upload `ENTERPRISE_PPM_PROJECT_SCOPE (1).md` —
   the master framework document. Chunks 1–3 below are mapped from
   it in detail; Chunks 4–12 (Modules 08–40) are not itemized here
   because that level of detail wasn't retained verbatim in this
   handoff — re-read the source document before scoping those.
4. Say what you want to build next, or say "continue" and a
   reasonable next item will be picked from the first unchecked box.

## Stated preferences for this project (carry these forward)

- **Bundle related items together** rather than one small chunk at a
  time — this was explicitly requested to move faster, and worked
  well for Numbering + Lifecycle + Branding in one round.
- **Browser-only, always.** No local Node/npm/SSMS/git. Files are
  generated, then uploaded via GitHub's web UI. Migrations run via
  Azure Portal's Query Editor.
- **Verify with a screenshot before considering a step done** — this
  project has hit real bugs (partial pastes, CDN lag, reserved
  keywords) that "should have worked" but didn't; screenshots catch
  that before it compounds.
- **State scope before coding** (current version → target version,
  what's in/out of scope, files that will change) before building
  each round.

---

## Environment reference

```
Repo:   github.com/boscod35-rgb/agsppmdb

Branch mapping (confirmed against the master scope document):
  main  -> DEV   (permanent — not a historical accident)
  test  -> TEST
  prod  -> PROD  (branch doesn't exist yet — PROD not provisioned)

DEV
  Resource Group:  RG-PPM-DEV
  SQL Server:      ppm-sql-dev-ags.database.windows.net
  Database:        PPM_DEV
  SQL admin login: agsadmin  (password: not stored in any doc — see
                    Azure Portal Environment Variables on the
                    Static Web App)
  Static Web App:  AGSPPMDB
  URL:             https://brave-pond-00101191e.7.azurestaticapps.net

TEST
  Resource Group:  RG-PPM-TEST
  SQL Server:      ppm-sql-test-ags.database.windows.net
  Database:        PPM_TEST
  SQL admin login: agsadmin  (different password than DEV)
  Static Web App:  ppm-swa-test
  URL:             https://wonderful-rock-09b329e00.7.azurestaticapps.net

PROD
  Not provisioned. Deferred for cost reasons (deliberate, not an
  oversight). Will use Managed Identity instead of a SQL password
  when it's built.

Environment Variables required on each Static Web App
(exact uppercase names — casing mismatches fail silently):
  DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT
```

## Promoting DEV → TEST (code only)

GitHub → Pull requests → New pull request → base: `test` ← compare:
`main` → Create → Merge. This moves **code only**. It does **not**
run any SQL — each migration must still be applied to `PPM_DEV` and
`PPM_TEST` individually via the Query Editor.

## Known gotchas (don't rediscover these)

- Free-tier serverless databases auto-pause when idle; the first
  query after a pause can hang or fail once — wait ~60s and retry.
- Copy the **entire** migration file before pasting into the Query
  Editor. A partial paste can silently succeed (e.g. only create a
  schema, not its tables) with no error. Always check the
  verification query's actual output.
- `RowCount` fails as a column alias in T-SQL (tied to `SET
  ROWCOUNT`) — use `RecordCount` or similar instead.
- Azure Static Web Apps' CDN can lag several minutes behind a
  successful GitHub Actions build — a green checkmark doesn't mean
  the live site updated yet. Wait before troubleshooting.
- The "Allow Azure services" SQL firewall checkbox must be Saved
  explicitly on the SQL Server's own Networking blade — other
  wizard views of this setting are not always accurate.
- Not every Azure resource type offers the same region list (SQL
  Server offered Southeast Asia; Static Web Apps only offered East
  Asia in the same subscription) — check each resource type's own
  list rather than assuming one region works everywhere.

---

## Migration log

| # | File | Applied to | Contents |
|---|---|---|---|
| 001 | `001_initial_schema.sql` | DEV, TEST | 15 schemas + `system.SchemaVersions` + `system.AuditLog` |
| 002 | `002_cmdb.sql` | DEV, TEST | `cmdb.AzureResources` + 8 seed rows |
| 003 | `003_config_engine.sql` | DEV, TEST | `cfg.ConfigCategories` + `cfg.ConfigValues`, 7 categories seeded |
| 004 | `004_config_crud.sql` | DEV, TEST | `UpdatedDate`/`UpdatedBy` columns on `cfg.ConfigValues` |
| 005 | `005_organization.sql` | DEV, TEST | `org.BusinessUnits` + `org.Departments` + `org.Locations` |
| 006 | `006_numbering_lifecycle_branding.sql` | DEV, TEST | `cfg.NumberingRules` + `cfg.Lifecycles`/`cfg.LifecyclePhases` + `cfg.BrandThemes` |
| 007 | `007_portfolio_program_project.sql` | DEV, TEST | `ppm.Portfolios` + `ppm.Programs` + `ppm.Projects`; `PortfolioStatus`/`ProgramStatus`/`WorkspaceModules` config categories; Program numbering rule |

**Next migration number: 008.**
**Current version: v0.9.0. Next logical version: v0.10.0.**

---

## CHUNK 01 — Foundation & Environment (v0.1.0–v0.4.0)

- [x] Connectivity baseline (React → Azure Functions → Azure SQL) — DEV
- [x] Platform Foundations — TEST provisioned, PROD deliberately deferred
- [x] Application shell (top nav + Administration sub-nav)
- [ ] PROD environment (resource group, SQL Server + Managed
      Identity, Static Web App, Key Vault) — on hold for cost

## CHUNK 02 — Database Foundation + Configuration Engine (v0.2.0–v0.8.0)

- [x] Database Foundation — 15 schemas, `system.SchemaVersions`, `system.AuditLog`
- [x] CMDB Core (cross-cutting, not one of the 40 numbered modules) —
      Azure Info tab, 8 seeded resource records
- [x] Configuration Engine — core (Module 05) — 7 picklist categories
- [x] Configuration Engine — CRUD (Create/Edit/Deactivate)
- [x] Organization (Module 01) — Business Units, Departments, Locations
- [x] Numbering (Module 06) — rules per entity type, next-code preview
- [x] Lifecycle / Stage-Gate (Module 07) — Lifecycles + ordered Phases
- [~] Branding & Theme Engine (Section 106) — data model + management
      UI **done**; runtime application to the live app's actual
      colors/fonts **not done** — deliberately deferred, bigger/more
      invasive change, do as its own focused round
- [ ] Lifecycle Gates (approval requirements between phases) — only
      the phase structure itself was built, not gate requirements

## CHUNK 03 — Portfolio / Program / Project Core (Modules 02, 03, 04)

Done (v0.9.0, migration 007). Bundled together as one round per the
stated preference above.

- [x] Portfolio — Create/Edit/Archive, Business Unit mapping, owner,
      status, server-side pagination/search/filter/sort
- [x] Program — Portfolio mapping, Program Manager, status
- [x] Project — Portfolio mapping, **optional** Program mapping,
      Project Manager, variables (type/category/size/complexity/
      priority — pull from Config Engine's picklists built in Chunk
      02), Lifecycle assignment, business-visible ID (pull from
      Numbering rules built in Chunk 02), server-side
      pagination/search/filter/sort (framework explicitly calls for
      testing this with 250+ projects)
- [x] Project Workspace Shell — navigation only (Overview, Gap
      Assessment, Schedule, Resources, Financials, RAID, Governance,
      Audits, Documents, History) — visibility driven by which
      modules are enabled (WorkspaceModules config category), no
      module content yet

## CHUNK 04 onward — Modules 08–40

Not itemized in this checklist — re-read
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md` for the full breakdown before
scoping these. Known from the original framework document (broader
strokes, not the consolidated chunk numbers):

- [ ] WBS Core
- [ ] Schedule Core (Tasks, Milestones, dependencies)
- [ ] Baseline Engine (Original/Approved/Forecast/Actual, snapshots)
- [ ] RMG — Resource Directory, Staffing & Allocation, FTE variance
- [ ] Effort Integration (Task → Resource → Planned/Actual Effort)
- [ ] Financial Core (Budget/Forecast/Actual/Variance)
- [ ] Resource Cost (Hours × Rate)
- [ ] Commercial & Billing Engine
- [ ] RAID Core (Risk/Issue/Action/Assumption/Decision/Dependency)
- [ ] Cross-Project Dependencies
- [ ] Gap Assessment module (8 pillars, configurable)
- [ ] Health Engine (weighted, only enabled modules participate)
- [ ] Health Override (with reason/user/timestamp)
- [ ] Governance (Stage Gates, Approvals, Exceptions)
- [ ] Change Control (Request → Impact → Approval → Baseline Update)
- [ ] Audit Engine (Templates, Schedule, Findings, Closure)
- [ ] 360 Assessment (lightweight)
- [ ] Notifications
- [ ] Document Metadata
- [ ] Audit Trail wiring (system.AuditLog exists but nothing writes
      to it yet)
- [ ] Project Metrics Contract (standardized per-project metrics API)
- [ ] Program Roll-Up
- [ ] Portfolio Roll-Up
- [ ] Executive Dashboard
- [ ] Security / Entra ID / RBAC
- [ ] Benefits & Closure (Lessons Learned, Handover, PIR, Archive)
- [ ] Bulk Import / Onboarding (Excel/CSV, for the 250+ existing
      projects mentioned in the framework's scope)
- [ ] Integration Foundation (API contracts for Power BI, ServiceNow,
      Jira, Azure DevOps, HR, ERP, Timesheets, Teams, SharePoint)
- [ ] Branding & Theme Engine — runtime application (carried forward
      from Chunk 02, see above)
- [ ] PROD environment (carried forward from Chunk 01, see above)
- [ ] Automated regression test suite / CI gating (currently manual)
- [ ] GitHub Actions automation for running migrations against DEV/
      TEST automatically (currently manual via Query Editor —
      explicitly identified as a real gap, not yet scoped)

---

## Suggested next step

**Chunk 04 onward (Modules 08–40)** is next. Re-read
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md` before scoping it in detail —
this checklist doesn't itemize it verbatim. The natural starting
point is **WBS Core + Schedule Core (Tasks, Milestones,
dependencies)**, since those are the first modules that plug into
the Project Workspace Shell's tabs (built as an empty shell in
Chunk 03) and everything downstream (Baseline Engine, RMG effort
integration, Financials) depends on a schedule existing first.
Given the stated preference to bundle, WBS + Schedule Core could
reasonably go together in one round, same pattern as Chunks 02 and 03.

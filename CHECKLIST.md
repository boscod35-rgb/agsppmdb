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
| 008 | `008_intake_charter_templates.sql` | DEV, TEST | `ppm.ProjectTemplates` + `ppm.ProcessMatrixItems` + `ppm.ProjectIntakes` + `ppm.ProjectCharters`; `IntakeStatus`/`CharterApprovalStatus` config categories + `CHARTER` WorkspaceModules value; Intake numbering rule; `ppm.Projects.TemplateId` |
| 009 | `009_wbs_schedule_delivery.sql` | DEV, TEST | `ppm.WbsItems` + `ppm.ScheduleTasks` + `ppm.TaskDependencies` + `ppm.Milestones` + `ppm.Deliverables`; `WbsPathType`/`TaskStatus`/`DependencyType`/`MilestoneStatus`/`DeliverableAcceptanceStatus` config categories + `WBS` WorkspaceModules value |

**Next migration number: 010.**
**Current version: v0.11.0. Next logical version: v0.12.0.**

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

## CHUNK 04 — Project Intake, Charter & Templates (Modules 08, 09, 10, 11)

Done (v0.10.0, migration 008). QA verified end-to-end on DEV + TEST.
Bundled together as one round per the stated preference above.

- [x] Template Management (Module 08) — `ppm.ProjectTemplates`,
      Create/Edit/Archive under Administration -> Global Templates
- [x] Process Matrix (Module 11) — `ppm.ProcessMatrixItems`, ordered
      checklist nested under each Template. Instantiating onto a real
      project's WBS shipped in Chunk 05 (Generate from Template action)
- [x] Project Intake (Module 09) — `ppm.ProjectIntakes`,
      Create/Edit/Archive, plus a Convert to Project action that
      creates a real Project via the same Numbering pattern as
      direct project creation
- [x] Project Charter (Module 10) — `ppm.ProjectCharters`, one per
      Project, surfaced as the first real-content tab in the Project
      Workspace shell (Objectives/Scope/Assumptions/Constraints/
      Business Case, plus an Approve action)

**Note on this checklist's earlier Chunk 04 entry:** a prior version
of this file (and an earlier round of this project's own guidance)
mislabeled WBS + Schedule as "Chunk 04." Re-reading
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md` Section 7 directly confirmed
the master document's actual numbering: Chunk 04 is Intake/Charter/
Templates (Modules 08–11, above), and WBS + Schedule is **Chunk 05**
(Modules 12–15, below). This file now matches the master document.

## CHUNK 05 — WBS, Schedule & Delivery Planning (Modules 12, 13, 14, 15)

Done (v0.11.0, migration 009). Bundled together as one round per the
stated preference above.

- [x] WBS / Breakdown Checklist (Module 12) — `ppm.WbsItems`,
      self-referencing hierarchy per project with reorder (move
      up/down), completion checkbox, green/red/neutral path marker,
      own Workspace tab. Includes a Generate from Template action
      that instantiates a project's Template's Process Matrix items
      as real WBS items — closes the item deferred from Chunk 04.
- [x] Schedule Management (Module 13) — `ppm.ScheduleTasks` +
      `ppm.TaskDependencies` (FS/SS/FF/SF types), real content on
      the Schedule tab's Tasks sub-tab
- [x] Milestone & Phase-Gate Tracking (Module 14) — `ppm.Milestones`,
      optional tie to a project's Lifecycle Phases for phase gates,
      Approve action, Schedule tab's Milestones sub-tab
- [x] Deliverables Management (Module 15) — `ppm.Deliverables`,
      optional link to a Milestone, Schedule tab's Deliverables sub-tab

**Note on tab structure:** Milestones and Deliverables were not given
their own Workspace tabs — they live as sub-tabs inside the existing
Schedule tab alongside Tasks, matching how the master scope document's
own Chunk 05 text groups Modules 13–15 together. See `DECISIONS.md`
D016.

## CHUNK 06 — Resource / RMG (Modules 16–20)

Not started. Resource Master, Staffing & Allocation, Baseline vs
Actual, Capacity & Utilization, Skills/Competency Matrix.

## CHUNK 07 — Finance, Rate Card & Billing (Modules 21–25)

Not started. Cost Management, Rate Card Management, Effort
Management, Billing Calculation, Budget/Forecast/Variance.

## CHUNK 08 — RAID & Action Controls (Modules 26–30)

Not started. Risk, Issue, Dependency, Assumption, Action Item
management with aging/ownership/escalation and roll-ups.

## CHUNK 09 — Assessment & Gap Management (Modules 31, 32, 35)

Not started. 360 Assessment, Gap Assessment (8 pillars ->
sub-areas -> questions -> findings -> corrective action),
Corrective Action/CAPA.

## CHUNK 10 — Audit, Compliance & Governance (Modules 33, 34, 36)

Not started. Project Audit workflow, Compliance Tracking, Governance/
Review Management.

## CHUNK 11 — Documents, Notifications & Reporting (Modules 37–39)

Not started. Document Library, Dashboard & Reporting (project/
program/portfolio/enterprise), Notifications & Reminders.

## CHUNK 12 — Enterprise Controls, AI & Production Readiness (Module 40 + cross-cutting)

Not started. RBAC, security hardening, audit trail wiring, AI
assistant integration, end-to-end/regression testing, PROD
readiness, and all cross-cutting capabilities from Section 5 of the
master document.

---

## Suggested next step

**Chunk 06 — Resource / RMG (Modules 16–20)** is next, per
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md` Section 7: Resource Master,
Staffing & Allocation, Baseline vs Actual Resource Tracking, Capacity
& Utilization, Skills/Competency Matrix. Resource Master (16) and
Staffing & Allocation (17) are the natural pair to start with, since
Baseline vs Actual (18) and Capacity & Utilization (19) both need
real allocations to compare against or aggregate. Worth deciding
during scoping whether this round also wires resource assignment
onto the Schedule Tasks built in Chunk 05 (a task currently has no
assigned resource), since that's the natural connective tissue
between the two chunks.

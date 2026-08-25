# CURRENT_STATUS.md

What's actually built, right now, versus what's designed but not
built. Update this file as part of any chunk of work — it goes stale
fast if left for later.

Last updated: reflects Resource / RMG (v0.12.0) deployed to DEV and
TEST (pending QA walkthrough). Chunk labels use the consolidated
12-chunk roadmap (`DECISIONS.md` D010).

## Chunk status

Roadmap is 40 modules across 12 chunks — see `PROJECT_SCOPE.md` and
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md`. Sub-rows show what each chunk
absorbed from this repo's earlier ad hoc numbering.

| Chunk | Version | Status | Notes |
|---|---|---|---|
| **Chunk 01 — Foundation & Environment** | v0.1.0–v0.4.0 | Done for DEV/TEST | absorbs former CHUNK 00, 00.5, Application Shell |
| ↳ Connectivity Baseline | v0.1.0 | Done, frozen | React -> Azure Functions -> Azure SQL proven on DEV |
| ↳ Platform Foundations | v0.1.5 | Partial | DEV + TEST fully provisioned; **PROD deferred (cost)** |
| ↳ Application Shell | v0.4.0 | Done | Main nav + Administration sub-nav, DEV + TEST |
| **Chunk 02 — Database Foundation + Configuration Engine** | v0.2.0–v0.8.0 | **Done** (except Branding runtime) | absorbs former CHUNK 01, 02.5 |
| ↳ Database Foundation | v0.2.0 | Done | 15 schemas + system.SchemaVersions + system.AuditLog, applied to DEV + TEST |
| ↳ CMDB Core (cross-cutting, delivered early) | v0.3.5 | Done | cmdb schema, cmdb.AzureResources, API, seed data, Azure Info UI — DEV + TEST |
| ↳ Configuration Engine — core (Module 05) | v0.5.0 | Done | `cfg.ConfigCategories` + `cfg.ConfigValues`, GET APIs, Configuration UI — migration 003 |
| ↳ Configuration Engine — CRUD | v0.6.0 | Done | Create/Update/Deactivate for config values via UI — migration 004 |
| ↳ Organization (Module 01) | v0.7.0 | Done | `org.BusinessUnits`/`Departments`/`Locations` — migration 005 |
| ↳ Numbering (Module 06) | v0.8.0 | Done | `cfg.NumberingRules` — migration 006 |
| ↳ Lifecycle / Stage-Gate (Module 07) | v0.8.0 | Partial | Phase structure done; Lifecycle Gates (approvals between phases) not built — migration 006 |
| ↳ Section 106 — Branding & Theme Engine | v0.8.0 | Partial | Data model + management UI done; **runtime application to the live app deferred** — its own focused round |
| **Chunk 03 — Portfolio / Program / Project Core** | v0.9.0 | **Done, QA verified end-to-end on DEV + TEST** | Modules 02, 03, 04 — migration 007 |
| ↳ Portfolio | v0.9.0 | Done | Create/Edit/Archive, Business Unit mapping, owner, status |
| ↳ Program | v0.9.0 | Done | Portfolio mapping, Program Manager, status |
| ↳ Project | v0.9.0 | Done | Portfolio + optional Program mapping, PM, all Chunk 02 picklists, Lifecycle assignment, business-visible ID, server-side pagination/search/filter/sort |
| ↳ Project Workspace Shell | v0.9.0 | Done (shell only at the time; Charter, WBS, Schedule, Resources tabs got real content in later chunks) | Nav tabs driven by WorkspaceModules config |
| **Chunk 04 — Project Intake, Charter & Templates** | v0.10.0 | **Done, QA verified end-to-end on DEV + TEST** | Modules 08, 09, 10, 11 — migration 008 |
| ↳ Template Management | v0.10.0 | Done | `ppm.ProjectTemplates` + nested Process Matrix items, Administration -> Global Templates UI |
| ↳ Process Matrix | v0.10.0 | Done | `ppm.ProcessMatrixItems`, ordered checklist per Template. Instantiating onto a real project's WBS shipped in Chunk 05 |
| ↳ Project Intake | v0.10.0 | Done | `ppm.ProjectIntakes` + Convert to Project action |
| ↳ Project Charter | v0.10.0 | Done | `ppm.ProjectCharters`, first real content in the Project Workspace shell (Charter tab) |
| **Chunk 05 — WBS, Schedule & Delivery Planning** | v0.11.0 | **Done, QA verified end-to-end on DEV + TEST** | Modules 12, 13, 14, 15 — migration 009 |
| ↳ WBS / Breakdown Checklist | v0.11.0 | Done | `ppm.WbsItems`, hierarchy + reorder + checkbox + green/red path, own Workspace tab. Includes Generate from Template action (closes Chunk 04's deferred item) |
| ↳ Schedule Management | v0.11.0 | Done | `ppm.ScheduleTasks` + `ppm.TaskDependencies`, real content on the Schedule tab (Tasks sub-tab) |
| ↳ Milestone & Phase-Gate Tracking | v0.11.0 | Done | `ppm.Milestones`, ties to `cfg.LifecyclePhases`, Approve action, Schedule tab (Milestones sub-tab) |
| ↳ Deliverables Management | v0.11.0 | Done | `ppm.Deliverables`, optional Milestone link, Schedule tab (Deliverables sub-tab) |
| **Chunk 06 — Resource / RMG** | v0.12.0 | **Deployed to DEV + TEST — awaiting QA walkthrough** | Modules 16, 17, 18, 19, 20 — migration 010 |
| ↳ Resource Master | v0.12.0 | Done | `ppm.Resources`, business-visible `RES-#####` ID, Administration -> RMG / Resources UI |
| ↳ Staffing & Allocation | v0.12.0 | Done | `ppm.ResourceAllocations` (Planned %), real content on the Project Workspace's Resources tab |
| ↳ Baseline vs Actual Resource Tracking | v0.12.0 | Done | Same `ppm.ResourceAllocations` table's Actual % column, reconciled via the allocation's own edit form |
| ↳ Capacity & Utilization | v0.12.0 | Done | Derived report (`GET /api/ppm/resources/{id}/utilization`), no stored table |
| ↳ Skills / Competency Matrix | v0.12.0 | Done | `ppm.ResourceSkills`, skill + proficiency reuse the Configuration Engine, shown on the Resource Master page |
| **Chunk 07 onward** | — | Not started | Modules 21–40; see master framework doc for full breakdown |

## What works right now, per environment

| | DEV | TEST | PROD |
|---|---|---|---|
| Static Web App | ✓ `AGSPPMDB` | ✓ `ppm-swa-test` | Not provisioned |
| SQL Server + DB | ✓ `ppm-sql-dev-ags` / `PPM_DEV` | ✓ `ppm-sql-test-ags` / `PPM_TEST` | Not provisioned |
| `/api/health` | ✓ | ✓ | — |
| `/api/db-test` | ✓ | ✓ | — |
| `/api/cmdb/azure-resources` | ✓ | ✓ | — |
| `/api/config/categories` | ✓ | ✓ | — |
| `/api/config/values` | ✓ | ✓ | — |
| `/api/org/{resource}` | ✓ | ✓ | — |
| `/api/config/numbering` | ✓ | ✓ | — |
| `/api/config/lifecycle` | ✓ | ✓ | — |
| `/api/ppm/portfolios` | ✓ | ✓ | — |
| `/api/ppm/programs` | ✓ | ✓ | — |
| `/api/ppm/projects` | ✓ | ✓ | — |
| Application shell (nav) | ✓ | ✓ | — |
| CMDB -> Azure Info page | ✓ | ✓ | — |
| Administration -> System Health page | ✓ | ✓ | — |
| Administration -> Project Configuration page | ✓ | ✓ | — |
| Administration -> Organization / Numbering / Lifecycle / Branding pages | ✓ | ✓ | — |
| Portfolio / Programs / Projects pages | ✓ | ✓ | — |
| Project Workspace shell (Charter tab has real content; rest are placeholders) | ✓ | ✓ | — |
| `/api/ppm/templates` (+ nested `/items`) | ✓ | ✓ | — |
| `/api/ppm/intakes` (+ `/convert`) | ✓ | ✓ | — |
| `/api/ppm/charters` (+ `/approve`) | ✓ | ✓ | — |
| Intake page, Administration -> Global Templates page | ✓ | ✓ | — |
| `/api/ppm/wbs` (+ toggle/move/generate-from-template) | ✓ | ✓ | — |
| `/api/ppm/schedule/tasks` (+ nested `/dependencies`) | ✓ | ✓ | — |
| `/api/ppm/milestones` (+ `/approve`) | ✓ | ✓ | — |
| `/api/ppm/deliverables` | ✓ | ✓ | — |
| Project Workspace WBS + Schedule tabs (real content) | ✓ | ✓ | — |
| `/api/ppm/resources` (+ `/utilization`, nested `/skills`) | ✓ | ✓ | — |
| `/api/ppm/allocations` | ✓ | ✓ | — |
| RMG / Resources page, Project Workspace Resources tab | ✓ | ✓ | — |

## URLs (also recorded in `cmdb.AzureResources` — check there first,
## this table can go stale)

- DEV: `https://brave-pond-00101191e.7.azurestaticapps.net`
- TEST: `https://wonderful-rock-09b329e00.7.azurestaticapps.net`
- PROD: does not exist yet

## What's explicitly NOT built yet

- Any module 21–40 content (Financials, RAID, Governance, Audit, Gap
  Assessment, etc.) — all show as greyed-out placeholders in the
  shell nav; the Project Workspace's remaining tabs (Gap Assessment,
  Financials, RAID, Governance, Audits, Documents, History) are a
  nav shell only, no content
- Task-level effort/hours (Task → Resource → Planned/Actual Effort,
  Module 23) — resource allocations stay at the project level this
  chunk, not assigned to individual Schedule Tasks yet
- Rate cards / resource cost — Chunk 07
- Baseline Engine (Original/Approved/Forecast/Actual snapshots for
  Schedule/Financials) — Chunk 07 territory, distinct from the
  Planned/Actual columns Chunk 06 added to Resource Allocations
- Gantt-style visual scheduling — the Schedule tab is list-based
- Lifecycle Gates (approval requirements between phases) — only the
  phase structure itself was built (Milestones can now optionally
  mark themselves as a phase gate and tie to a Lifecycle Phase, but
  there's no requirement/enforcement layer yet)
- Branding & Theme Engine runtime application — data model + UI are
  done, but the live app doesn't read its colors/fonts from
  `cfg.BrandThemes` yet (deliberately deferred, its own round)
- CMDB tabs other than Azure Info (Environments, Repositories,
  Credentials Reference, Contacts — structural placeholders only)
- Authentication / RBAC — Charter, Milestone Phase-Gate approvals
  currently accept any typed-in approver name, same no-auth
  convention as everywhere else
- Any CI/CD gating beyond the Azure-generated GitHub Actions build
  step (no automated test suite, no PR-based gating yet)
- PROD environment entirely

## Known gaps carried forward

- Static Web Apps' DEV resource (`AGSPPMDB`) still deploys from the
  `main` branch — confirmed intentional and permanent, not a gap to
  fix (see `DECISIONS.md` D003, resolved against the master scope
  document).
- No automated regression test suite exists — the framework's
  Regression Test Registry (Section 96) is currently a manual
  checklist, not executable tests.
- Azure Static Web Apps' CDN can lag several minutes behind a
  successful GitHub Actions deploy — a green build does not always
  mean the live site has updated yet, even in an incognito window.
  Seen during Configuration Engine deployment: the page showed the
  old placeholder for a few minutes after a confirmed-successful
  build before updating on its own. Wait before assuming a
  successful build has actually gone wrong.
- Copy the **entire** contents of a migration file before pasting
  into the Query Editor — a partial paste can silently succeed
  (e.g. only creating a schema, not its tables) without any error
  indicating the script was incomplete. Always check the
  verification query's actual output, not just "Query executed
  successfully" in the Messages tab.

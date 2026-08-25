# CHANGELOG.md

Version history, per framework Section 100. Newest first.

**Note:** Entries below use this repo's original ad hoc chunk labels
(`CHUNK 00`, `00.5`, `01`, `02.5`) as they were recorded at the time
and are left as-is — this is a historical record. Those labels have
since been consolidated onto the 12-chunk master roadmap; see
`DECISIONS.md` D010 for the mapping and `CURRENT_STATUS.md` for
current chunk numbering.

---

## v0.12.0 — Resource / RMG (Chunk 06)

**Added**
- `ppm.Resources` (migration `010_resource_rmg.sql`) — the resource
  master (Module 16): name, email, Business Unit, Type, Role,
  default weekly capacity, business-visible `RES-#####` ID via the
  same transactional Numbering pattern as every other entity (D012)
- `ppm.ResourceAllocations` — does double duty for Modules 17
  (Staffing & Allocation) and 18 (Baseline vs Actual): one row per
  resource-per-project with both `PlannedAllocationPercent` and
  `ActualAllocationPercent` columns, rather than a separate
  snapshot/versioning table (see D017)
- Module 19 (Capacity & Utilization) — **no new table.**
  `GET /api/ppm/resources/{id}/utilization` computes total
  planned/actual allocation percent across all of a resource's
  active project allocations and flags over-allocation (>100%) on
  demand (see D018)
- `ppm.ResourceSkills` (Module 20) — skill + proficiency reuse the
  Configuration Engine (new `Skill`, `SkillProficiencyLevel`
  categories, see D019); a filtered unique index allows a removed
  skill to be re-added later without a leftover inactive row
  blocking it
- New Config Engine categories: `ResourceType`, `ResourceRole`,
  `AllocationStatus`, `Skill`, `SkillProficiencyLevel`
- New Numbering rule: `Resource`
- `GET/POST/PUT/DELETE /api/ppm/resources/{id?}/{sub?}/{subId?}`
  (+ `GET /{id}/utilization`, nested `skills` sub-route)
- `GET/POST/PUT/DELETE /api/ppm/allocations/{projectId}/{id?}`
  (project-scoped, mirrors the milestones.js/deliverables.js pattern)
- `src/pages/ResourcesPage.jsx` — Resource Master admin page (list/
  create/archive, expandable rows showing utilization + skills
  matrix); wired to the `RMG / Resources` top-level nav item that
  had sat as an unbuilt placeholder since the application shell
- `src/pages/ProjectWorkspacePage.jsx` — the `RESOURCES` tab (seeded
  since migration 007, never used) now shows real content: this
  project's staffed resources with planned/actual % and archive

**Database**
- Migration `010_resource_rmg.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**Out of scope (documented, not a gap)**
- Task-level effort/hours (Task → Resource → Planned/Actual Effort)
  — Module 23, Chunk 07. This chunk's allocations stay at the
  project level; a resource is staffed on a project at some percent,
  not yet assigned to individual Schedule Tasks
- Rate cards / resource cost — Chunk 07
- A company-wide capacity dashboard — closer to Module 38
  (Dashboard & Reporting), Chunk 11; this chunk's utilization view is
  per-resource, not aggregated

---

## v0.11.0 — WBS, Schedule & Delivery Planning (Chunk 05)

**Added**
- `ppm.WbsItems` (migration `009_wbs_schedule_delivery.sql`) —
  self-referencing hierarchy per project (Module 12): reorder via
  `move-up`/`move-down` (swaps `SequenceOrder` with the adjacent
  sibling), `IsComplete` checkbox, `PathTypeValueId` for the green/
  red/neutral decision-path marker. Archiving a parent recursively
  archives its descendants (CTE) so nothing orphaned stays visible.
- `ppm.ScheduleTasks` + `ppm.TaskDependencies` (Module 13) — tasks
  with dates/percent-complete/status, dependency links between tasks
  (Finish-to-Start/Start-to-Start/Finish-to-Finish/Start-to-Finish),
  self-dependency and duplicate-link blocked at the DB level
  (`CK_TaskDependencies_NotSelf`, `UQ_TaskDependencies`)
- `ppm.Milestones` (Module 14) — including phase-gate milestones
  optionally tied to a project's `cfg.LifecyclePhases` (Chunk 02),
  with an Approve action (same free-text-approver pattern as
  Charter — see D013)
- `ppm.Deliverables` (Module 15) — owner, planned/actual date,
  acceptance status, optional link to a Milestone
- New Config Engine categories: `WbsPathType`, `TaskStatus`,
  `DependencyType`, `MilestoneStatus`, `DeliverableAcceptanceStatus`
- New `WorkspaceModules` value: `WBS` (its own tab). The existing
  `SCHEDULE` tab (seeded migration 007) now hosts Tasks/Dependencies/
  Milestones/Deliverables together as sub-tabs, matching how the
  framework's own Chunk 05 scope groups Modules 13-15.
- **Closes the Chunk 04 "template-to-project generation" gap**
  (D014/migration 008 notes): `POST /api/ppm/wbs/{projectId}/generate-from-template`
  reads the project's `TemplateId` and instantiates its active
  Process Matrix items as top-level WBS items. Only runs on an empty
  WBS — never silently duplicates (see D015).
- `GET/POST/PUT/DELETE /api/ppm/wbs/{projectId}/{itemId?}/{action?}`
  (+ `toggle`, `move-up`, `move-down`, `generate-from-template`)
- `GET/POST/PUT/DELETE /api/ppm/schedule/tasks/{projectId}/{taskId?}/{sub?}/{subId?}`
  (`sub` = `dependencies`)
- `GET/POST/PUT/DELETE /api/ppm/milestones/{projectId}/{id?}` + `POST /{id}/approve`
- `GET/POST/PUT/DELETE /api/ppm/deliverables/{projectId}/{id?}`
- `src/pages/ProjectWorkspacePage.jsx` — WBS and Schedule tabs now
  render real content (`WbsPanel`, `SchedulePanel`) instead of
  placeholders; every other tab unchanged

**Database**
- Migration `009_wbs_schedule_delivery.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**Out of scope (documented, not a gap)**
- Baseline Engine (Original/Approved/Forecast/Actual snapshots) — Chunk 06
- RMG resource assignment to Schedule Tasks — Chunk 06
- Gantt-style visual scheduling — the Schedule tab is list-based this round
- Linking WBS items to Schedule Tasks — they remain two independent
  structures; WBS is the breakdown checklist, Schedule is the
  dated/dependency-tracked task list

---

## v0.10.0 — Project Intake, Charter & Templates (Chunk 04)

**Added**
- `ppm.ProjectTemplates` + `ppm.ProcessMatrixItems` (migration
  `008_intake_charter_templates.sql`) — templates own an ordered
  Process Matrix checklist, same nested-items pattern as
  `cfg.Lifecycles`/`LifecyclePhases`
- `ppm.ProjectIntakes` — pre-project requests with a **Convert to
  Project** action (`POST /api/ppm/intakes/{id}/convert`) that
  creates a real `ppm.Projects` row using the same transactional
  Numbering pattern as direct project creation (D012); carries
  forward the intake's Type/Category/Priority/Template onto the new
  project and stamps the intake `CONVERTED`
- `ppm.ProjectCharters` — one per Project (`UNIQUE` on `ProjectId`);
  the first Project Workspace tab to get real content instead of a
  placeholder (Objectives/Scope/Assumptions/Constraints/Business
  Case, plus an Approve action)
- `cfg.ConfigCategories`/`Values` additions: `IntakeStatus`,
  `CharterApprovalStatus`, and one new `WorkspaceModules` value
  (`CHARTER`) — same reuse-the-generic-engine approach as D011
- `cfg.NumberingRules` — added the missing `Intake` rule (`Portfolio`,
  `Program`, `Project` rules already existed)
- `ppm.Projects.TemplateId` (nullable) — additive column recording
  which template a project was created from; **does not** instantiate
  the template's Process Matrix as an actual WBS checklist on the
  project — that's Module 12 (WBS), Chunk 05
- `GET/POST/PUT/DELETE /api/ppm/templates/{id?}/{sub?}/{subId?}`
  (`sub`/`subId` = nested `items` sub-route for Process Matrix items)
- `GET/POST/PUT/DELETE /api/ppm/intakes/{id?}` + `POST /{id}/convert`
- `GET/POST/PUT /api/ppm/charters/{projectId}` + `POST /{projectId}/approve`
- `POST/PUT /api/ppm/projects` gained an optional `templateCode` field
- `src/pages/TemplatesPage.jsx` — list/create/archive templates with
  an inline Process Matrix item editor
- `src/pages/IntakePage.jsx` — list/create/archive intakes with a
  Convert-to-Project panel
- `src/pages/ProjectWorkspacePage.jsx` — Charter tab now renders a
  real `CharterPanel` (view/edit/approve) instead of a placeholder;
  every other tab is unchanged
- `src/App.jsx` — new `Intake` top-level nav item; `Global Templates`
  under Administration flipped from placeholder to built

**Database**
- Migration `008_intake_charter_templates.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**Out of scope (documented, not a gap)**
- Generating a real WBS checklist from a Template's Process Matrix
  onto a specific project — Module 12, Chunk 05
- RBAC-gated Charter approval (anyone can currently approve; there is
  no auth system yet, consistent with every other module)

---

## v0.9.0 — Portfolio / Program / Project Core (Chunk 03)

**Added**
- `ppm.Portfolios`, `ppm.Programs`, `ppm.Projects` tables (migration
  `007_portfolio_program_project.sql`) — the first business-data
  tables in the platform; everything before this chunk was
  configuration scaffolding
- `cfg.ConfigCategories`/`cfg.ConfigValues` additions: `PortfolioStatus`,
  `ProgramStatus`, and `WorkspaceModules` — the last of these drives
  which Project Workspace tabs render, reusing the existing generic
  Configuration Engine and its existing Deactivate button as an
  on/off switch instead of a bespoke table (see `DECISIONS.md` D011)
- `cfg.NumberingRules` — added the missing `Program` rule (`Portfolio`
  and `Project` rules were already seeded by migration 006)
- Real business-visible ID generation: creating a Portfolio, Program,
  or Project now atomically increments `cfg.NumberingRules.CurrentSequence`
  inside the same SQL transaction as the insert (previously only a
  non-incrementing preview existed — see `DECISIONS.md` D012)
- `GET/POST/PUT/DELETE /api/ppm/portfolios/{id?}`
- `GET/POST/PUT/DELETE /api/ppm/programs/{id?}` (`?portfolio=CODE` filter)
- `GET/POST/PUT/DELETE /api/ppm/projects/{id?}` — list supports
  `page`, `pageSize`, `search`, `status`, `portfolio`, `program`,
  `sortBy`, `sortDir`, `includeInactive`, indexed for the framework's
  explicit 250+ project requirement
- `src/pages/PortfolioPage.jsx`, `src/pages/ProgramPage.jsx`,
  `src/pages/ProjectsPage.jsx` — Create/Edit/Archive UI (Archive =
  `IsActive = 0`, same soft-delete convention as every other module)
- `src/pages/ProjectWorkspacePage.jsx` — navigation shell only
  (Overview, Gap Assessment, Schedule, Resources, Financials, RAID,
  Governance, Audits, Documents, History tabs); every tab shows a
  placeholder, no module content yet
- `src/App.jsx` — Portfolio, Programs, Projects nav items flipped
  from placeholder to `built: true`

**Database**
- Migration `007_portfolio_program_project.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**QA**
- Verification query confirmed 4 PortfolioStatus values, 5 ProgramStatus
  values, 10 WorkspaceModules values, 1 new Program numbering rule,
  and all three `ppm` tables present on both DEV and TEST
- Created a Portfolio, a Program under it, and a Project under both —
  confirmed generated codes (`PF-`, `PG-`, `PRJ-` prefixes) matched
  the Numbering UI's preview pattern and incremented correctly on a
  second create
- Confirmed archiving a Project keeps it queryable via
  `includeInactive=true` and hides it from the default list

**Out of scope (documented, not a gap)**
- Lifecycle Gates (approval requirements between phases) — carried
  forward from Chunk 02
- Any content behind the Project Workspace tabs — Chunk 04 onward
- Bulk import of the 250+ existing projects — later, once a real
  onboarding module is scoped

---

## v0.8.0 — Numbering, Lifecycle, Branding (backfill entry)

Applied earlier in this project's history but not recorded in this
file at the time — added retroactively so the version history stays
continuous. See `database/migrations/006_numbering_lifecycle_branding.sql`
for full detail.

**Added**
- `cfg.NumberingRules` (Module 06) with Project/Risk/Issue/Portfolio
  starter rules
- `cfg.Lifecycles` + `cfg.LifecyclePhases` (Module 07) with a
  Standard Project Lifecycle starter (Initiation/Planning/Execution/Closure)
- `cfg.BrandThemes` (Section 106) — data model + management UI only;
  not yet applied to the live app's actual colors/fonts
- `src/pages/NumberingPage.jsx`, `src/pages/LifecyclePage.jsx`,
  `src/pages/BrandingPage.jsx`

**Database**
- Migration `006_numbering_lifecycle_branding.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

---

## v0.7.0 — Organization (backfill entry)

Applied earlier in this project's history but not recorded in this
file at the time — added retroactively so the version history stays
continuous. See `database/migrations/005_organization.sql` for full detail.

**Added**
- `org.BusinessUnits`, `org.Departments`, `org.Locations` (Module 01)
- `GET/POST/PUT/DELETE /api/org/{resource}/{id?}` (resource = one of
  `business-units`, `departments`, `locations`)
- `src/pages/OrganizationPage.jsx`

**Database**
- Migration `005_organization.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

---

## v0.6.0 — Configuration Engine CRUD

**Added**
- `UpdatedDate`, `UpdatedBy` columns on `cfg.ConfigValues` (migration
  `004_config_crud.sql`)
- `POST /api/config/values` — create
- `PUT /api/config/values/{id}` — update
- `DELETE /api/config/values/{id}` — soft-delete (`IsActive = 0`,
  never a hard delete — history stays recoverable)
- Setting a value as Default automatically un-defaults the previous
  default in that category (enforced server-side, not just in the UI)
- `src/pages/ConfigurationPage.jsx` — Add/Edit/Deactivate UI added
  on top of the existing read-only table

**Database**
- Migration `004_config_crud.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**QA**
- Verified end-to-end on DEV: created a test value, confirmed it
  appeared with correct fields, deactivated it, confirmed it showed
  "Inactive" and lost its Deactivate button while remaining visible
  (not deleted)
- TEST confirmed showing the same Add/Edit/Deactivate controls and
  behavior after promotion from `main` via `main` -> `test`

**Decisions**
- Chose GitHub's built-in branch-compare/merge (main -> test) over
  building a GitHub Actions auto-sync workflow, since no automated
  test suite exists yet to gate an automation on — see reasoning in
  conversation; revisit once a real regression suite exists

---

## v0.5.0 — Configuration Engine (Module 05) — deployed

**Added**
- `cfg.ConfigCategories`, `cfg.ConfigValues` tables (migration
  `003_config_engine.sql`)
- Seed data: 7 categories (Project Type, Category, Size, Complexity,
  Priority, Status, Health Status), each with 3–5 starter values
- `GET /api/config/categories`, `GET /api/config/values` endpoints
- `src/pages/ConfigurationPage.jsx` — read-only picklist viewer
  under Administration -> Project Configuration
- `src/App.jsx` — Project Configuration entry flipped from
  placeholder to `built: true`

**Database**
- Migration `003_config_engine.sql` applied to DEV, then TEST

**Deployed to:** DEV, TEST

**QA**
- Verification query confirmed 7 categories with correct value
  counts (4/4/4/4/4/5/3) on both DEV and TEST
- Administration -> Project Configuration renders correctly on both
  environments, all 7 category filter chips functional

**Known Issues**
- One migration run required a re-attempt after a partial paste
  only created the `cfg` schema without its tables — resolved by
  re-running the complete file (idempotent, no cleanup needed)
- Azure Static Web Apps CDN lag caused the DEV deployment to
  temporarily appear unchanged for several minutes after a
  successful build — resolved by waiting, not a code issue

---

## v0.4.0 — Application Shell

**Added**
- Main navigation shell (framework Section 87): Home + Administration
  functional, all other top-level areas shown as labeled placeholders
- Administration sub-navigation (Section 88): CMDB -> Azure Info and
  System Health functional, remaining Settings areas shown as
  placeholders
- `src/pages/HomePage.jsx`, `AzureInfoPage.jsx`, `SystemHealthPage.jsx`,
  `PlaceholderPage.jsx`
- Original single-page connectivity test relocated into
  `SystemHealthPage.jsx` under Administration, rather than being the
  entire application

**Changed**
- `src/App.jsx` — full rewrite from single connectivity-test page to
  shell + view router (state-based, no router library — see
  `DECISIONS.md` D007)
- `src/App.css` — shell layout, nav, table, and detail-panel styles added

**Deployed to:** DEV, TEST

**QA**
- Shell renders correctly on both environments
- CMDB -> Azure Info loads and filters correctly by environment
- System Health's Test API / Test Database buttons still functional
  after relocation

---

## v0.3.5 — CMDB Core (data layer + API + UI)

**Added**
- `cmdb` schema, `cmdb.AzureResources` table (migration
  `002_cmdb.sql`)
- Seed data: 8 records (AZR-00001 through AZR-00008) documenting the
  actual DEV and TEST Azure resources
- `GET /api/cmdb/azure-resources` endpoint
- Azure Info UI (later relocated into the shell in v0.4.0)

**Database**
- Migration `002_cmdb.sql` applied to DEV, TEST

**QA**
- 8 rows returned and correctly attributed to DEV/TEST on both
  environments

---

## v0.2.0 — Database Foundation

**Added**
- 15 logical schemas: `cfg`, `org`, `ppm`, `schedule`, `resource`,
  `finance`, `raid`, `gov`, `audit`, `assessment`, `workflow`,
  `notify`, `document`, `security`, `system`
- `system.SchemaVersions`, `system.AuditLog`

**Database**
- Migration `001_initial_schema.sql` applied to DEV, TEST

**QA**
- Verification query confirmed 15 schemas + 1 migration record on
  both databases

---

## v0.1.5 — Platform Foundations (partial)

**Added**
- `RG-PPM-TEST` resource group
- `ppm-sql-test-ags` SQL Server + `PPM_TEST` database (free
  serverless tier)
- `ppm-swa-test` Static Web App, deploying from the `test` branch
- Environment Variables configured on `ppm-swa-test` (`DB_SERVER`,
  `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`)

**QA**
- TEST: Frontend ONLINE / API ONLINE / Database CONNECTED (`PPM_TEST`)

**Known Issues**
- PROD not provisioned — deliberately deferred for cost (see
  `DECISIONS.md` D002)
- TEST's Static Web App region (East Asia) differs from its SQL
  Server's region (Southeast Asia) — see `DECISIONS.md` D008

---

## v0.1.0 — Connectivity Baseline

**Added**
- React frontend (Vite), Azure Functions API, Azure SQL — end-to-end
  connectivity proven
- `GET /api/health`, `GET /api/db-test`
- `RG-PPM-DEV`, `ppm-sql-dev-ags`, `PPM_DEV`, `AGSPPMDB` Static Web App

**QA**
- DEV: Frontend ONLINE / API ONLINE / Database CONNECTED (`PPM_DEV`)

**Frozen as baseline** — no further direct changes to this
connectivity chain; subsequent work builds on top of it.

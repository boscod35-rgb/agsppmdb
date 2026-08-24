# CHANGELOG.md

Version history, per framework Section 100. Newest first.

**Note:** Entries below use this repo's original ad hoc chunk labels
(`CHUNK 00`, `00.5`, `01`, `02.5`) as they were recorded at the time
and are left as-is — this is a historical record. Those labels have
since been consolidated onto the 12-chunk master roadmap; see
`DECISIONS.md` D010 for the mapping and `CURRENT_STATUS.md` for
current chunk numbering.

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

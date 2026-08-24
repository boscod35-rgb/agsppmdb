# CURRENT_STATUS.md

What's actually built, right now, versus what's designed but not
built. Update this file as part of any chunk of work — it goes stale
fast if left for later.

Last updated: reflects state as of Application Shell (v0.4.0),
renumbered onto the consolidated 12-chunk roadmap (`DECISIONS.md`
D010). Version numbers (`v0.x.x`) are unchanged; only chunk labels
were consolidated — no rework occurred.

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
| **Chunk 02 — Database Foundation + Configuration Engine** | v0.2.0–v0.3.5 | Partial | absorbs former CHUNK 01, 02.5; Configuration Engine itself not started |
| ↳ Database Foundation | v0.2.0 | Done | 15 schemas + system.SchemaVersions + system.AuditLog, applied to DEV + TEST |
| ↳ CMDB Core (cross-cutting, delivered early) | v0.3.5 | Done | cmdb schema, cmdb.AzureResources, API, seed data, Azure Info UI — DEV + TEST |
| ↳ Configuration Engine — core (Module 05) | v0.5.0 | **Built, not yet deployed** | `cfg.ConfigCategories` + `cfg.ConfigValues`, 7 seeded categories, GET APIs, Configuration UI — code complete, migration 003 not yet run on DEV/TEST |
| ↳ Configuration Engine — CRUD | — | Not started | Create/Update/Delete for config values via UI |
| ↳ Organization (Module 01), Numbering (Module 06), Lifecycle (Module 07) | — | Not started | Each needs its own structure, not the generic category/value pattern |
| ↳ Section 106 — Branding & Theme Engine | — | Designed, not built | Folds into Chunk 02 per D009 |
| **Chunk 03 — Portfolio / Program / Project Core** | — | Not started | Modules 02, 03, 04 |
| **Chunk 04 onward** | — | Not started | Modules 08–40; see master framework doc for full breakdown |

## What works right now, per environment

| | DEV | TEST | PROD |
|---|---|---|---|
| Static Web App | ✓ `AGSPPMDB` | ✓ `ppm-swa-test` | Not provisioned |
| SQL Server + DB | ✓ `ppm-sql-dev-ags` / `PPM_DEV` | ✓ `ppm-sql-test-ags` / `PPM_TEST` | Not provisioned |
| `/api/health` | ✓ | ✓ | — |
| `/api/db-test` | ✓ | ✓ | — |
| `/api/cmdb/azure-resources` | ✓ | ✓ | — |
| Application shell (nav) | ✓ | ✓ | — |
| CMDB -> Azure Info page | ✓ | ✓ | — |
| Administration -> System Health page | ✓ | ✓ | — |

## URLs (also recorded in `cmdb.AzureResources` — check there first,
## this table can go stale)

- DEV: `https://brave-pond-00101191e.7.azurestaticapps.net`
- TEST: `https://wonderful-rock-09b329e00.7.azurestaticapps.net`
- PROD: does not exist yet

## What's explicitly NOT built yet

- Any business module (Portfolio, Program, Project, WBS, Schedule,
  RMG, Financials, RAID, Governance, Audit, Gap Assessment, etc.) —
  all show as greyed-out placeholders in the shell nav
- Generic Configuration Engine (Chunk 02) — core is code-complete
  (migration 003, GET APIs, Configuration UI) but **not yet deployed**;
  Create/Update/Delete and Organization/Numbering/Lifecycle remain
  unbuilt regardless
- Branding & Theme Engine (Section 106 — designed only)
- CMDB tabs other than Azure Info (Environments, Repositories,
  Credentials Reference, Contacts — structural placeholders only)
- Authentication / RBAC
- Any CI/CD gating beyond the Azure-generated GitHub Actions build
  step (no automated test suite, no PR-based gating yet)
- PROD environment entirely

## Known gaps carried forward

- Static Web Apps' DEV resource (`AGSPPMDB`) still deploys from the
  `main` branch, a holdover from before the DEV/TEST/PROD branch
  strategy existed. This needs to be resolved before PROD is
  provisioned (see `DECISIONS.md`).
- No automated regression test suite exists — the framework's
  Regression Test Registry (Section 96) is currently a manual
  checklist, not executable tests.

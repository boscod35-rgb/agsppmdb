# DECISIONS.md

A log of deliberate decisions and framework deviations, with
reasoning, so nobody re-litigates them or "fixes" something that was
actually intentional.

---

### D001 — Integration branch named `test`, not `develop`

The framework's original Git Strategy (Section 91) names the
integration branch `develop`, per standard GitFlow. This project
uses `test` instead, so the branch name reads as "this branch
deploys to the TEST environment" rather than requiring translation
through GitFlow vocabulary.

**Status:** Deliberate, documented in framework Section 105.3.
Anywhere the framework or older notes say `develop`, read it as
`test` for this repo.

---

### D002 — PROD deferred for cost reasons

PROD provisioning (resource group, SQL Server + Managed Identity,
Static Web App, Key Vault) was paused after DEV and TEST were both
fully working, to avoid incurring cost before it's needed.

**Status:** Deliberate, not an oversight. CHUNK 01 and subsequent
chunks proceeded against DEV/TEST only — an explicit, approved
deviation from the framework's own Section 98 rule ("don't start the
next chunk until the current one passes QA on all environments").
See `CURRENT_STATUS.md` for what remains before PROD can be
considered caught up.

---

### D003 — DEV Static Web App still deploys from `main`

`AGSPPMDB` (the DEV Static Web App) was created pointing at the
`main` branch during CHUNK 00, before the DEV/TEST/PROD branch
strategy (D001, framework Section 105.3) existed. In the
now-documented strategy, `main` is meant to deploy to PROD, not DEV.

**Status:** Resolved. Confirmed against the master scope document
(`ENTERPRISE_PPM_PROJECT_SCOPE (1).md`, Section 2 and Section 9):
`main` is permanently DEV's branch — this was not a historical
accident to correct, it's the intended mapping all along. PROD will
use its own `prod` branch when provisioned (`test -> prod` promotion
flow), not a repointed `main`. No action needed on `AGSPPMDB`.

---

### D004 — Managed Identity for PROD only, not DEV/TEST

DEV and TEST authenticate to Azure SQL using username/password
stored as Function App Environment Variables. PROD is planned to use
Managed Identity instead (passwordless authentication) from the
start, rather than launching PROD with passwords and migrating
later.

**Status:** Deliberate (framework Section 105.4). DEV/TEST's
password-based pattern is proven and adequate for non-production
use; PROD's credentials warrant the extra hardening from day one.

---

### D005 — Free serverless SQL tier for DEV and TEST

Both `PPM_DEV` and `PPM_TEST` use Azure SQL's free serverless tier
(General Purpose - Serverless, 100,000 vCore-seconds/32GB free per
month). The Azure "Create SQL Database" wizard defaults to a
Hyperscale configuration that was estimated at **$634.71/month**
before the free offer is explicitly applied — this must be applied
manually every time a new database is created; it is not the wizard
default.

**Status:** Deliberate cost control. A side effect: free-tier
databases auto-pause when idle and take ~10-30 seconds to resume on
first connection, causing an expected one-time connection failure
that resolves on retry (seen during CHUNK 01 migration runs).

---

### D006 — CMDB never stores credentials

`cmdb.AzureResources.AdminLogin` stores a username only (e.g.
`agsadmin`). No password, connection string, or token field exists
anywhere in the CMDB schema, by design (framework Section 107.1).

**Status:** Non-negotiable, not up for revision without a full
security review.

---

### D007 — Application shell uses no router library

The React shell (`src/App.jsx`) uses simple `useState`-based view
switching instead of `react-router` or similar, to avoid adding a
dependency for what was, at build time, a 2-real-page application
(Azure Info, System Health).

**Status:** Deliberate, revisit if/when the number of real routes
grows enough that state-based switching becomes unwieldy — not a
hard rule, just the right tool for the current size.

---

### D008 — Static Web Apps region for TEST differs from SQL's region

`ppm-sql-test-ags` is in Southeast Asia; `ppm-swa-test` is in East
Asia, because Azure Static Web Apps offered a smaller region list
that didn't include Southeast Asia at creation time.

**Status:** Accepted deviation (framework Section 105.8). Not every
Azure resource type offers the same region list — check each
resource type's own list rather than assuming one region choice
applies platform-wide. Recorded in `cmdb.AzureResources` (AZR-00008)
so it's visible in the platform itself, not just in this log.

---

### D009 — Branding theme is a configurable engine, not a hardcoded skin

Accent Gold Solutions (accentgold.com) was reviewed as a reference
point for visual direction and UX philosophy ("Configure first,"
matching this platform's own Section 8 principle). Rather than
hardcoding their look, a general Branding & Theme Engine was
designed (framework Section 106) with an Accent-Gold-*inspired*
seeded default — explicitly labeled as a proposal, not an extracted
brand asset, since the site's actual CSS/logo assets weren't
programmatically accessible.

**Status:** Designed, not yet built. Folds into CHUNK 02
(Configuration Engine) when that chunk starts.

---

### D010 — Chunk numbering consolidated onto the 12-chunk / 40-module master roadmap

Two chunk-numbering schemes existed side by side: this repo's ad hoc
labels (`CHUNK 00`, `00.5`, `01`, `02.5`, "Application Shell", `02`)
used in `CURRENT_STATUS.md` and `CHANGELOG.md`, and the master
framework document's clean 12-chunk / 40-module structure
(`ENTERPRISE_PPM_PROJECT_SCOPE (1).md`). The master framework's
numbering is now authoritative; the repo's ad hoc labels are
retired going forward and mapped as follows:

| Old label | Consolidated into |
|---|---|
| CHUNK 00 — Connectivity Baseline | Chunk 01 — Foundation & Environment |
| CHUNK 00.5 — Platform Foundations | Chunk 01 — Foundation & Environment |
| Application Shell | Chunk 01 — Foundation & Environment |
| CHUNK 01 — Database Foundation | Chunk 02 — Database Foundation + Configuration Engine |
| CHUNK 02.5 — CMDB Core | Chunk 02 — Database Foundation + Configuration Engine (delivered early, as cross-cutting infrastructure — CMDB is not one of the 40 numbered modules, see `PROJECT_SCOPE.md`) |
| CHUNK 02 — Configuration Engine | Chunk 02 — Database Foundation + Configuration Engine (still not started) |
| CHUNK 03 onward | Chunk 03 onward (unchanged — already matched the master numbering) |

**Status:** Deliberate, relabeling only — no code, schema, or
deployed state changed as a result of this decision. Existing
`v0.x.x` version numbers in `CHANGELOG.md` are unaffected and remain
the source of truth for what shipped when; only the chunk labels
attached to them changed. `CURRENT_STATUS.md` reflects the
consolidated numbering going forward.

---

### D011 — Project Workspace tab visibility reuses the generic Configuration Engine

The Project Workspace shell (Chunk 03) needs "visibility driven by
which modules are enabled" per the master scope document. Rather
than building a bespoke `ModuleSettings` table plus its own admin
UI, a `WorkspaceModules` category was added to the existing
`cfg.ConfigCategories`/`cfg.ConfigValues` engine (migration 007),
with one value per tab (Overview, Gap Assessment, Schedule, ...).
The existing Configuration UI's Deactivate button already works as
an on/off switch for each tab with zero new admin code.

**Status:** Deliberate, consistent with framework Section 8
(Configure First). Revisit only if tab visibility ever needs
per-project (not platform-wide) control, which the generic engine
doesn't support.

---

### D012 — Numbering Rules now really increment, not just preview

Migration 006 seeded `cfg.NumberingRules` with a `CurrentSequence`
column and a preview endpoint, but explicitly deferred a real
increment "until real entities exist to consume it." Chunk 03 is
that point: creating a Portfolio, Program, or Project now runs
`UPDATE cfg.NumberingRules SET CurrentSequence = CurrentSequence + 1
OUTPUT ...` inside the same SQL transaction as the entity insert, so
a failed create never burns a sequence number and a successful one
can never race another concurrent create onto the same code.

**Status:** Deliberate. If Risk/Issue (which also have starter
Numbering rules from migration 006) get their own tables in a later
chunk, they should follow this same transactional-increment pattern
rather than the old non-incrementing preview-only approach.

---

### D013 — Charter is the first Project Workspace tab to get real content

The Project Workspace shell (Chunk 03) was built with every tab as a
placeholder, keyed off the `WorkspaceModules` config category (D011).
Chunk 04 needed somewhere for Module 10 (Project Charter) to live,
and rather than bolt it onto the Overview panel's field list, a new
`CHARTER` value was added to the existing `WorkspaceModules` category
and `ProjectWorkspacePage.jsx` now special-cases that one tab to
render a real `CharterPanel` component instead of the generic
placeholder block. Every other tab is untouched.

**Status:** Deliberate. Establishes the pattern for future chunks:
as each module gets built, its workspace tab flips from the generic
placeholder branch to real content, one `WorkspaceModules` value at
a time, without needing to touch the tab list itself.

---

### D014 — Intake conversion copies fields forward instead of referencing the intake live

`POST /api/ppm/intakes/{id}/convert` copies the intake's Project
Type, Category, Priority, and Template onto the newly created
`ppm.Projects` row at conversion time, rather than having the
Project point back at the Intake for those values. Once converted,
the Project is fully independent — editing it later never touches
the (now read-only) Intake record, and vice versa.

**Status:** Deliberate. An Intake is a request; a Project is the
thing that request became. Keeping them as two independent rows
linked only by `ProjectIntakes.ProjectId` (one-directional) avoids
ambiguity about which record is authoritative for a field after
conversion.

---

### D015 — WBS "Generate from Template" only runs on an empty WBS

`POST /api/ppm/wbs/{projectId}/generate-from-template` (Chunk 05)
closes the loop deferred in Chunk 04 (D014): it reads a project's
`TemplateId` and instantiates the Template's Process Matrix items as
real top-level `ppm.WbsItems`. To avoid silently duplicating items if
someone clicks it twice, or generating on top of a WBS someone has
already started building by hand, the endpoint refuses to run if the
project already has any active WBS items - it returns a
`VALIDATION_FAILED` error rather than merging or overwriting.

**Status:** Deliberate. If a "regenerate" or "merge additional items"
capability is ever needed, it should be a distinct, explicit action -
not a side effect of calling this endpoint again.

---

### D016 — Milestones and Deliverables live on the Schedule tab, not their own tabs

Modules 13 (Schedule), 14 (Milestones), and 15 (Deliverables) each
have their own module number in the framework, but the framework's
own Chunk 05 scope text groups them together ("schedule, milestones,
phase gates, deliverables, dependencies between tasks" - Section 7).
Rather than adding two more Workspace tabs, the existing `SCHEDULE`
tab (seeded in migration 007) hosts all three as sub-tabs within one
`SchedulePanel` component. WBS (Module 12) got its own tab instead,
since a hierarchical checklist with reorder and green/red-path
marking is a genuinely different UI paradigm from a dated task list.

**Status:** Deliberate. If Milestones or Deliverables grow complex
enough to need their own dedicated screen (e.g., a portfolio-wide
milestone rollup), that would be a new WorkspaceModules value and a
dedicated panel at that point, not a retrofit of this decision.

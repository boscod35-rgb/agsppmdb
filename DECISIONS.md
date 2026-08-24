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

# CLAUDE.md

Permanent development instructions for Claude (or any AI assistant)
working in this repository. Read this file first, every session,
before making any change.

## What this repo is

`agsppmdb` — the Enterprise PMO Platform. A browser-based PMO
suite built on Azure Static Web Apps + Azure Functions + Azure SQL.
See `PROJECT_SCOPE.md` for what it does, `PROJECT_CONTEXT.md` for
how it's architected, `CURRENT_STATUS.md` for what's actually built
versus planned.

The authoritative specification is the Enterprise PMO Platform
Framework document (referred to throughout this repo and its docs
as "the framework" or by section number, e.g. "Section 105"). This
repo's code should never contradict that document without the
contradiction being recorded in `DECISIONS.md`.

## Non-negotiable rules

1. **State scope before coding.** Before starting any chunk of work,
   state: current version, target version, scope, out-of-scope,
   files expected to change, database changes, API changes, UI
   changes, regression areas. This is framework Section 93. Do this
   even if it feels obvious.

2. **Make the smallest safe change.** Never rewrite a working file
   to add one feature. Never "clean up while you're in there" unless
   asked. Never replace an existing architectural pattern with a new
   one without explicit approval.

3. **Never edit an already-applied migration.** Database changes are
   additive — a new numbered file in `database/migrations/`, never a
   modification to `001_initial_schema.sql` or `002_cmdb.sql` once
   they've been run against DEV or TEST. See `DB_SCHEMA.md`.

4. **No secrets, anywhere, ever.** No passwords, connection strings,
   or tokens in code, in git history, or in any file in this repo.
   Credentials live only in each environment's Environment Variables
   in the Azure Portal. The CMDB (`cmdb.AzureResources`) stores
   usernames for reference, never passwords.

5. **Environment variable names are exact, uppercase, case-sensitive.**
   `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`.
   A casing mismatch (`DB_Server`) causes a silent connection failure
   — this has happened once already (see `DECISIONS.md`).

6. **Branch mapping (deviates from generic GitFlow — read carefully):**
   ```
   main  -> DEV   (permanent mapping, confirmed via the master scope
                    document — not a historical accident)
   test  -> TEST  (named "test", not "develop" — deliberate deviation,
                    see DECISIONS.md D001)
   prod  -> PROD  (will be created when PROD is provisioned;
                    promotion flow is main -> test -> prod)
   ```

7. **QA gate before calling anything done.** Build succeeds, the
   change doesn't break DEV or TEST connectivity (`Administration ->
   System Health`, both environments), and — for anything
   database-related — the CMDB / migration log reflects reality.

8. **Update these docs as part of the change, not after.**
   `CURRENT_STATUS.md` and `CHANGELOG.md` in particular go stale
   fast if left for later. If a chunk changes scope, update
   `DECISIONS.md` in the same batch of work.

## Where things live

```
src/                      React frontend
src/pages/                 Page components: HomePage, AzureInfoPage,
                            SystemHealthPage, ConfigurationPage,
                            OrganizationPage, NumberingPage,
                            LifecyclePage, BrandingPage,
                            PortfolioPage, ProgramPage, ProjectsPage,
                            ProjectWorkspacePage, PlaceholderPage
api/src/functions/          Azure Functions: health, dbTest,
                            cmdbAzureResources, configCategories,
                            configValues, organization, numbering,
                            lifecycle, branding, portfolios,
                            programs, projects
database/migrations/         Numbered SQL migration files (currently
                              through 007)
staticwebapp.config.json      SWA routing config
```

## How deployment actually works

There is no CI/CD gating yet (planned, not built — see
`CURRENT_STATUS.md`). Right now: files are uploaded directly to
GitHub via the web UI (no local git, no local Node — this is a
deliberate constraint, see `PROJECT_CONTEXT.md`), which triggers the
Azure Static Web Apps GitHub Actions workflow already present in
`.github/workflows/`, which builds and deploys automatically.
Database migrations are run manually via the Azure Portal's Query
Editor (browser-based, no SSMS) — see `DB_SCHEMA.md` for the exact
procedure.

## If something contradicts this file

If the framework document, `CURRENT_STATUS.md`, and the actual
deployed state ever disagree, trust the actual deployed state (check
`Administration -> CMDB -> Azure Info` and `System Health` first),
then flag the discrepancy rather than silently picking one.

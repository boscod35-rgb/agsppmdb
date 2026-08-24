# PROJECT_CONTEXT.md

Architecture and background context for the Enterprise PMO Platform.

## Constraint that shapes everything: browser-only

The office laptop this platform is built and used from must never
require anything beyond a web browser — no Node.js, npm, SSMS,
Python, Docker, or local git. This is a deliberate, explicit
requirement, not a limitation worked around. Every workflow in this
repo is designed around it:

- Code changes are made by generating files and uploading them
  through GitHub's web UI, not a local git client.
- Database migrations are run through the Azure Portal's browser-
  based Query Editor, not SSMS or a CLI tool.
- Deployment happens automatically via GitHub Actions once files
  land on a tracked branch — no local build step.

## Architecture

```
Office Browser (Edge/Chrome)
    v HTTPS
Azure Static Web Apps   (hosts the React frontend, reverse-proxies /api)
    v
Azure Functions API     (health check, SQL queries)
    v
Azure SQL Database
```

Future-state architecture (framework Section 3, not yet built)
layers in Microsoft Entra ID for auth, Blob Storage for documents,
Key Vault for secrets, and Application Insights for monitoring —
Key Vault is already planned specifically for PROD (see
`DECISIONS.md`).

## Tech stack

- **Frontend:** React + Vite, plain CSS (no component library),
  simple state-based view switching instead of a router library
  (kept intentionally dependency-light — see `src/App.jsx`)
- **Backend:** Azure Functions, Node.js, v4 programming model
  (`@azure/functions` package, single-file handlers under
  `api/src/functions/`)
- **Database:** Azure SQL, `mssql` npm package, connection pooling
  reused across invocations
- **Hosting:** Azure Static Web Apps (Free tier), integrated
  Functions API — no separate Express server, no App Service

## Multi-environment strategy

Three environments — DEV, TEST, PROD — each a fully separate set of
Azure resources (not shared resources with an environment flag). See
`DECISIONS.md` for why, and `CURRENT_STATUS.md` for what's actually
provisioned right now.

Naming convention: `ppm-<resource>-<env>[-suffix]`, lowercase,
hyphenated (e.g. `ppm-sql-dev-ags`, `ppm-swa-test`).

## Repository

`github.com/boscod35-rgb/agsppmdb`

## Key documents in this repo

| File | Purpose |
|---|---|
| `CLAUDE.md` | Permanent instructions for AI assistants working here |
| `PROJECT_SCOPE.md` | What the platform is meant to do |
| `PROJECT_CONTEXT.md` | This file — architecture and background |
| `CURRENT_STATUS.md` | What's built vs. planned, right now |
| `DECISIONS.md` | Log of deliberate decisions and deviations |
| `DB_SCHEMA.md` | Database schema and migration reference |
| `API_CONTRACTS.md` | Every API endpoint that exists |
| `CHANGELOG.md` | Version history |

## The framework document

All of the above traces back to a single specification document
referred to as "the framework" (Enterprise PMO Platform — Framework
v1.0 + Claude Build Guide). It is not stored in this repo verbatim,
but its section numbers are referenced throughout this repo's docs
and code comments (e.g. "Section 105", "Section 92") — those numbers
are stable references, not arbitrary.

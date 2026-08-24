# PROJECT_SCOPE.md

Master functional scope for the Enterprise PMO Platform. This is a
summary of the framework document's scope, kept in the repo so
scope is checkable without re-reading the full framework every time.

## What this platform is for

A full PMO operating platform — not a single project tracker — meant
to support 250+ projects across an enterprise, organized as:

```
Enterprise -> Business Unit -> Portfolio -> Program (optional) -> Project
```

Core product principle: **Configure first. Reuse second. Customize
in code only when necessary.**

Core modular principle: **Every module works independently, but once
enabled it plugs into the shared PMO data model so reports, metrics,
roll-ups, health, and dashboards work automatically.**

## The nine capability areas (framework Section 4)

1. **Strategy & Demand** — intake, business case, prioritization,
   portfolio balancing, benefits
2. **Portfolio / Program / Project** — the core hierarchy,
   classification, templates, lifecycle
3. **Planning & Delivery** — WBS, schedule, milestones, baselines,
   resource management (RMG), capacity
4. **Control** — financials, billing, RAID, dependencies, change
   control, governance, audits, gap assessment
5. **Quality & Readiness** — testing, compliance, security/
   operational/training readiness, handover
6. **Intelligence** — health, variance, forecast, scenario analysis,
   roll-ups, executive dashboard
7. **Knowledge & Closure** — lessons learned, benefits realization,
   closure, PIR, archive
8. **Configuration** — organization, variables, numbering, lifecycle,
   templates, thresholds, custom fields, workflows, calendars
9. **Platform & Administration** — security/RBAC, audit trail,
   documents, notifications, integrations, data quality, bulk
   import, release management, monitoring, **CMDB**

## Roadmap: 40 modules across 12 chunks

The full build is organized into **40 functional modules** grouped
into **12 implementation chunks**, per
`ENTERPRISE_PPM_PROJECT_SCOPE (1).md` (the master framework document
— treat its chunk/module numbering as authoritative). CMDB is not
one of the 40 numbered modules — it's a cross-cutting platform
capability (framework Section 5, alongside RBAC, audit trail, and
security), which is why it was delivered early, ahead of any
numbered module.

This repo's earlier ad hoc chunk labels (`CHUNK 00`, `00.5`, `02.5`)
have been consolidated onto this 12-chunk numbering — see
`DECISIONS.md` D010 for the mapping. `CURRENT_STATUS.md` uses the
consolidated numbers going forward.

## What's actually in scope for the current build phase

Current phase = **Chunk 01 (Foundation & Environment)** and
**Chunk 02 (Database Foundation + Configuration Engine)**:

- Multi-environment foundation (DEV / TEST / PROD) — Chunk 01
- Application shell (navigation, Settings/Administration area) —
  Chunk 01
- Database schema foundation (15 logical schemas) — Chunk 02
- CMDB (Configuration Management Database) — the platform's own
  infrastructure self-documentation, delivered early within Chunk 02
- Generic Configuration Engine, Organization setup, Numbering,
  Lifecycle/Stage-Gate (Modules 01, 05, 06, 07) — not yet built
- Branding & Theme Engine (designed, not yet built) — folds into
  Chunk 02 per D009

None of the nine capability areas' actual business modules
(Portfolio, Projects, RAID, Financials, etc.) have real functionality
yet — those begin at Chunk 03. See `CURRENT_STATUS.md` for the
precise line between "built" and "designed but not built."

## Explicitly deferred / out of scope for now

- Authentication / Entra ID / RBAC (framework Section 64) — the
  platform is currently unauthenticated by design at this stage
- Any integration (Power BI, Teams, Jira, Azure DevOps, ERP, etc.)
- Multi-currency, internationalization, accessibility work
- PROD environment (deferred for cost reasons — see `DECISIONS.md`)

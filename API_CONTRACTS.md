# API_CONTRACTS.md

Every API endpoint that currently exists. All are Azure Functions
(v4 programming model), integrated with the Static Web App at
`/api/*`, `authLevel: 'anonymous'` (no auth exists yet — see
`DECISIONS.md` / `CURRENT_STATUS.md`).

None of these endpoints ever return a password, connection string,
or token. Failures return a safe error **category**, never a raw
driver error message.

---

## GET /api/health

Confirms the Azure Functions API itself is running. No database
call.

**Success (200):**
```json
{
  "success": true,
  "message": "Azure Functions API is running"
}
```

No documented failure case — if this doesn't return 200, the
Function App itself is down, which is a platform-level problem, not
an application error to classify.

---

## GET /api/db-test

Connects to Azure SQL and runs `SELECT DB_NAME() AS databaseName,
GETUTCDATE() AS serverTime`.

**Success (200):**
```json
{
  "success": true,
  "database": "PPM_DEV",
  "serverTime": "2026-08-22T06:56:30.917Z"
}
```

**Failure (500):**
```json
{
  "success": false,
  "message": "Database connection failed",
  "error": "SQL_AUTH_FAILED",
  "detail": "SQL authentication failed. Check DB_USER / DB_PASSWORD in Application Settings."
}
```

`error` is always one of:

| Category | Meaning |
|---|---|
| `CONFIG_MISSING` | Required Environment Variables not set on the Function App |
| `SQL_AUTH_FAILED` | Wrong `DB_USER` / `DB_PASSWORD` |
| `SQL_NETWORK_BLOCKED` | Can't reach the SQL server (firewall or wrong `DB_SERVER`/`DB_PORT`) |
| `DATABASE_UNAVAILABLE` | Anything else unexpected |

---

## GET /api/cmdb/azure-resources

Returns CMDB records from `cmdb.AzureResources`. Read-only.

**Query parameters:**

| Param | Values | Behavior |
|---|---|---|
| `environment` | `DEV` \| `TEST` \| `PROD` | Filters to that environment. Omit for all. |

**Success (200):**
```json
{
  "success": true,
  "count": 4,
  "resources": [
    {
      "ResourceId": 1,
      "ResourceCode": "AZR-00001",
      "Environment": "DEV",
      "ResourceType": "Resource Group",
      "ResourceName": "RG-PPM-DEV",
      "ResourceGroup": "RG-PPM-DEV",
      "Region": "West US",
      "Endpoint": null,
      "AdminLogin": null,
      "ParentResourceId": null,
      "Status": "Active",
      "Notes": "Original DEV baseline, CHUNK 00",
      "CreatedDate": "2026-08-22T00:00:00.000Z",
      "LastVerifiedDate": null
    }
  ]
}
```

**Failure (500):** same shape as `/api/db-test`, plus one additional
category:

| Category | Meaning |
|---|---|
| `SCHEMA_MISSING` | `cmdb.AzureResources` doesn't exist — migration 002 hasn't been run on this database yet |

---

## GET /api/config/categories

Returns the Configuration Engine's picklist categories (Module 05).
Read-only. Deployed and verified on DEV and TEST.

**Success (200):**
```json
{
  "success": true,
  "count": 7,
  "categories": [
    {
      "CategoryId": 1,
      "CategoryCode": "ProjectType",
      "CategoryName": "Project Type",
      "Description": "Classifies the nature of the project.",
      "IsSystemCategory": true,
      "SortOrder": 10
    }
  ]
}
```

**Failure (500):** same shape as `/api/db-test`, plus:

| Category | Meaning |
|---|---|
| `SCHEMA_MISSING` | `cfg.ConfigCategories` doesn't exist — migration 003 hasn't been run on this database yet |

---

## GET /api/config/values

Returns the Configuration Engine's picklist values (Module 05).
Deployed and verified on DEV and TEST.

**Query parameters:**

| Param | Values | Behavior |
|---|---|---|
| `category` | a `CategoryCode`, e.g. `ProjectType` | Filters to that category. Omit for all. |

**Success (200):**
```json
{
  "success": true,
  "count": 4,
  "values": [
    {
      "ConfigValueId": 1,
      "CategoryId": 1,
      "CategoryCode": "ProjectType",
      "CategoryName": "Project Type",
      "ValueCode": "SOFTWARE_DELIVERY",
      "ValueLabel": "Software Delivery",
      "SortOrder": 10,
      "IsActive": true,
      "IsDefault": true,
      "Notes": "Starter example - edit via Configuration UI once available.",
      "CreatedDate": "2026-08-23T00:00:00.000Z",
      "CreatedBy": "agsadmin",
      "UpdatedDate": null,
      "UpdatedBy": null
    }
  ]
}
```

**Failure (500):** same shape as `/api/config/categories`, with
`SCHEMA_MISSING` meaning `cfg.ConfigValues` doesn't exist yet.

---

## POST /api/config/values

Creates a new value under an existing category. Admin-facing UI
only for now (no auth exists yet — this is not publicly writable in
spirit, just not yet gated).

**Body:**
```json
{
  "categoryCode": "ProjectType",
  "valueCode": "PILOT",
  "valueLabel": "Pilot",
  "sortOrder": 50,
  "isDefault": false,
  "notes": "optional"
}
```
`categoryCode`, `valueCode`, and `valueLabel` are required. Setting
`isDefault: true` automatically clears the default flag on every
other value in that category first — there is always at most one
default per category.

**Success (201):** `{ "success": true, "value": { ...the created row... } }`

**Failure:**

| Category | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Missing a required field |
| `NOT_FOUND` | 404 | `categoryCode` doesn't match an existing category |
| `DUPLICATE_VALUE_CODE` | 500 | `valueCode` already exists in that category |

---

## PUT /api/config/values/{id}

Updates an existing value. Any subset of fields may be sent —
omitted fields keep their current value.

**Body:**
```json
{ "valueLabel": "Pilot Program", "sortOrder": 45, "isDefault": true, "notes": "updated" }
```

Setting `isDefault: true` clears the default flag on every other
value in the same category first. `UpdatedDate`/`UpdatedBy` are set
automatically — never pass these in the request body.

**Success (200):** `{ "success": true, "value": { ...the updated row... } }`

**Failure:** `NOT_FOUND` (404) if `{id}` doesn't exist, otherwise
same shape as POST.

---

## DELETE /api/config/values/{id}

**Soft-delete only** — sets `IsActive = 0`. There is no hard-delete
endpoint; deactivated values remain in the database and can still be
viewed (just not selected for new use), consistent with the
framework's Deactivate/Archive pattern (Section 95).

**Success (200):** `{ "success": true, "message": "Config value 12 deactivated." }`

**Failure:** `NOT_FOUND` (404) if `{id}` doesn't exist.

---

## GET/POST/PUT/DELETE /api/org/{resource}/{id?}

`resource` is one of `business-units`, `departments`, `locations`
(Module 01). `departments` supports `?businessUnit=CODE` filter on
GET. PUT/DELETE require `{id}`. DELETE soft-deletes (`IsActive = 0`).

**Success shapes:** `{ success, count, businessUnits: [...] }` /
`{ success, count, departments: [...] }` / `{ success, count, locations: [...] }`
on GET (list); `{ success, businessUnit }` / `{ success, department }` /
`{ success, location }` on GET-one, POST, PUT.

**Failure:** `VALIDATION_FAILED` (400), `NOT_FOUND` (404, includes
an unknown `resource` segment or a referenced Business Unit that
doesn't exist), `DUPLICATE_CODE` (500), `SCHEMA_MISSING` (500).

---

## GET/POST/PUT/DELETE /api/config/numbering/{id?}/{action?}

Module 06. GET (no id) lists all rules with a computed
`PreviewNext` field. `GET /{id}/preview` returns just the preview
string without incrementing anything. POST creates a rule
(`entityType` required). PUT/DELETE require `{id}`; DELETE
soft-deletes.

**Success (list):** `{ success, count, rules: [{ NumberingRuleId, EntityType, Prefix, Suffix, Separator, SequenceLength, CurrentSequence, ResetRule, IsActive, PreviewNext, ... }] }`

**Failure:** `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `DUPLICATE_ENTITY_TYPE` (500), `SCHEMA_MISSING` (500).

Note: this endpoint only *previews* — it never increments
`CurrentSequence`. Real, atomic generation happens inline inside
`POST /api/ppm/portfolios`, `POST /api/ppm/programs`, and
`POST /api/ppm/projects` (see below).

---

## GET/POST/PUT/DELETE /api/config/lifecycle/{id?}/{sub?}/{subId?}

Module 07. GET (no id) lists all lifecycles, each with a nested
`phases` array. POST creates a lifecycle. PUT/DELETE `{id}` update
or soft-delete a lifecycle. `POST /{id}/phases` adds a phase;
`PUT /{id}/phases/{phaseId}` and `DELETE /{id}/phases/{phaseId}`
update or soft-delete one phase (does not touch the parent
lifecycle's `IsActive`).

**Success (list):** `{ success, count, lifecycles: [{ LifecycleId, LifecycleCode, LifecycleName, Version, IsActive, phases: [...] }] }`

**Failure:** `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `DUPLICATE_CODE` (500), `SCHEMA_MISSING` (500).

---

## GET/POST/PUT/DELETE /api/ppm/portfolios/{id?}

Module 02, added in Chunk 03. GET (no id) lists all portfolios,
joined with Business Unit and Status label. GET `/{id}` returns one.
POST creates — `name` is required; `businessUnitCode`, `ownerName`,
`statusCode` (from the `PortfolioStatus` config category),
`description`, `notes` are all optional. `PortfolioCode` is
generated server-side from `cfg.NumberingRules` (EntityType =
`Portfolio`) inside the same transaction as the insert — never
supply it. PUT `/{id}` updates any of the same fields (send `null`
to clear an optional field). DELETE `/{id}` archives
(`IsActive = 0`, never a hard delete — the UI labels this "Archive").

**Success (create/update/get-one):**
```json
{
  "success": true,
  "portfolio": {
    "PortfolioId": 1,
    "PortfolioCode": "PF-001",
    "PortfolioName": "Digital Transformation",
    "BusinessUnitCode": "IT",
    "BusinessUnitName": "Information Technology",
    "OwnerName": "J. Smith",
    "StatusCode": "ACTIVE",
    "StatusLabel": "Active",
    "IsActive": true
  }
}
```

**Failure:** `VALIDATION_FAILED` (400, missing `name`), `NOT_FOUND`
(404, unknown portfolio id, business unit code, or status code),
`DUPLICATE_CODE` (500), `SCHEMA_MISSING` (500, run migration 007).

---

## GET/POST/PUT/DELETE /api/ppm/programs/{id?}

Module 03, added in Chunk 03. GET (no id) lists all programs, joined
with Portfolio and Status label; supports `?portfolio=CODE` filter.
POST creates — `name` and `portfolioCode` are required;
`programManagerName`, `statusCode` (from `ProgramStatus`),
`description`, `notes` are optional. `ProgramCode` is
server-generated the same transactional way as Portfolio. PUT/DELETE
work the same as Portfolios (DELETE archives).

**Failure:** `VALIDATION_FAILED` (400, missing `name`/`portfolioCode`),
`NOT_FOUND` (404, unknown program id, portfolio code, or status
code), `DUPLICATE_CODE` (500), `SCHEMA_MISSING` (500).

---

## GET/POST/PUT/DELETE /api/ppm/projects/{id?}

Module 04, added in Chunk 03. The first endpoint built for the
framework's explicit 250+ project scale.

**GET (list) query parameters:**

| Param | Values | Behavior |
|---|---|---|
| `page` | integer | default 1 |
| `pageSize` | integer | default 25, capped at 100 |
| `search` | text | matches `ProjectName` or `ProjectCode` (contains) |
| `status` | `ProjectStatus` ValueCode | e.g. `ACTIVE` |
| `portfolio` | PortfolioCode | e.g. `PF-001` |
| `program` | ProgramCode | e.g. `PG-0001` |
| `sortBy` | `ProjectName` \| `ProjectCode` \| `CreatedDate` \| `StartDate` \| `TargetEndDate` | default `ProjectName` |
| `sortDir` | `asc` \| `desc` | default `asc` |
| `includeInactive` | `true` | include archived projects (default: active only) |

**Success (list):**
```json
{
  "success": true,
  "page": 1,
  "pageSize": 25,
  "totalCount": 253,
  "totalPages": 11,
  "projects": [ { "ProjectId": 1, "ProjectCode": "PRJ-00001", "ProjectName": "...", "PortfolioName": "...", "ProgramName": null, "StatusLabel": "Active", "HealthStatusLabel": "Green", "TargetEndDate": "2026-12-01", "...": "..." } ]
}
```

GET `/{id}` returns one project, fully joined with Portfolio,
Program, and every Chunk 02 picklist (Type, Category, Size,
Complexity, Priority, Status, Health Status) plus Lifecycle.

**POST** creates — `name` and `portfolioCode` are required;
`programCode`, `projectManagerName`, `projectTypeCode`,
`projectCategoryCode`, `projectSizeCode`, `projectComplexityCode`,
`projectPriorityCode`, `statusCode`, `healthStatusCode`,
`lifecycleCode`, `startDate`, `targetEndDate`, `description`,
`notes` are all optional. `ProjectCode` is server-generated
(EntityType = `Project`) inside the same transaction as the insert
and every picklist code is validated against `cfg.ConfigValues`
before the insert runs.

**PUT** `/{id}` updates any of the same fields (send `null` to clear
an optional field). **DELETE** `/{id}` archives (`IsActive = 0`).

**Failure:** `VALIDATION_FAILED` (400, missing `name`/`portfolioCode`),
`NOT_FOUND` (404, unknown project id, or any referenced portfolio /
program / picklist code / lifecycle code), `DUPLICATE_CODE` (500),
`SCHEMA_MISSING` (500, run migration 007).

---

## Planned, not yet built

- `GET /api/cmdb/azure-resources/{id}` — single record
- `POST /api/cmdb/azure-resources` — create (admin only, once auth exists)
- `PUT /api/cmdb/azure-resources/{id}` — update (admin only)
- `POST /api/cmdb/azure-resources/{id}/verify` — bump `LastVerifiedDate` only
- Any content behind the Project Workspace tabs (Chunk 04 onward)
- Lifecycle Gates endpoints (approval requirements between phases)
- Any `/api/config/branding` endpoint that actually applies the
  theme at runtime (Section 106 — data model + management UI exist,
  runtime application deferred)

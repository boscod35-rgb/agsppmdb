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

## Planned, not yet built

- `GET /api/cmdb/azure-resources/{id}` — single record
- `POST /api/cmdb/azure-resources` — create (admin only, once auth exists)
- `PUT /api/cmdb/azure-resources/{id}` — update (admin only)
- `POST /api/cmdb/azure-resources/{id}/verify` — bump `LastVerifiedDate` only
- Any `/api/config/organization`, `/api/config/numbering`, or
  `/api/config/lifecycle` endpoints (Modules 01, 06, 07 — distinct
  structures, not the generic category/value pattern)
- Any `/api/config/branding` endpoint (Section 106, folds into Chunk 02)

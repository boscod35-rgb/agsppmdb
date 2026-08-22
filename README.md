# PPM Azure Connectivity Test (DEV only)

A minimal proof-of-concept that validates this chain end-to-end, using
**only a web browser on the office laptop** — nothing is installed or run
locally:

```
Office Browser (Edge/Chrome)
    ↓ HTTPS
Azure Static Web Apps  (hosts the React frontend + reverse-proxies /api)
    ↓
Azure Functions API    (health check + SQL query)
    ↓
Azure SQL Database      PPM_DEV
```

This is intentionally tiny. No auth, no Entra ID, no modules, no
dashboards, no Docker, no local Express server, no local SQL Server. Its
only job is to prove the chain works so networking / credentials / CORS /
SQL firewall / Function config issues can be diagnosed one layer at a time.

---

## Repository structure

```
ppm-connectivity-test/
├── src/                      React frontend (source)
│   ├── main.jsx
│   ├── App.jsx
│   └── App.css
├── public/                   Static assets (empty for now)
├── api/                      Azure Functions backend
│   ├── src/functions/
│   │   ├── health.js         GET /api/health
│   │   └── dbTest.js         GET /api/db-test
│   ├── host.json
│   ├── package.json
│   └── local.settings.json.example   (documents required settings only)
├── index.html
├── package.json              Frontend build config
├── vite.config.js
├── staticwebapp.config.json  Static Web Apps routing
├── .gitignore
└── README.md
```

Everything under `api/` deploys as the integrated Azure Functions backend
for the Static Web App — this is the standard "Bring your own API" pattern,
so `/api/*` calls from the browser are automatically routed to the
Functions without any CORS configuration needed.

---

## What each piece does

- **`src/App.jsx`** — three status cards (Frontend / API / Database) and
  two buttons ("Test API", "Test Database"). Calls `GET /api/health` and
  `GET /api/db-test` and displays the result. Contains no credentials or
  connection strings.
- **`api/src/functions/health.js`** — returns
  `{ "success": true, "message": "Azure Functions API is running" }`.
- **`api/src/functions/dbTest.js`** — connects to Azure SQL using
  `DB_SERVER` / `DB_DATABASE` / `DB_USER` / `DB_PASSWORD` / `DB_PORT` read
  from environment variables (Function App Application Settings), runs
  `SELECT DB_NAME() AS databaseName, GETUTCDATE() AS serverTime;`, and
  returns a safe JSON result or a safe error category — never the raw
  driver error, password, or connection string.

---

## Deployment guide (GitHub → Azure Static Web Apps)

Follow these in order. Each step only needs a browser.

1. **Create a GitHub repository** — e.g. `ppm-connectivity-test`. Public or
   private both work; private is recommended since this is a DEV project.

2. **Push this project to the repository** — using GitHub's "upload files"
   web UI is enough; no git CLI is required if you prefer to drag-and-drop
   the files/folders from this deliverable.

3. **Open the Azure Portal** at https://portal.azure.com.

4. **Search for "Static Web Apps"** in the top search bar and open that
   service.

5. **Click "Create"**.

6. On the Basics tab, set:
   - **Resource Group:** `RG-PPM-DEV`
   - **Name:** e.g. `ppm-connectivity-test`
   - **Plan type:** Free (if available for this subscription)
   - **Region for Azure Functions API:** pick the region closest to
     `ppm-sql-dev-ags.database.windows.net`'s region
   - **Environment:** DEV (or default "Production" environment slot if
     your subscription doesn't expose a separate DEV slot for Static Web
     Apps — the environment naming here is just a label, not a different
     resource)

7. Under **Deployment details**, choose **GitHub**, sign in if prompted,
   and select:
   - Organization / Repository: the repo you created in step 1
   - Branch: `main` (or whichever branch you pushed to)

8. Under **Build Details**, choose **React** as the build preset (or
   "Custom" if React isn't listed) and set:
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** `dist`

9. Click **Review + create**, then **Create**. Azure will provision the
   Static Web App **and automatically commit a GitHub Actions workflow
   file** into your repository that builds and deploys both the frontend
   and the Functions API on every push.

10. Wait for the GitHub Actions workflow to finish (check the **Actions**
    tab of your GitHub repo). When it succeeds, the Static Web App has a
    live URL, shown on the Azure Portal Overview page for the resource
    (something like `https://<random-name>.azurestaticapps.net`).

11. **Configure the database credentials** (do this after the first
    successful deployment): in the Static Web App resource, go to
    **Settings → Environment variables** (this is where Application
    Settings live for the integrated Functions API) and add:
    - `DB_SERVER` = `ppm-sql-dev-ags.database.windows.net`
    - `DB_DATABASE` = `PPM_DEV`
    - `DB_USER` = *(your SQL login)*
    - `DB_PASSWORD` = *(your SQL login password)*
    - `DB_PORT` = `1433`

    These values live only in Azure — never in GitHub, never in React,
    never in a committed `.env` file.

12. **Allow Azure Functions to reach Azure SQL**: in the Azure SQL Server
    resource (`ppm-sql-dev-ags`), open **Networking**, and under
    **Exceptions**, enable **"Allow Azure services and resources to access
    this server."** This is the simplest DEV-only setting that lets the
    (IP-address-changing) Azure Functions runtime reach `PPM_DEV` without
    managing individual IP allowlist entries.

13. Open the Static Web App URL from step 10 in Edge or Chrome on the
    office laptop. You should see the **PPM Azure Connectivity Test** page
    with all three cards.

14. Click **Test API** → the API card should turn to **ONLINE**.

15. Click **Test Database** → the Database card should turn to
    **CONNECTED**, showing **Database Name: PPM_DEV** and a server
    timestamp.

That completes the connectivity chain: **Frontend: ONLINE → API: ONLINE →
Database: CONNECTED → Database: PPM_DEV.**

---

## Error diagnostics shown on screen

| Card state | Meaning |
|---|---|
| API: `API unreachable` | The browser couldn't reach `/api/health` at all — check the Static Web App deployment / that the `api` folder deployed correctly |
| API: `Azure Function error` | The Function responded but not with a success payload — check Function App logs |
| Database: `API unreachable` | The browser couldn't reach `/api/db-test` — same as above |
| Database: `Azure Function error (missing config)` | `DB_USER`/`DB_PASSWORD`/etc. aren't set in Environment variables (step 11) |
| Database: `SQL authentication failed` | Wrong `DB_USER` / `DB_PASSWORD` |
| Database: `SQL firewall/network blocked` | Azure SQL firewall isn't allowing the Function (step 12), or `DB_SERVER`/`DB_PORT` is wrong |
| Database: `Database unavailable` | Some other unexpected error — check Function App logs in the Azure Portal (Static Web App → Functions → the function → Monitor) |

No password, connection string, or access token is ever shown in the
browser or returned by either Function — only these safe category labels.

---

## Explicitly out of scope for this proof-of-concept

Portfolio management, programs, projects, WBS, risks, issues, resources,
dashboards, authentication, Entra ID integration, reporting, document
management, notifications, complex navigation, and production architecture
are intentionally not included, nor are Docker, Kubernetes, virtual
machines, a local Express server, local SQL Server, Cosmos DB, Redis, or
API Management. Add these only after this connectivity chain is confirmed
working end-to-end.

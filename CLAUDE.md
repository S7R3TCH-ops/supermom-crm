# SMHQ CRM — Claude Code Project Context

## What This Is
**Supermom for Hire (SMHQ)** — a mobile-first CRM web app for Sandra, a solo home-services business owner in Georgetown, Ontario. Manages jobs, clients, financials, and scheduling. Built by Joel (developer), intended to scale as a managed service product for similar businesses.

## Repository & Branching
- **Unified Repository:** Consolidates legacy `supermom-crm` and `supermom-sandbox`.
- **Branches:**
  - `main`: Production-ready code (synced to `origin/main`).
  - `sandbox`: Development and experimental sandbox (synced to `origin/sandbox`).
- **Workflow:** Use `git checkout sandbox` for development and `git checkout main` for production releases.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS — `index.html` + `app.js` (no frameworks)
- **Backend:** Google Apps Script (`code.js`) — pure data API, GET requests only
- **Database:** Google Sheets (7 tabs — see schema below)
- **Hosting:** GitHub Pages (`s7r3tch-ops/supermom-crm`) serves frontend
- **GAS Deployment URL:** `https://script.google.com/macros/s/AKfycbzoqPyDDmpdgNp60xAKrXtClxqOdWxmmwgnH4sK7fM-rcM8LyPoE9Br7Lg6CtI3hCREzw/exec`
- **Logo:** `https://lh3.googleusercontent.com/d/1vYV_0VFk2MF8QrZyQ77BKyx4hnpuDqSb`

## Prerequisites & Setup Status

### One-Time System Requirements
| Tool | Status | Notes |
|------|--------|-------|
| Node.js + npm | ✅ Installed | Required for clasp, Lighthouse, PurgeCSS |
| `@google/clasp` | ✅ Installed | `npm install` done |
| Aider (AI Pair) | ✅ Installed | Global (via uv). Requires `C:\Users\jlund\.local\bin` in PATH |
| Lighthouse CLI | ✅ Installed | Global (`npm install -g lighthouse`) |
| PurgeCSS | ✅ Installed | Local DevDependency (`npm install --save-dev purgecss`) |
| clasp authenticated | ✅ Done | `npm run login` completed |
| Google Apps Script API | ✅ Enabled | script.google.com/home/usersettings |
| `.clasp.json` | ✅ Created | Script ID: `1N0wTqDEKihPP...` (local only, gitignored) |
| `appsscript.json` | ✅ Created | Manifest file, committed to repo |
| Git + GitHub access | ✅ Working | Pushing to `s7r3tch-ops/supermom-crm` |

### If tools stop working or on a new machine
1. **Aider:** If `aider` command not found, ensure `C:\Users\jlund\.local\bin` is in User PATH.
2. **clasp:** `npm install` then `npm run login`. Recreate `.clasp.json` if missing (Script ID: `1N0wTqDEKihPP6cR0yGJZYaSqViRQgkZMnufIb0UhmhVqAC-3QB6Hxp9R`).
3. **PurgeCSS:** Run `npm install` to restore local dev dependencies.

## Deploy Checklist
1. Run `@agent-code-simplifier:code-simplifier` — review changed code for reuse, quality, and efficiency before shipping
2. Bump version in modified file(s) — `app.js`, `index.html`, `code.js`
3. Update `## Current Versions` in this file
4. Push `index.html` + `app.js` to `main` branch → auto-deploys to GitHub Pages
5. For `code.js` changes: run `npm run deploy` (pushes `code.js` to GAS and creates a new version)
6. Remind Joel: re-upload `app.js` and `code.js` to the Claude project (main chat sync)

### Branch Note
- Work on `sandbox` branch for development
- Merge to `main` only for production releases
- `code.js` lives locally in this repo (unlike the legacy `supermom-crm` where it was GAS-only)

## Current Versions
- `app.js` → v4.05
- `code.js` → v5.00
- `index.html` → synced with app.js

## Architecture Rules — DO NOT VIOLATE

### CORS / Request Pattern
- **ALL `gasCall` requests use GET with URL-encoded `payload` param.** This is non-negotiable.
- POST/JSON body causes CORS preflight failures with GAS. This was tested and proven. Never change this.
- `doPost` exists in code.js with LockService but is dead code — frontend never uses it.

### Data Loading
- `loadAllData()` is called ONCE on initial page load. Never after saves or deletes.
- After writes, only `refreshData()` (view-aware re-render) or `refreshAll()` is called.
- `localStorage` cache (`smhq_cache`) is cleared after writes so next full load gets fresh data.

### Soft Deletes
- All deletes set `Is_Deleted='TRUE'` (clients) or `Is_Deleted='TRUE'` (jobs). No hard deletes.
- `_pendingDeletes` Set filters deleted IDs from `loadAllData` responses to prevent zombie restoration.

### ID Handling
- All ID comparisons use `.trim()` and `String()` wrappers.
- Frontend generates temporary IDs (`C` + timestamp, `J` + timestamp), GAS may return canonical IDs.

### Math
- `getJobTotals(j, overrides)` is the SINGLE source of truth for all job math.
- Uses per-job stored `Hourly_Rate` (falls back to global `S.biz.rate` for new jobs).
- Uses per-job stored `HST_Rate` (falls back to `taxRate()` for new jobs).
- `parseMoney(val)` handles string-to-number safely, always returns 0 on failure.
- Frontend calculates totals, backend stores them. No server-side math duplication.

### Time/Date
- `TZ = 'America/Toronto'` hardcoded in GAS (not `getScriptTimeZone()`).
- `formatVal` in GAS handles Google Sheets Date objects — 1899 epoch = time-only values.
- Frontend stores/displays dates as `YYYY-MM-DD` strings, times as `HH:mm`.

### Logo
- Managed manually in the sheet config, not via in-app upload.
- URL format must be `lh3.googleusercontent.com/d/` (not `uc?id=`).

### Config Keys
- Sheet stores: `biz_name`, `owner_name`, `hourly_rate`, `hst_number`
- Frontend expects: `biz`, `owner`, `rate`, `hst_num`
- `getAllData` remaps these on read. `updateBizConfig` writes the sheet key names.

## Google Sheets Schema

### 00_CONFIG (A1:E37)
Columns: `Key`, `Value`, `Category`, `Sort_Order`, `Notes`
Categories: `settings`, `services`, `referral_sources`, `payment_methods`, `prepaid_reasons`, `cancellation_reasons`
- Settings: Key/Value are different (e.g. `hourly_rate` / `50`)
- List items: Key/Value are identical (except `cancellation_reasons` which uses coded keys)

### 01_CLIENTS (A1:Z)
Key columns: `Client_ID`, `First_Name`, `Last_Name`, `Email`, `Phone`, `Phone2`, `Street`, `City`, `Province`, `Postal_Code`, `Status`, `Referral_Source`, `Global_Notes`, `Family_Details`, `Access_Info`, `Created_Date`, `Is_Deleted`, `Total_Lifetime_Value`

### 02_JOBS (A1:AP) — Full Header Row
| Col | Header | Notes |
|-----|--------|-------|
| A | Job_ID | Primary key |
| B | Client_ID | FK to 01_CLIENTS |
| C | Service | |
| D | Original_Scheduled_Date | |
| E | Scheduled_Date | |
| F | Completion_Date | |
| G | Time | Stored as HH:mm or 1899 Date |
| H | Duration_Estimate | |
| I | Actual_Duration | |
| J | Pricing_Type | 'Hourly' or 'Flat' |
| K | Hourly_Rate | Per-job rate snapshot |
| L | Estimated_Hours | |
| M | Flat_Rate | |
| N | Surcharge | |
| O | Subtotal | |
| P | HST_Rate | Per-job tax rate snapshot |
| Q | HST_Amount | NOT 'HST' — column name matters |
| R | Additional_Cost | |
| S | Additional_Cost_Notes | |
| T | Total_Amount | |
| U | Job_Status | Scheduled, Completed, Cancelled |
| V | Payment_Status | '', Paid, Partial |
| W | Payment_Method | |
| X | PrePaid_Amount | |
| Y | PrePaid_Reason | |
| Z | Scheduling_Type | Hard Date, ASAP, By Date |
| AA | Follow_Up | 'Yes' or 'No' |
| AB | Follow_Up_Notes | |
| AC | Job_Notes | Pre-job notes |
| AD | Completion_Notes | |
| AE | Photo_Links | |
| AF | Review_Status | '', Pending, Requested, Received |
| AG | Review_Notes | |
| AH | Rescheduled_Count | |
| AI | Reschedule_Reason | |
| AJ | Cancellation_Date | |
| AK | Cancellation_Reason | |
| AL | Worker_ID | FK to 06_WORKERS |
| AM | Created_Date | |
| AN | Last_Modified_Date | |
| AO | Is_Deleted | 'TRUE' or 'FALSE' |
| AP | Event_ID | Google Calendar |

### 03_INVOICES (A1:N)
Key columns: `Invoice_ID`, `Job_ID`, `Client_ID`, `Invoice_Date`, `Due_Date`, `Total_Amount`, `Status`

### 04_PAYMENTS (A1:N)
Key columns: `Payment_ID`, `Invoice_ID`, `Job_ID`, `Client_ID`, `Amount`, `Payment_Method`, `Payment_Date`, `Recorded_Date`, `Is_Void`

### 05_AUDIT_LOG (A1:N)
Key columns: `Log_ID`, `Timestamp`, `Action`, `Entity`, `Changed_Field`, `Old_Value`, `New_Value`

### 06_WORKERS (A1:I)
Key columns: `Worker_ID`, `First_Name`, `Last_Name`, `Email`, `Role`, `Hourly_Rate`, `Status`

## CRUD Operation Map

### Frontend → GAS Action Mapping

| Frontend Function | GAS Action | Method | Writes To |
|---|---|---|---|
| `submitClient` (new) | `addClient` | GET | 01_CLIENTS |
| `submitClient` (edit) | `updateClient` | GET | 01_CLIENTS |
| `saveNotes` (client) | `updateClientField` | GET | 01_CLIENTS |
| `deleteClient` | `deleteClient` | GET | 01_CLIENTS (soft) |
| `submitJob` | `addJob` | GET | 02_JOBS |
| `submitJobEdit` | `updateJobDetails` | GET | 02_JOBS |
| `submitComplete` | `markJobComplete` | GET | 02_JOBS |
| `submitQuickPaid` | `markInvoicePaid` | GET | 02_JOBS + 04_PAYMENTS |
| `submitQuickPaidFromSummary` | `markInvoicePaid` | GET | 02_JOBS + 04_PAYMENTS |
| `submitMarkPaid` | `markInvoicePaid` | GET | 02_JOBS + 04_PAYMENTS |
| `deleteJob` | `deleteJob` | GET | 02_JOBS (soft) |
| `clearFU` | `updateJobDetails` | GET | 02_JOBS (Follow_Up only) |
| `markRevRequested` | `updateJobDetails` | GET | 02_JOBS (Review_Status only) |
| `addListItem` | `updateList` | GET | 00_CONFIG |
| `saveListItem` | `updateList` | GET | 00_CONFIG |
| `delListItem` | `updateList` | GET | 00_CONFIG |
| `saveBizConfig` | `updateBizConfig` | GET | 00_CONFIG |

### GAS updateJobDetails — Undefined Filtering
`updateJobDetails` strips undefined keys before writing. This is critical because partial-update callers like `clearFU` and `markRevRequested` only send 1-2 fields. Without the filter, all other columns would be blanked.

### GAS markInvoicePaid — Partial Payment Support
Handles both full and partial prepayments:
- Compares `ppAmt` to `Total_Amount` to determine Paid vs Partial
- Writes `PrePaid_Amount`, `PrePaid_Reason` to job row for partial
- Always creates a payment record in 04_PAYMENTS

## Key UI Patterns
- Modals use `showMo(id)` / `closeMo(id, event)` with bottom-sheet style
- `_isSaving` flag prevents double-tap on all save buttons
- `_backLock` prevents rapid back-button presses
- Toast notifications via `showToast(message)` with 2.8s auto-dismiss
- Global event delegation on `#scroll` for all `[data-action]` buttons
- Prepaid pills show on ALL non-completed jobs (ASAP, scheduled, by-date)

### CSS & Visibility
- **Pure CSS Approach:** Transitioned visibility logic from direct JS `.style.display` manipulation to CSS `.hidden` classes.
- **Audit Results:** CSS is clean; unused `--surface2` variable was removed.

## To-Do List
_Updated at the end of every session. Check this first when starting work._

### UI Modernization (Hybrid Focus)
> **Before starting any modernization task:** invoke `@agent-frontend-design:frontend-design` to set aesthetic direction before writing UI code.
- [ ] **Task 1: CSS Variables & Resets** — Establish Apple/Material base.
- [ ] **Task 2: Header & Navigation** — Move to white background header.
- [ ] **Task 3: Hybrid Focus (Cards/Lists)** — Refactor core layout components.
- [ ] **Task 4: Buttons & Forms** — Polish interactive elements.
- [ ] **Mockup Review:** `modern-preview.html` exists for visual reference (user currently undecided on direction).

### Bugs
- [x] **Persist `_pendingDeletes` to localStorage** — CONFIRMED FIXED. `savePendingDeletes()` exists and is called correctly at lines 172-179 and on every delete. No action needed.
- [x] **`submitMarkPaid` null reference** — fixed in v4.03: early return if job not found, wrapped in try/catch.
- [x] **`showMo`/`closeMo` null guard** — fixed in v4.03.
- [x] **`showCollectedList` orphaned financial records** — fixed in v4.03: skips records for deleted jobs.
- [x] **`formatVal` string-T truncation** — CRITICAL fix in v4.99: was corrupting any field value containing uppercase 'T' (e.g. city "Toronto"). Now uses precise ISO datetime regex.
- [x] **`markInvoicePaid` PrePaid_Amount overwrites** — fixed in v4.99: now accumulates across multiple partial payments, clears on full payment.
- [x] **`upsertConfig` hardcoded column index** — fixed in v4.99: uses header lookup.
- [x] **`uid()` low entropy** — fixed in v4.99: uses base-36 random string.
- [ ] **`Payment_Status` stale after payment voided** — when a payment is voided, the JOBS sheet Payment_Status is not reconciled. No UI path currently voids payments, so low urgency.
- [ ] **`cascadeDeleteClient` no unpaid balance warning** — deletes client even with unpaid jobs; no warning returned.

### Pending Audits
- [x] **`parseMoney` vs `forceNum`** — CLEAN. No `forceNum()` exists. `parseMoney()` is the sole utility, used consistently throughout.
- [ ] **GAS deployment URL mismatch** — CLAUDE.md documents one URL; `app.js` line 6 has a different URL. Verify which is the active deployment and update CLAUDE.md.
- [ ] **`cascadeDeleteClient` not wired to frontend** — backend function exists (soft-deletes client + all jobs/payments) but frontend only calls `deleteClient` (client only). If cascade delete is the intended flow, wire it up.

### Features
- [ ] **Invoice generation** — planned, not yet built
- [ ] **Calendar sync** — `_syncCalendar` flag pattern exists, needs end-to-end testing
- [ ] **Worker assignment** — schema exists (06_WORKERS + Jobs.AL), UI not yet built
- [ ] **2-hour booking conflict warning** — warn when a new job is booked within 2 hours of an existing scheduled job; implement on frontend in `submitJob` (check S.jobs for same-day jobs within 2-hr window)

### Infrastructure
- [ ] **`npm run deploy` end-to-end test** — clasp push working, full deploy not yet verified

## Version Bumping — MANDATORY
Every time `app.js` is modified, increment its version number at the top of the file AND update `## Current Versions` in this file.
Every time `code.js` is modified, increment its version number at the top of the file AND update `## Current Versions` in this file.
`index.html` version tracks `app.js` — update it whenever `app.js` is modified.
Never deliver a modified file without bumping its version. No exceptions.

## End-of-Session Reminder — MANDATORY
At the end of every session, always:
1. Run `@agent-code-simplifier:code-simplifier` — review all changed code before closing out
2. Update the **To-Do List** — check off completed items, add anything new that came up
3. Run `npm run deploy` if `code.js` was changed (pushes to GAS + creates new version)
4. Push `index.html` + `app.js` to `main` when ready to go live
5. Re-upload `app.js` and `code.js` to the Claude project so the main Claude chat stays in sync

## Working Style
- One fix at a time, verify before moving on
- Changed files only in output — no unchanged files
- Always include deploy instructions (which files, where)
- Ask clarifying questions rather than assume
- If a better approach exists, suggest it before implementing the asked approach
- Plain English explanations of what changed and why
- Direct, efficient, no fluff — but we have fun doing it

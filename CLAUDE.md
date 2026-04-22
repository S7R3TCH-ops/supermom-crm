# Supermom CRM — Project Context
**THIS IS THE SOURCE OF TRUTH FOR ALL AIs ON THIS PROJECT.**
If you are Claude, Gemini, or any other AI assistant — read this entire file before doing anything. Do not rely on conversation history alone. This file wins.

---

## AI Roles on This Project
This project uses multiple AI tools. Each has a defined role to avoid overlap and confusion:

| AI | Role |
|---|---|
| **Claude (this)** | Primary architect + code builder. Maintains this file. Owns legacy app fixes and new app build via Claude Code CLI. |
| **Gemini** | Second opinion, schema review, strategy input. Suggestions must be validated against this doc before implementing. |
| **Google Stitch** | UI screen generation only. Outputs are fed into Claude Code as a starting point — not used directly. |

**Rule:** If Gemini or any other AI suggests something that conflicts with decisions documented here, flag it and discuss before changing anything. This doc reflects confirmed decisions only.

---

## What This Is
**Supermom for Hire** — a mobile-first CRM web app for Sandra, a solo personal life-operations business owner in Georgetown, Ontario. Services include organizing, decluttering, life coaching, caregiving support, errands, and more. Built by Joel as a proof-of-concept managed service product, intended to scale to other solo operators.

---

## Current Status
**Two parallel tracks running simultaneously:**
- **Legacy app** (GAS/Sheets) — Sandra is actively using this. Still being maintained and improved.
- **New app** (Supabase/React/Vercel) — In active rebuild. Schema is live in Supabase. Frontend not yet started.

**Do not break the legacy app while building the new one.**


## New Stack (In Progress)

| Layer | Tool | Status |
|---|---|---|
| Database | Supabase (Postgres) | ✅ Schema v4.1 deployed |
| Auth | Supabase Auth | ⬜ Not yet configured |
| Backend logic | Supabase RPC functions | ✅ In schema |
| Frontend | React + Vite + Tailwind | ⬜ Not yet started |
| UI Scaffold | Google Stitch (feeds into Claude Code) | ⬜ Not yet started |
| **Builder** | **Claude Code CLI** — writes + manages all code | ⬜ Not yet started |
| Hosting | Vercel (auto-deploys from GitHub on push) | ⬜ Not yet configured |
| AI agent hooks | Supabase + Claude Code CLI | ⬜ Planned |

### How the build workflow works
```
Google Stitch  →  generates UI screens (visual reference)
      ↓
Claude Code CLI  →  builds real React app, wires Supabase, manages files
      ↓
GitHub repo  →  Claude Code pushes code here
      ↓
Vercel  →  auto-deploys on every push  →  live URL
```
**Vercel = hosting. Claude Code = builder. Not the same thing.**

---

## Legacy Stack (Active — Sandra Using This)

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — `index.html` + `app.js` v4.13 |
| Backend | Google Apps Script — `code.js` v5.02 |
| Database | Google Sheets (7 tabs) |
| Hosting | GitHub Pages — `s7r3tch-ops/supermom-crm` |
| GAS URL | `https://script.google.com/macros/s/AKfycbwmhWli_n6kSgG9LiHWJrZGeZ73uvz7XrgO0G24i6MRyCcdFJ65hCmtY5oPPqCMZ9CEEA/exec` |
| Logo | `https://lh3.googleusercontent.com/d/1vYV_0VFk2MF8QrZyQ77BKyx4hnpuDqSb` |

### Legacy Current Versions
- `app.js` → v4.13
- `code.js` → v5.02
- `index.html` → synced with app.js

### Legacy Deploy Checklist
1. Bump version in modified file(s)
2. Update versions above
3. Push `index.html` + `app.js` to `main`:
   ```
   git checkout main
   git checkout sandbox -- index.html app.js
   git add index.html app.js
   git commit -m "<describe the change>"
   git push origin main
   git checkout sandbox
   ```
4. For `code.js` changes: `npm run deploy` (pushes to GAS)
5. Re-upload `app.js`, `code.js`, `CLAUDE.md` to Claude project

### Legacy Architecture Rules — DO NOT VIOLATE
- **ALL GAS calls use GET with URL-encoded `payload` param.** POST causes CORS failure. Non-negotiable.
- **No `LockService` in `doGet`** — causes indefinite spinner hangs.
- **`loadAllData()` runs ONCE** on page load — never after saves or deletes.
- **Soft deletes only** — `Is_Deleted='TRUE'`. No hard deletes.
- **`getJobTotals(j, overrides)`** is the single source of truth for all job math.
- **`TZ = 'America/Toronto'`** hardcoded — never use `getScriptTimeZone()`.
- **`_pendingDeletes` Set** filters soft-deleted IDs from `loadAllData` to prevent ghost data.
- **`IS_TEST` toggle** at top of `app.js` — NEVER commit `IS_TEST=true` to GitHub.
- **Version numbers must be manually bumped** — no exceptions.

### Legacy Version Bumping — MANDATORY
Every time `app.js` is modified → bump version + update above.
Every time `code.js` is modified → bump version + update above.
`index.html` tracks `app.js` — update whenever app.js changes.

### Legacy Home Page Card Layout (v4.13)
The `jrHTML()` function renders all home page job cards. Layout rules — do not revert:
- **Line 1:** Client name + `· Service` (service as soft `.jn-svc` secondary label, same line)
- **Line 2 (`.jm-sched`):** Date + time range (or est. hours if no time set) — bigger/bolder, both in pink. Never inline with name.
- **Right side:** Status pill only (📅 BOOKED, ✅ DONE, etc.). No dollar amounts.
- **`owed` cards only:** show `● UNPAID` pill in red in addition to any status pill.
- **All other card types:** zero payment info on home page — amounts live in client profile only.
- **Prepaid notes:** say "Paid in full" or "Deposit paid · balance due at door" — no dollar figures.
- **`profJobRow()`** (client profile page) is separate — still shows full amounts there. Do not confuse the two.

### Legacy To-Do (Still Active)
- [ ] `Payment_Status` stale after payment voided (low urgency — no UI void path)
- [ ] `cascadeDeleteClient` no unpaid balance warning
- [ ] `cascadeDeleteClient` not wired to frontend
- [ ] GAS deployment URL mismatch — verify which URL is active, update CLAUDE.md
- [ ] `npm run deploy` end-to-end test
- [ ] 2-hour booking conflict warning on new job booking

---

## Supabase Schema (v4.1 — Deployed)

### 16 Tables

| Table | Purpose |
|---|---|
| `businesses` | One row per business. Sandra = first row. |
| `users` | Supabase Auth extension. Roles: admin, owner, worker. |
| `services` | Per-business service catalog (Organizing, Coaching, etc.) |
| `config` | Dropdown lists: payment_methods, referral_sources, etc. |
| `clients` | Client profiles + tags + ai_context |
| `job_templates` | Recurring job patterns per client |
| `template_schedule` | Generated occurrences from templates |
| `jobs` | Core table — bookings, financials, status, ai_context |
| `invoices` | Per-job default, multi-job supported via junction |
| `invoice_jobs` | Junction: invoice → many jobs (same client) |
| `payments` | Payment records, partial + void support |
| `communication_log` | Every client touchpoint (call, text, email, in person) |
| `notification_log` | Reminders queue — agent writes, trigger sends |
| `expense_log` | Sandra's own business expenses (not client pass-throughs) |
| `audit_log` | Append-only change log. `ai_action` type for agent changes. |

### Key Schema Decisions
- **`business_id` on every table** — multi-tenant ready from day one
- **Soft deletes via `deleted_at`** — null = active, timestamp = deleted
- **RLS on every table** — SELECT filters `deleted_at IS NULL`. Admins see all businesses.
- **Role escalation locked** — users cannot change their own role. Admin-only.
- **`ai_context jsonb`** on `clients` and `jobs` — structured scratchpad for AI agent use
- **GIN indexes** on `ai_context` and `tags` — fast semantic queries
- **Tax model:** Labour HST off by default (Sandra not charging yet, will toggle on). `additional_cost` = Sandra's full receipt total passed to client at zero markup. CRA: reimbursement, not revenue.
- **Math validation:** `save_job_financials()` RPC recalculates server-side on every save. Frontend calculates for UX, DB is source of truth.
- **Invoice numbers:** `generate_invoice_number()` RPC — INV-0001, INV-0002 per business.
- **Recurring jobs:** `job_templates` + `template_schedule`. end_type: `date`, `count`, `ongoing`. Each generated job is independent.

### Schema File
`supermom_schema_v4_1.sql` — deployed version, source of truth.

---

## New Stack Architecture Rules

### Auth & Roles
- **Admin** (`business_id = NULL`) — Joel. Sees all businesses, can change roles.
- **Owner** — Sandra. Sees only her business data.
- **Worker** — future helpers. Scoped to one business.
- Users cannot escalate their own role — admin operation only.

### Data Patterns
- All writes go through Supabase JS client
- Financial saves call `save_job_financials()` RPC — never write raw totals directly
- Soft deletes set `deleted_at = now()` — never hard delete
- Every meaningful state change writes to `audit_log`
- AI agent actions use `action = 'ai_action'` in audit_log

### Agentic AI Design
- `ai_context` on clients: coaching focus, preferences, communication style, physical needs
- `ai_context` on jobs: special instructions, scope changes, session notes, flags
- `communication_log`: last contact tracking — AI surfaces "client not contacted in 3 weeks"
- `notification_log`: agent queues reminders here → trigger sends them
- `tags` on clients: segmentation for AI queries e.g. "all VIP clients with unpaid jobs"

---

## Project Roadmap

### Phase 1 — New App (Now)
- [ ] Set up Supabase Auth — seed Sandra + Joel user rows
- [ ] New GitHub repo for React app
- [ ] Vercel project setup — connect to GitHub repo
- [ ] **Google Stitch — scaffold UI screens** <- IN PROGRESS
  - Prompt with: mobile-first, solo life-coach/organizer CRM, card-based job list, bottom nav
  - Minimum screens: Dashboard, Client List, Client Profile, Job List, Add/Edit Job, Job Detail
  - Export HTML/Tailwind code from each screen — feeds Claude Code next session
- [ ] Feed Stitch output into Claude Code CLI
- [ ] React + Vite + Tailwind frontend build
- [ ] Wire Supabase JS client
- [ ] Core CRUD: clients, jobs, payments
- [ ] Dashboard + financial summaries
- [ ] End-to-end test with Sandra on real data
- [ ] Migrate Sandra's existing data from Sheets → Supabase

### Phase 2 — Features
- [ ] Invoice generation + PDF export
- [ ] Recurring jobs UI (templates + auto-generate)
- [ ] Calendar sync (Google Calendar)
- [ ] Photo/receipt upload (Supabase Storage)
- [ ] Notification/reminder sending (SMS/email)
- [ ] Workers table + assignment UI
- [ ] Multiple client addresses
- [ ] AI agent integrations

### Phase 3 — Scale
- [ ] Second client onboarding (different business model)
- [ ] Managed service packaging
- [ ] Admin dashboard (Joel sees all businesses)

---

## Tools & Environment

### Installed (Legacy)
| Tool | Status | Notes |
|---|---|---|
| Node.js + npm | ✅ | Required for clasp, Lighthouse, PurgeCSS |
| `@google/clasp` | ✅ | `npm install` done |
| Aider | ✅ | Global via uv. PATH: `C:\Users\jlund\.local\bin` |
| Lighthouse CLI | ✅ | Global |
| PurgeCSS | ✅ | Local devDependency |
| Claude Code Usage Monitor | ✅ | Run `claude-monitor` from any terminal — Joel forgets this exists, remind him! |

### New Stack (To Install)
- [ ] Supabase CLI
- [ ] React + Vite project scaffold
- [ ] Tailwind CSS
- [ ] Vercel CLI

### Recovery
1. **Aider:** ensure `C:\Users\jlund\.local\bin` in User PATH
2. **clasp:** `npm install` then `npm run login`. Script ID: `1N0wTqDEKihPP6cR0yGJZYaSqViRQgkZMnufIb0UhmhVqAC-3QB6Hxp9R`
3. **PurgeCSS:** `npm install`

---

## Working Style
- No assumptions — ask clarifying questions until task is clear
- Suggest better approach before implementing the asked one
- One fix at a time, verify before moving on
- Changed files only in output — no unchanged files
- Always include deploy instructions
- Ask before creating any full files
- Direct, concise, no fluff — but we have fun doing it 🚀
- **Joel has ADHD** — maintain a visible Parked List of dropped topics, surface proactively
- **Token hygiene** — delete old project files before uploading new versions
- **Remind Joel** to run `claude-monitor` if sessions are getting long

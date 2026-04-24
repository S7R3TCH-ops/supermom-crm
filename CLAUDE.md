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
| **Google Stitch** | UI screen generation — optional. Claude Code can design and build directly from the handoff doc. |

**Rule:** If Gemini or any other AI suggests something that conflicts with decisions documented here, flag it and discuss before changing anything. This doc reflects confirmed decisions only.

---

## What This Is
**Supermom for Hire** — a mobile-first CRM web app for Sandra, a solo personal life-operations business owner in Georgetown, Ontario. Services include organizing, decluttering, life coaching, caregiving support, errands, and more. Built by Joel as a proof-of-concept managed service product, intended to scale to other solo operators.

---

## Current Status
**Two parallel tracks running simultaneously:**
- **Legacy app** (GAS/Sheets) — Sandra is actively using this. Still being maintained and improved.
- **New app** (Supabase/React/Vercel) — Schema deployed, design assets ready, frontend build is next.

**Do not break the legacy app while building the new one.**


## New Stack (In Progress)

| Layer | Tool | Status |
|---|---|---|
| Database | Supabase (Postgres) | ✅ Schema v4.1 deployed |
| Auth | Supabase Auth | ⬜ Not yet configured |
| Backend logic | Supabase RPC functions | ✅ In schema |
| Frontend | React + Vite + Tailwind | ⬜ Not yet started |
| UI Scaffold | Google Stitch or Claude Code (design-first or code-first) | ✅ Design assets in `docs/` — Stitch optional |
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

### New App Design Assets (Read These Before Building UI)

All design output lives in `docs/`:

| File | What it contains |
|---|---|
| `docs/App v2 Handoff April 22.html` | **Primary design reference.** Full design token system: colors, gradients, typography (Fraunces + Inter), shadows, border radii, component specs. Read this first. |
| `docs/stitch_supermom_crm_saas_v2.0/.../aura_supermom/DESIGN.md` | Stitch design system doc — "Curated Sanctuary" aesthetic, color palette, component rules |
| `docs/stitch_supermom_crm_saas_v2.0/.../intelligence_dashboard_tightened_2/code.html` | Stitch HTML output — dashboard screen |
| `docs/stitch_supermom_crm_saas_v2.0/.../job_booking_tightened/code.html` | Stitch HTML output — job booking screen |
| `docs/stitch_supermom_crm_saas_v2.0/.../intelligence_dashboard_tightened_[1-4]/screen.png` | Dashboard design iterations (visual reference) |

**Design system summary (from handoff):**
- Brand pink: `#E91E6A` — gradients from `#FF4D96` → `#E91E6A` → `#B01550`
- Dark hero: `#1A0A12` (plum-dark)
- Fonts: `Fraunces` (display/serif) + `Inter` (UI) + `DM Mono` (mono)
- Cards: `border-radius: 16px`, `border: 1.5px solid #FFD6E8`, `box-shadow: 0 2px 12px rgba(233,30,106,.08)`
- No hard borders for layout — use background color shifts instead

### Supabase Connection

- **Project host:** `db.lskzzsjmmtsosfneuovt.supabase.co`
- **Anon/public key:** `sb_publishable_HIMt19mOuS7eHBeb7WhNkQ_UFhgLh70`
- **Password:** In `.env.local` (never commit) — format: `VITE_SUPABASE_PASSWORD=...`
- **Full connection string pattern:** `postgresql://postgres:[PASSWORD]@db.lskzzsjmmtsosfneuovt.supabase.co:5432/postgres`

**.env.local for the new React app:**
```
VITE_SUPABASE_URL=https://lskzzsjmmtsosfneuovt.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_HIMt19mOuS7eHBeb7WhNkQ_UFhgLh70
```
Password goes in a separate secure location — not in any env file committed to git.

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

### Environments & Script IDs
We maintain two distinct Google Apps Script (GAS) projects. **Note:** Currently, Sandra's live data is hosted on the project originally labeled "Tester".

| Environment | Role | Script ID (`.clasp.json`) | Web App URL (`app.js`) |
|---|---|---|---|
| **Sandra's Live App** | Production | `1fVVQwc56dQPVRximpVsIcYCHuBY4OhOoXOg5P2DocNaCzuPqMU6XyoOP` | `https://script.google.com/macros/s/AKfycbwmhWli_n6kSgG9LiHWJrZGeZ73uvz7XrgO0G24i6MRyCcdFJ65hCmtY5oPPqCMZ9CEEA/exec` |
| **Dev Sandbox** | Testing | `1N0wTqDEKihPP6cR0yGJZYaSqViRQgkZMnufIb0UhmhVqAC-3QB6Hxp9R` | `[Update once new deployment created]` |

### Legacy Deploy Checklist
1. **Prepare for Sandbox/Tester Push:**
   - On the `sandbox` branch, set `IS_TEST = true` in `app.js`.
   - Ensure `.clasp.json` has the **Dev Sandbox** Script ID.
   - Run `npm run deploy` to test backend changes.
2. **Prepare for Production/Sandra Push:**
   - Bump version in modified file(s).
   - Set `IS_TEST = false` in `app.js`.
   - Update `.clasp.json` to **Sandra's Live App** Script ID.
   - Run `npm run deploy`.
3. **Push to GitHub:**
   - Push `index.html` + `app.js` to `main` (for live site):
     ```bash
     git checkout main
     git checkout sandbox -- index.html app.js
     git add index.html app.js
     git commit -m "<describe the change>"
     git push origin main
     git checkout sandbox
     ```
4. **Final Step:** Re-upload `app.js`, `code.js`, and `CLAUDE.md` to the Claude project context.

### Legacy Architecture Rules — DO NOT VIOLATE
- **IS_TEST toggle** at top of `app.js` — Controls which GAS backend is active. Default to `false` for production releases.
- **clasp configuration** — ALWAYS check `.clasp.json` before running `npm run deploy`. It is easy to accidentally overwrite Sandra's live database if the ID is wrong.

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
**Note:** This file is NOT in the repo. To get the current schema, export it from the Supabase dashboard: Database → Backups or use `supabase db dump`. Do this before starting the frontend build so Claude Code can reference it.

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
- [x] Google Stitch — scaffold UI screens (done — `docs/` has design handoff + HTML screens)
- [ ] Export schema SQL from Supabase dashboard → add to repo as `supermom_schema_v4_1.sql`
- [ ] New GitHub repo for React app (separate from legacy `s7r3tch-ops/supermom-crm`)
- [ ] Vercel project setup — connect to new GitHub repo
- [ ] Scaffold React + Vite + Tailwind — use `docs/App v2 Handoff April 22.html` as design reference
- [ ] Create `.env.local` with Supabase URL + anon key (never commit)
- [ ] Wire Supabase JS client (`@supabase/supabase-js`)
- [ ] Set up Supabase Auth — seed Sandra + Joel user rows
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
### Recovery
1. **Aider:** ensure `C:\Users\jlund\.local\bin` in User PATH
2. **clasp:** `npm install` then `npm run login`. Sandra's Live ID: `1fVVQwc56dQPVRximpVsIcYCHuBY4OhOoXOg5P2DocNaCzuPqMU6XyoOP`
3. **PurgeCSS:** `npm install`

---

## Parked List (Next Session)
- [ ] **Leckie Profiles:** Fix deployed to Live GAS. **JOEL:** Run `mergeLeckieProfiles` manually in the Live script editor to finish the cleanup.
- [x] **Victory Lines:** Funny/motivational completion messages restored to home page (v4.13).
- [x] **Privacy Cards:** "Owed" and "Collected" totals are now hidden by default (v4.13).
- [x] **Sandbox Setup:** True sandbox and environment toggle (`IS_TEST`) fully implemented.
- [ ] **Tester URL:** Need to update `TEST_URL` in `app.js` once the next Sandbox deployment is created (current is temporary).

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
- **Strict Environment Separation** — `IS_TEST` toggle in `app.js` and Script ID in `.clasp.json` must match.

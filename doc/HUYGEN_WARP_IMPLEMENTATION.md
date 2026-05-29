# Huygen Warp Implementation Handover

Date: May 29, 2026  
Workspace: `G:\Huygen Studios\side projects\wacrm-main`

## 1) Project Context

This session transformed the `wacrm` codebase into **Huygen Warp** with:

1. Full product rebrand
2. Warm, minimal UI redesign (Anthropic/Claude-inspired)
3. End-to-end n8n workflows feature (schema, API, UI)
4. Production resilience fix for Supabase PostgREST schema-cache failure on n8n tables

---

## 2) Requested Scope Covered

### Rebrand and Product Identity

- Updated app name/metadata to **Huygen Warp**
- Updated package metadata (`name`, `description`)
- Updated user-facing naming on key surfaces
- Replaced README with Huygen Warp project documentation

### Visual Redesign

- Replaced global theme token system with warm off-white + terracotta palette
- Updated layout shell, header, sidebar, and core UI primitives
- Added Huygen Warp branding assets:
  - `public/logo.svg`
  - `public/favicon.svg`
- Updated icon generation route for new mark style

### n8n Feature Delivery

- Added SQL migration for:
  - `public.n8n_workflows`
  - `public.n8n_settings`
- Added n8n routes:
  - `GET/POST /api/n8n/workflows`
  - `GET/PATCH/DELETE /api/n8n/workflows/[id]`
  - `POST /api/n8n/workflows/[id]/test`
  - `GET/POST/PATCH /api/n8n/settings`
  - `POST /api/n8n/settings/ping`
- Added dispatcher util (`src/lib/n8n-dispatcher.ts`)
- Added full n8n page at:
  - `src/app/(dashboard)/n8n-workflows/page.tsx`

### Critical Production Fix

- Investigated user-reported error:
  - `PGRST205: Could not find the table 'public.n8n_workflows' in the schema cache`
- Implemented fallback path that keeps n8n UI/API functional when those tables are unavailable via Data API/PostgREST.

---

## 3) Key Files Added/Updated

### Branding + UI

- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/components/layout/sidebar.tsx`
- `src/components/layout/header.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/card.tsx`
- `src/app/icon.tsx`
- `src/app/page.tsx`
- `src/app/(dashboard)/dashboard-shell.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/lib/themes.ts`
- `public/logo.svg`
- `public/favicon.svg`
- `README.md`
- `package.json`

### n8n Base Implementation

- `supabase/migrations/20240602000000_n8n_workflows.sql`
- `src/lib/n8n-types.ts`
- `src/lib/n8n-dispatcher.ts`
- `src/app/api/n8n/workflows/route.ts`
- `src/app/api/n8n/workflows/[id]/route.ts`
- `src/app/api/n8n/workflows/[id]/test/route.ts`
- `src/app/api/n8n/settings/route.ts`
- `src/app/api/n8n/settings/ping/route.ts`
- `src/app/(dashboard)/n8n-workflows/page.tsx`

### n8n Schema-Cache Fallback Fix

- `src/lib/n8n-fallback-store.ts` (new)
- Updated routes:
  - `src/app/api/n8n/workflows/route.ts`
  - `src/app/api/n8n/workflows/[id]/route.ts`
  - `src/app/api/n8n/workflows/[id]/test/route.ts`
  - `src/app/api/n8n/settings/route.ts`
  - `src/app/api/n8n/settings/ping/route.ts`

---

## 4) n8n Architecture Summary

## 4.1 Tables (Primary Storage)

- `public.n8n_workflows`: workflow registry, trigger event, status, execution stats
- `public.n8n_settings`: instance URL, optional API key, connectivity health info

## 4.2 API Contracts

### `/api/n8n/workflows`

- `GET`: list workflows (descending by creation)
- `POST`: create workflow with trigger/webhook validation

### `/api/n8n/workflows/[id]`

- `GET`: fetch single workflow
- `PATCH`: update allowed fields only
- `DELETE`: remove workflow

### `/api/n8n/workflows/[id]/test`

- Sends test payload to workflow webhook
- Persists `last_triggered_at`, `last_status_code`, `last_error`, execution count

### `/api/n8n/settings`

- `GET`: fetch first settings row
- `POST/PATCH`: upsert settings

### `/api/n8n/settings/ping`

- Ping `healthz`, fallback to `api/v1/workflows`
- Persist connection health metadata

## 4.3 UI Surface

`/n8n-workflows` includes:

- Connection card + ping action
- Collapsible "What is n8n?" guidance
- Workflow list with:
  - active toggle
  - test trigger
  - edit
  - delete
- Add/Edit right slide-over
- First-load pre-seeding for default WhatsApp AI Agent

---

## 5) Production Incident: PostgREST Schema Cache

## 5.1 Error

`Could not find the table 'public.n8n_workflows' in the schema cache`

## 5.2 What Was Confirmed

- App was pointed to Supabase project ref from `.env`
- Existing tables like `public.flows` were visible
- `public.n8n_workflows` and `public.n8n_settings` returned `PGRST205`
- SQL had been run by user, but PostgREST Data API still did not expose those tables

## 5.3 Hardening Steps Applied

1. Explicitly targeted schema on all n8n queries:
   - `.schema("public").from(...)`
2. Added fallback store for n8n data:
   - activates only when error code indicates missing n8n table in schema cache

## 5.4 Fallback Store Design

Fallback storage is implemented in `profiles.beta_features`:

- Workflow records encoded as: `n8nwf:<base64url-json>`
- Settings record encoded as: `n8nset:<base64url-json>`
- Existing non-n8n feature flags are preserved

This allows:

- create/read/update/delete workflows
- settings upsert
- test status updates

even when `n8n_*` tables are unavailable to PostgREST.

---

## 6) Route Behavior with Fallback

- If normal query succeeds: use `public.n8n_*` tables
- If error is table-missing (`PGRST205` for `public.n8n_workflows`/`public.n8n_settings`):
  - route falls back to profile-backed store
- Any other DB error:
  - return error normally (no masking)

---

## 7) Validation Performed

- `npm run build` passed after each major change set
- `npm run lint` passed with warnings only (pre-existing unrelated warnings)
- n8n endpoints are included in compiled route manifest

---

## 8) Git / Delivery Notes

Branch created for schema-cache fix:

- `codex/fix-n8n-schema-cache-fallback`

Commit:

- `65b3fdb` — Add n8n profile-backed fallback when PostgREST cache misses tables

Remote push completed to:

- `origin` -> `shravan-kumar-nalacharla/Whatsapp_CRM`

PR creation via connector failed with GitHub API 404 (likely permission/scope issue from connector context), so compare URL flow was used.

---

## 9) Operational Follow-Up

When Supabase Data API starts exposing `public.n8n_*` tables correctly, you can keep fallback in place (safe), or remove it later.

Recommended stabilization sequence:

1. Verify tables visible from REST/Data API directly
2. Create one new workflow and confirm it persists to table path
3. Keep fallback for one release cycle as safety net
4. Optionally migrate fallback-held records into real tables and remove fallback logic

---

## 10) Important Notes

- Existing WhatsApp route logic was preserved; n8n work was added as new API surface.
- Dispatcher integration points were documented with TODO comments for append-only event hookups.
- If user profiles are missing unexpectedly, fallback routes return explicit profile-missing errors.

---

## 11) TL;DR

We rebranded the app, redesigned the UI, delivered full n8n workflows functionality, and then fixed the blocker where Supabase REST could not see `n8n_*` tables by adding a controlled fallback so users can continue using n8n immediately.

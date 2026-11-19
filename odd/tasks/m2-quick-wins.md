# M2 quick wins — parciales chicos (wizard 4-5, tabs S08, bell dropdown)

Objective: close three shipped-as-partial features from the parity matrix. Branch: `master` (direct commits + push per unit, no PR chain). Test runner: `npm run test` (vitest), `npx playwright test` (e2e), `npm run lint`, `npm run build`.

## Specs

Scope source: `replica/features.csv` (verbatim rows) + `replica/recon.md` + `replica/clone-screens/`.

### S1 — Onboarding wizard steps 4-5

Verbatim features.csv row:

> Five-step onboarding wizard (jurisdictions / profile / studio),auth,must,yes,partial,S03; creates the studio right after sign-up | M1: steps 1-3 of 5 (jurisdictions / profile / studio); steps 4-5 arrive in M2

Acceptance criteria:
- The onboarding wizard runs all five steps; steps 4-5 are implemented with the same data layer and validation style as steps 1-3.
- Completing the wizard still creates the studio right after sign-up (existing behavior preserved; one regression test for steps 1-3 path).
- The parity row in `replica/features.csv` is updated by the orchestrator after the unit lands (writers do not edit `features.csv`).
- If the exact content of steps 4-5 is not derivable from `replica/recon.md`, `replica/clone-screens/`, or existing code, STOP and report back instead of inventing requirements.

### S2 — Case detail hub: remaining tabs

Verbatim features.csv row:

> Case detail hub with tabs,expedientes,must,yes,partial,S08 | Resumen + Pruebas tabs with ?tab= deep link (F02-E7 refresh keeps it); remaining 8 tabs = M2

Acceptance criteria:
- The remaining tabs of the case detail hub ship, each reachable via the existing `?tab=` deep link and keeping it stable across refresh (existing F02-E7 behavior preserved with a regression test).
- Tabs reuse the existing data drivers (`lib/data/*` Supabase drivers) and the existing UI primitives (`components/ui/*`); no new data-access pattern.
- Split into two tasks (T2a / T2b) if the forecast exceeds ~400 authored changed lines.
- If a tab's required content is not derivable from `replica/recon.md` / `replica/clone-screens/`, STOP and report instead of inventing requirements.

### S3 — Bell dropdown panel

Verbatim features.csv row:

> In-app notification panel and page,notificaciones,must,yes,partial,S21 | page + header bell + read-on-click deep links + mark-all + search + estado/categoria filters + Cargar mas (20/page) + Preferencias modal shipped (e2e m2-notificaciones); pending: bell dropdown panel with Todas/No leidas tabs

Acceptance criteria:
- The header bell opens a dropdown panel with `Todas` / `No leidas` tabs, fed by the existing notifications data layer (same driver as the notificaciones page).
- Read-on-click deep links and unread badge keep working through the dropdown (regression coverage on `components/shell/notification-bell.tsx` behavior).
- The notification preference gate for task alerts (ed451a1) is not bypassed: dropdown reads the same source the page reads.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 | S1 | delegated (writer, parallel unit) | done (parent edits applied: screenshots.spec.ts:65, features.csv S03, parity.md) | 62af100 |
| T2 | S2 | delegated (writer, parallel unit) | done batch 1 — Tareas tab shipped; 6 tabs blocked (see T2b) | 5fe3770 |
| T2b | S2 | deferred (needs surface extension: lib/data/*, lib/supabase/*, lib/types.ts) | pending — Actuaciones first (table exists, content derivable); Audiencias/Partes/Finanzas thin evidence; Agenda/Documentos need parent layers | |
| T3 | S3 | delegated (writer, parallel unit) | done (parent edits applied: f03-prueba.spec.ts:119 role fix, features.csv S21, parity.md rows 15/F06) | d0b7d7d |

Git policy: writers never commit; the parent owns git, runs the seam suite, commits one unit at a time (staging only that unit's paths) and pushes per unit — accepted cadence.

## Log

L1 (2026-11-19, user verbatim): "peter, ya desplegue al proyecto abogapp en vercel, y funcionando. seguimos donde nos quedamos ayer?"

L2 (2026-11-19, user verbatim): "en ese orden" — answering the direction menu (parciales chicos -> área grande nueva -> M3 jobs+email -> producción primero). This document covers only batch 1: parciales chicos.

L3 (2026-11-19): T1 done — steps 4-5 = recon's pitch + security screens (flow positions 2 and 4; M1 data steps renumbered to 1/3/5), studio still created right after sign-up; 348 lines; RED/GREEN observed; e2e onboarding.spec.ts 15 passed. Out-of-surface fix applied by parent: e2e/screenshots.spec.ts:65 "Paso 1 de 3" -> "Paso 1 de 5". features.csv S03 + parity.md:58 updated by parent.

L4 (2026-11-19): T2 batch 1 done — features.csv S08 row was stale (Movimientos already shipped), so 7 tabs remained; only Tareas could ship without a new data layer (794 lines, s08-tabs e2e 14 passed, full vitest 286 passed, tsc+eslint clean). Tab vocabulary extracted to case-tabs.ts (unit-testable ?tab= contract). 6 tabs pending as T2b, all blocked on missing lib/data drivers (tables already exist in migrations). Tab-strip got overflow-x-auto (421px needed at 390px viewport). features.csv S08 + parity.md:61 updated by parent. Debt noticed: parity.md must-haves table is stale overall (still "3 of 16", favorites "no") — regenerate via replica-diff skill later.

L5 (2026-11-19): First delegation attempt of the 3 writers failed with runtime DNS error (getaddrinfo ENOTFOUND opencode.ai); relaunch succeeded. T3 (bell dropdown) running in background.

L6 (2026-11-19): T3 done (1,245 changed lines; unit 11/11, bell e2e 15 passed, f06 17 passed) — bell trigger Link -> disclosure button per components.md keyboard spec; out-of-surface fix applied by parent (f03-prueba.spec.ts:119 role=link -> role=button). Seam suite all-green: vitest 297/297, lint clean, next build 19/19 pages, playwright 107 passed / 1 skipped, zero flakes. Commits: 62af100 (T1), 5fe3770 (T2), d0b7d7d (T3), docs commit this one. Regenerated clone-screens PNGs (8, from screenshots.spec runs) ride in the docs commit. Remaining debt: T2b data-layer tabs; parity.md full regeneration via replica-diff skill (must-haves table stale); panel screenshot capture for clone-screens; badge live-region + per-row aria-pressed from components.md noted by T3 as not-built gaps.

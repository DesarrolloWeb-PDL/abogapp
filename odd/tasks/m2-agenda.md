# M2 agenda — shared studio calendar (S17)

Objective: ship the Agenda area in vertical slices: events data layer -> `/agenda` with Lista view -> case-detail Agenda tab -> remaining views/overlays. Branch: `master` (direct commits + push per unit, no PR chain). Test runner: `npm run test` (vitest), `npx playwright test` (e2e), `npm run lint`, `npm run build`.

Slice order rationale (assumption, flagged): Lista first because it is the case tab's opening view ("opens in Lista") and the mobile-narrow default; the other four views build on the same layer.

## Specs

Scope source: `replica/features.csv` rows 33-36 + `replica/recon.md` S17 (+ S08 tab row) + `replica/clone-screens/`.

### S1 — Shared studio calendar (five views)

Verbatim features.csv row:

> Shared studio calendar (five views),agenda,should,yes,no,S17; Día / Semana / Mes / Año / Lista

Key verbatim recon S17 fragments:

> `/agenda`; expediente tab **Agenda** = scoped version (opens in Lista) | Shared studio calendar | Top bar: **Hoy** (`H`), ‹ ›, period title (+ "Semana 43" label), **Expediente** filter, view selector **Día/Semana/Mes/Año/Lista** (`D/S/M/A/L`), toggles Fines de semana / Días inhábiles, shortcuts, **Nuevo evento** (`C`); left panel: search (`Ctrl+K`), mini-month calendar with color dots + hatched inhábiles, category checkboxes (6 default categories, 11 colors) + Audiencias/Vencimientos/Fines de semana ... | ... **empty**: "No hay eventos con estos filtros" + active-filter chips + Limpiar filtros + "Ir al próximo"; **error**: "No pudimos cargar la agenda" + Reintentar; narrow: left panel hidden behind icon; **mobile**: Lista or Día only (no Año), swipe weeks; loading: previous period stays visible with a thin top bar while next loads

Acceptance criteria:
- Events live in the existing `events` table (`supabase/migrations/20261114120000_init.sql`); the data layer is a `lib/data` driver following the existing Supabase driver pattern — no new data-access pattern. If the live table shape does not fit the recon'd behavior, STOP and report before writing any migration.
- Slice 1 (`/agenda`): route + left-panel-free Lista view of upcoming events with search/filter, empty state "No hay eventos con estos filtros" + Limpiar filtros, error state "No pudimos cargar la agenda" + Reintentar, loading, mobile 390 px, nav entry.
- Slice 2: case-detail **Agenda** tab = scoped version opening in Lista (recon S08/S17).
- Later slices: Día/Semana/Mes/Año views, Hoy `H` + period nav + `D/S/M/A/L` shortcuts, weekend/inhabil toggles, category checkboxes (6 defaults / 11 colors) + Audiencias/Vencimientos overlays, event detail popover (create/edit/duplicate/delete, read-only overlays), Google Calendar status row (deferred — needs user credentials).
- Clean-room: Spanish rioplatense voseo UI copy authored fresh (recon quotes the original's strings as evidence; do not copy sentences verbatim unless they are generic UI tokens already used in the clone).
- If a view's behavior is not derivable from recon S17, STOP and report instead of inventing.

### S2 — Case-detail Agenda tab (scoped)

Verbatim recon fragment (S08 row): tabs list includes `Agenda`; (S17 row) `expediente tab **Agenda** = scoped version (opens in Lista)`.

Acceptance criteria:
- Tab renders in the case detail strip via the shared `case-tabs.ts` vocabulary (added in commit 5fe3770), `?tab=agenda` deep link stable on refresh.
- Events scoped to the case (route param), opening in Lista; reuses the S1 driver unchanged.

### S3 — Categories and audiencias/vencimientos overlays (later)

Verbatim features.csv row:

> Categories and audiencias / vencimientos overlays,agenda,should,yes,no,S17; six default categories with 11 colors

Blocked until: category model defined, hearings/vencimientos sources exist (recon marks audiencias thin; vencimientos tie to plazos). Do not start before S1 slices 1-2 land; report evidence gaps before building.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 | S1 | delegated (writer) | done — events driver pair (`lib/data/events.ts` + `lib/supabase/events.ts`) + 25 unit tests; table fits, no migration; API surface documented in Log L4 | (batch 1 seam + commit block) |
| T2 | S1 | delegated (writer, after T1) | done — `/agenda` Lista view + nav entry + e2e s17 (30 unit, 16 e2e green) | (batch seam + commit block) |
| T3 | S2 | delegated (writer, after T2) | done — `AgendaPanel` compartido (un componente, dos scopes), `?tab=agenda` estable, e2e S08-T2 scoping (34 unit, 19 e2e green) | (batch seam + commit block) |
| T4 | S1 | deferred — Día/Semana/Mes/Año views + shortcuts + toggles | pending | |
| T5 | S1 | deferred — left panel (search, mini-month, category checkboxes) + popovers + CRUD events | pending | |
| T6 | S3 | deferred — categories admin + overlays (needs evidence check first) | pending | |
| T7 | S1 | deferred — mobile bottom-bar parity: add Agenda (+Tareas) to `components/shell/mobile-bar.tsx` | pending — pre-existing tracked debt (parity.md line 165: our bar 3 items vs original 5; sections today reachable only by URL) | |

Git policy: writers never commit; parent owns git, runs the seam suite, commits one unit at a time (staging only that unit's paths) and pushes per unit — accepted cadence.

## Log

L1 (2026-11-19, user verbatim): "peter, ya desplegue al proyecto abogapp en vercel, y funcionando. seguimos donde nos quedamos ayer?"

L2 (2026-11-19, user verbatim): "en ese orden" — answering the direction menu (parciales chicos -> área grande nueva -> M3 jobs+email -> producción primero).

L3 (2026-11-19, user verbatim): "Agenda (S17)" — choosing the área grande; Documentos (S18-S20) deferred.

L4 (2026-11-19): T1 done — events driver pair (`lib/data/events.ts` 543 + `lib/supabase/events.ts` 179 + 864 tests lines, 25 tests). Live `events` table fits recon S17 (source check, category_id FK, (study_id,start_at)/(case_id,start_at) indexes) — NO migration needed; `event_categories` ships empty (init.sql TODO) so `listEventCategories()` honestly returns [] until T6 (6 default names/11 colors not in recon = do not invent). API surface: listEvents/listUpcomingEvents/listEventsByCase/listEventCategories, applyEventFilters, upcomingEventWindow, EVENT_SOURCES (manual|audiencia|vencimiento|dia_inhabil), UPCOMING_DAYS=30. Window semantics [from,to) overlap (tiles adjacent periods). Parent appended the re-export block to lib/data/index.ts (reported out-of-surface). Verification: RED->GREEN, 25/25 + lib/data 206/206, tsc+eslint clean. 1,586 lines.

L5 (2026-11-19): T2 done — `/agenda` Lista slice: agenda-view (371) + agenda-list pure logic (286) + 30 unit tests + nav entry in main-nav + e2e s17-agenda (4 tests: empty copy verbatim, seeded list via RLS REST, forced-500 error+Reintentar, 390px+axe). Category checkboxes hidden while listEventCategories() is []. Deferred slice-1 items: mobile bottom-bar entry (T7), "Ir al próximo", vencimiento labels, CRUD/popovers (T5), other views (T4), per-browser filter persistence, screenshot. Gotchas: lib/search last-token Levenshev<=2 cross-matches seeded titles; audiencia events need a real hearings row (chk_event_source_fk); react-hooks/set-state-in-effect escape = promise callback. 1,317 lines. Verification: 30 unit, 16 e2e green, tsc+eslint clean.

L6 (2026-11-19): T3 done — shared AgendaPanel({caseId?}) extracted from agenda-view (one component, two scopes; agenda-view reduced to 26-line shell), agenda-tab.tsx + explicit branch (case-detail-view final ternary else renders Pruebas — tabs after pruebas need explicit branches), case-tabs order now 5 (after Pruebas per recon), e2e S08-T2 proves scoping (case row present in tab, study row absent there but present on /agenda). Net +176 (extraction-dominated). Verification: 34 unit, 19 e2e (s08+s17) green, tsc+eslint clean.

L7 (2026-11-19): Batch seam ALL GREEN: vitest 352/352, eslint clean, next build 20/20 pages, playwright 112 passed / 1 skipped (AU02-H1 by-design skip), zero flakes (M2-E3 + AU01-H1 passed first try). features.csv row 33 -> partial (S17 slice 1 of 5 views). Commits: driver, /agenda, case tab, docs.

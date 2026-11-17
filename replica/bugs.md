# Bugs — clean-room clone (app-abogados)

Build: `85d202c`  Date: 2026-11-16  Env: local dev `http://localhost:3000`, real Supabase project, demo user `prueba.abogapp@gmail.com`.

Severity: **S1** data loss / security hole / payments wrong / core flow blocked · **S2** feature broken, no workaround · **S3** broken with a workaround, or visibly wrong · **S4** cosmetic.

Scope: only bugs **reproduced** against OUR clone. Planned M2+ gaps are under "Known gaps (planned)" and are NOT bugs. The original Veredicta was never touched.

Evidence convention: `e2e/<spec>` = failing/asserting Playwright test; `replica/bugs/<file>` = captured output; console/axe text is quoted verbatim.

---

### BUG-001: Sidebar logo link announces "Ir al inicio" while showing "Tu estudio" (WCAG 2.5.3)

- Severity: S3
- Flow / case: F02-E15 / AU01-E15 (axe scans on every authed screen)
- Screen: app shell — `components/shell/sidebar.tsx` (same pattern in `components/shell/mobile-bar.tsx` header)
- Build: `85d202c`  Browser / device: Chrome 159 (Playwright chromium), 1280×720 and 390×844

Steps
1. Sign in and open any authenticated screen (`/expedientes`, `/bandeja`, `/notificaciones`, …).
2. Run an axe-core scan (wcag2a/2aa/21a/21aa) — or let `npx playwright test` run the suite.

Expected: axe reports 0 violations; the logo link's accessible name contains its visible text ("Tu estudio").
Actual: `label-content-name-mismatch` (impact **serious**) ×1 per scan:

```
target: a[aria-label="Ir al inicio"]
html:   <a aria-label="Ir al inicio" href="/expedientes">…<span>Tu estudio</span>…</a>
failureSummary: Text inside the element is not included in the accessible name
```

Voice-control users cannot activate the link by saying its visible label ("Tu estudio"); the accessible name hides it behind "Ir al inicio" (WCAG 2.5.3, level A).
Evidence: axe output captured in this session (probe run against `/expedientes` after login); reproduced on every authed axe scan — `e2e/auth.spec.ts` (AU01-E15), `e2e/f02-expedientes.spec.ts` (F02-E15), `e2e/f03-prueba.spec.ts`, `e2e/f06-notifications.spec.ts`, `e2e/a01-inbox.spec.ts`, `e2e/mobile.spec.ts`.
Suspected cause: the link sets `aria-label="Ir al inicio"` (sidebar) / `"Ir al inicio"` (mobile header), which overrides the visible brand text instead of appending it (e.g. `aria-label="Ir al inicio — Tu estudio"` or dropping the label).
Status: **fixed** (commit pending) — accessible name + waiver removed:

1. `components/shell/sidebar.tsx`: the logo link sets `aria-label` **only while collapsed** (icon-only state, where it is still needed for the link name). Expanded, the label is gone: the visible "Tu estudio" IS the accessible name (WCAG 2.5.3 — name contains the visible text). Note: axe's `label-content-name-mismatch` only evaluates elements carrying `aria-label`/`aria-labelledby` (verified in axe-core `labelContentNameMismatchMatches`), so keeping a label while expanded would always fail once the visible text differs.
2. Waiver **removed**: `WAIVE_SIDEBAR_LOGO` deleted from `e2e/helpers.ts` (with its `AxeWaiver` machinery — `expectNoAxeViolations` now enforces every rule) and from every call site: `auth.spec.ts`, `f02-expedientes.spec.ts` (×3), `f03-prueba.spec.ts`, `f06-notifications.spec.ts`, `a01-inbox.spec.ts`, `mobile.spec.ts` (×3).
3. Tests (RED observed first, kept): `e2e/auth.spec.ts` AU01-H1 failed with `label-content-name-mismatch (serious) a[aria-label="Ir al inicio"]` after the waiver removal and before the component fix; GREEN after. Every other axe scan in the suite now runs unwaived.

### BUG-002: Console error `403 on /auth/v1/user` right after "Cerrar sesión"

- Severity: S4
- Flow / case: AU01-H2 (logout)
- Screen: S01 login (immediately after signing out of the app shell)
- Build: `85d202c`  Browser / device: Chrome 159 (Playwright chromium), 1280×720

Steps
1. Sign in with the demo account.
2. Click **Cerrar sesión** in the sidebar.
3. Watch the browser console / network panel on `/login`.

Expected: sign-out produces no failed requests — the session read is cancelled or answered locally; console stays clean.
Actual: one (sometimes two) `GET https://<project>.supabase.co/auth/v1/user` fires **after** `POST /auth/v1/logout?scope=global` has revoked the token and answers **403**, logged by Chromium as:

```
console error: Failed to load resource: the server responded with a status of 403 ()
  @ https://<ref>.supabase.co/auth/v1/user
```

CDP initiator stack: `auth-js _useSession → _request → _handleRequest → GET /auth/v1/user` — a session validation racing the logout revocation (the earlier concurrent read still carries the soon-to-be-revoked access token).
Reproduced: 2/2 Playwright attempts + 2/2 manual CDP probes (race: occasionally only the 200 twin arrives).
Evidence: `e2e/auth.spec.ts` AU01-H2 guard (waived with this bug id until fixed — waiver removed with this fix), CDP `Network.requestWillBeSent`/`responseReceived` trace captured in session.
Suspected cause: `signOut()` (lib/data/auth-supabase.ts) runs while another session reader (`getSession()` in the shell/guard path) is in flight; auth-js validates the old token against GoTrue after the global logout invalidated it.
Status: **fixed** (commit pending) — root cause + deterministic sign-out:

1. **Root cause (captured with a CDP probe)**: the racy `GET /auth/v1/user` is the shell's mount-time identity read — `Sidebar` runs `Promise.all([getSession(), getMyStudy()])`, and `getMyStudy` → `requireUser` → `supabase.auth.getUser()` hits the network (twice in dev under React StrictMode). Logging out quickly after landing on `/expedientes` (Playwright always; a fast human often) puts those requests on the wire while `POST /auth/v1/logout?scope=global` revokes the session; a response landing after the revoke is the console `403`. `getSession()` itself never hits the network.
2. `lib/supabase/client.ts`: the browser client now installs `authFetch` as `global.fetch` — it counts in-flight `/auth/v1/` requests, and from `startSignOut()` until `endSignOut()` it answers any NEW auth call **locally** with a synthetic 401 (the auth lib turns it into its typed "not signed in" error; nothing leaves the tab, so nothing can log a 403). Only `POST /auth/v1/logout` is allowed through while gated.
3. `lib/data/auth-supabase.ts` `signOutSupabase`: `await startSignOut()` (gate ON + bounded 5 s drain of auth requests already in flight → they still carry the valid token and answer 200) → `auth.signOut()` (the revoke) → `endSignOut()` in `finally`. No request can be in flight when the revoke lands, and none can start with the revoked token.
4. Waiver removed: `AU01-H2` in `e2e/auth.spec.ts` no longer ignores `status of 403`.
5. Tests (RED observed first, kept):
   - `e2e/auth.spec.ts` → AU01-H2 failed with `console error: Failed to load resource: the server responded with a status of 403 ()` after the waiver removal and before the fix; GREEN after.
   - `lib/data/auth-supabase.test.ts` → `sign-out determinism (BUG-002)`: revoke waits for the in-flight read (RED first: `authFetch`/`startSignOut` did not exist), local-401 gate, non-auth passthrough, revoke best-effort.

### BUG-003: Expedientes search is not accent- or typo-tolerant (must-row feature)

- Severity: S3
- Flow / case: F02-E3
- Screen: S07 expedientes list (`app/(app)/expedientes/expedientes-view.tsx`)
- Build: `85d202c`  Browser / device: Chrome 159 (Playwright chromium), 1280×720

Steps
1. Sign in and open `/expedientes`.
2. Type `gomez` (no accent) in "Buscar expedientes".
3. Then type `gomezz` (typo for "Gómez").

Expected: both queries find "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" — `replica/features.csv` must-row: *"accent and typo tolerant search"*.
Actual: neither query matches; the list shows the no-results state ("No encontramos coincidencias con tu búsqueda"). The filter is a plain case-folded `String.includes` over carátula/numero/juzgado/fuero, so `gómez` ≠ `gomez` and `gomezz` matches nothing. Typing the exact accented spelling works (that is the workaround).
Evidence: failing test `e2e/f02-expedientes.spec.ts` → `F02-E3 accent/typo tolerant search + emoji query` (56 passed / 1 failed / 1 skipped final run; this is the only failure).
Suspected cause: `expedientes-view.tsx` client-side filter uses `.toLowerCase().includes(...)` with no unaccent/fuzzy step (the build-log only lists filters/favorites/archive as M2 gaps, so this must-row part is treated as shipped scope).
Status: **fixed** (commit pending) — reusable helper + wiring:

1. **`lib/search.ts`** (new): `foldForSearch` (NFD → strip combining marks → lowercase → trim/collapse whitespace: `"Gómez"` → `"gomez"`, emoji untouched) + bounded `levenshtein` (≤ `maxDistance`, by code point, bails on length gap / whole DP row above the bound) + `searchMatches(query, haystack)`:
   - exact/substring first, on the folded strings — so `gomez`, `GOMEZ` and `gómez` all match "Gómez…", and punctuation queries like `90.111` keep working;
   - then typo tolerance: Levenshtein ≤ 2 between the **whole query / its last token** and any haystack token, only for inputs ≥ 4 chars — `gomezz` finds "Gómez" without ever turning the query into an OR over every token (`civil 4444` stays a miss).
2. **Wiring**: `app/(app)/expedientes/expedientes-view.tsx` filters `[caratula, numero, juzgado, fuero].join(" ")` through `searchMatches` instead of case-folded `includes`.
3. Tests (RED observed first, kept):
   - `lib/search.test.ts` (new, 19 tests): naive-implementation RED first (accent + typo + emoji-in-haystack cases failed), GREEN after;
   - `e2e/f02-expedientes.spec.ts` → F02-E3 (the previously failing test) flipped **GREEN unchanged** — not weakened.

### BUG-004: One plazo with an out-of-range fecha breaks the whole case detail ("No pudimos cargar el expediente.")

- Severity: S2
- Flow / case: F03-E14 (how it was born) → F06-H1 / F03-E12 / any case reader (impact)
- Screen: S08 case detail (`app/(app)/expedientes/[id]/case-detail-view.tsx` via `lib/supabase/pruebas.ts` / `lib/data/calendar.ts`)
- Build: `85d202c`  Browser / device: Chrome 159 (Playwright chromium), 1280×720 + REST probes

Steps
1. A prueba is saved with `fecha_efectiva = "61116-02-02"` (the date input accepted a 5-digit year — reproduced deterministically by typing into `<input type="date">`; the app performs no range validation, and the DB/trigger accept it: `plazos.fecha_limite = "61116-02-10T02:59:59+00:00"`).
2. Open that case's detail (`/expedientes/<id>`), or retry the save that reads the row back.

Expected: the detail renders (or the bad row is rejected/normalised with a typed error).
Actual: `new Date("61116-02-10T02:59:59+00:00")` → Invalid Date → `toArtIsoDate(...).toISOString()` throws `RangeError: Invalid time value` inside `mapPlazo`, so `listPruebas`/`createPrueba` reject and the screen shows **"No pudimos cargar el expediente." + Reintentar** for the ENTIRE case — the case becomes unreadable with no workaround. The same throw also aborted the save AFTER the rows were written (prueba + plazo persisted, notification/redirect never happened).
Evidence (verbatim):
- REST row: `"fecha_efectiva":"61116-02-02"`, `"fecha_limite":"61116-02-10T02:59:59+00:00"`; `new Date(...) → THROW: Invalid time value`.
- UI: main region `No pudimos cargar el expediente. | Reintentar` (reproduced twice via probe + failing runs before cleanup: `f06-notifications.spec.ts` F06-H1, `f03-prueba.spec.ts` F03-E12).
- Bad rows were removed from the dev DB after diagnosis (seed restored); the crash path in code remains.
Suspected cause: `mapPlazo` (`lib/supabase/pruebas.ts`) parses `fecha_limite` with `new Date(...).toISOString()` without validating, and `fecha_efectiva` has no client-side range check before insert (the engine's guards cover plazo quantity/horizon, not the anchor date).
Status: **fixed** (commit pending) — defense in depth, app-side only, no schema changes:

1. **Input guard**: `isValidFechaEfectiva` + `FECHA_EFECTIVA_MIN/MAX` (`1900-01-01..2100-12-31`, in `lib/data/errors.ts` so both drivers and the form share one bound) raises the new typed code `invalid_fecha_efectiva` (`ERROR_COPY`: *"La fecha efectiva tiene que estar entre 01/01/1900 y 31/12/2100."*) in **both** `createPrueba` drivers — fake (`lib/data/pruebas.ts`) and supabase (`lib/supabase/pruebas.ts`) — before any write. The add-prueba form also carries `min`/`max` + a Spanish hint on the date input.
2. **Mapper hardening**: `mapFechaLimite` (`lib/supabase/pruebas.ts`) maps a corrupt/out-of-range `fecha_limite` to `null` instead of throwing; the detail renders the documented "Fecha pendiente" fallback and the save no longer aborts after the rows are written.
3. **Tests (RED observed first, kept)**:
   - `lib/data/pruebas.test.ts` → `fake driver › createPrueba rejects an out-of-range fecha_efectiva with a typed error (BUG-004)`;
   - `lib/data/pruebas.test.ts` → `supabase driver › createPrueba rejects an out-of-range fecha_efectiva before any write (BUG-004)` (code + Spanish copy + zero network writes);
   - `lib/data/pruebas.test.ts` → `supabase driver › listPruebas maps a corrupt out-of-range fecha_limite to null, never throws (BUG-004)` (failed pre-fix with the verbatim `RangeError: Invalid time value` at `mapPlazo`);
   - `lib/data/pruebas.test.ts` → `supabase driver › createPrueba survives a corrupt fecha_limite read-back (BUG-004 save abort)`;
   - `e2e/f03-prueba.spec.ts` → **F03-N4** seeds the corrupt row through REST (trigger writes `61116-02-10T02:59:59+00:00`), asserts the case detail renders (heading + "Fecha pendiente", never the error panel) and cleans the rows up.

### BUG-005: Empty Etapa chip rendered for cases without a stage (list + detail header)

- Severity: S4
- Flow / case: F02-H1 (visual pass)
- Screen: S07 list "Etapa" column + S08 detail header (`app/(app)/expedientes/[id]/case-detail-view.tsx`, `expedientes-view.tsx`)
- Build: `85d202c`  Browser / device: Chrome 159, 1280×800 (screenshot in session: `shot-list.png`, `shot-detail.png`)

Steps
1. Sign in and open `/expedientes` (seeded cases have no `case_stages` link).
2. Look at the "Etapa" column; open any case and look at the header badges.

Expected: no stage → no chip, or a labelled fallback like the existing "Sin fuero" / "Sin número" pattern.
Actual: both seeded cases render an **empty coloured pill** — detail header shows `Judicial | (empty pill) | Civil y Comercial | 90.111/2026`, and the list "Etapa" column shows empty pills for every row. DOM probe: header badge texts `["E","Tu estudio","Judicial","","Civil y Comercial","90.111/2026"]` (one empty `rounded-pill`).
Evidence: screenshots above; DOM probe output in session. The same render path is what F02-H1 asserts around.
Suspected cause: `mapCase` maps a missing `etapa_id` to `""` and both views render `<Badge>{record.etapa}</Badge>` without the `|| "Sin etapa"` fallback they already apply to fuero/numero.
Status: **fixed** (commit pending) — `|| "Sin etapa"` added at both render sites, matching the sibling fallback pattern: list "Etapa" cell (`expedientes-view.tsx`) and detail header badge (`case-detail-view.tsx`, alongside `Sin fuero` / `Sin número`).

Tests (RED observed first, kept) in `e2e/f02-expedientes.spec.ts` F02-H1:
1. RED `getByRole("cell", { name: "Sin etapa" })` (list) → fixed list cell → GREEN;
2. RED `getByText("Sin etapa", { exact: true })` (detail header) → fixed header badge → GREEN.
Note: the detail assertions filter `.filter({ visible: true })` because Next 16 keeps the previous page in the DOM hidden with `display:none` (React `<Activity>`, `preserving-ui-state.md` — documented as affecting Playwright), so the hidden copy of the list also contains "Sin etapa" text.

### BUG-006: "Responsable:" renders with an empty value on the case detail

- Severity: S4
- Flow / case: F02-H1 (visual pass)
- Screen: S08 detail — "Última actividad" card
- Build: `85d202c`  Browser / device: Chrome 159, 1280×800 (screenshot in session: `shot-detail.png`)

Steps
1. Open a seeded case detail (`/expedientes/c0000000-0000-4000-8000-000000000001`).

Expected: a labelled value ("Sin responsable", "—", or the fallback name) like the "Información del expediente" card, which correctly shows `Responsable —`.
Actual: the "Última actividad" card prints `Responsable:` followed by **nothing** (screenshot: "13/11/2026, 07:51 p. m." then an empty "Responsable:" line). Triggered because the demo profile has `full_name = ""` and `cases.responsable` is null — but the render has no fallback, unlike the sibling card.
Evidence: screenshot above (detail header/cards).
Suspected cause: `case-detail-view.tsx` `Responsable: {record.responsable}` without `|| "—"`.
Status: **fixed** (commit pending) — fallback chosen: **the em-dash of the sibling card**, not the profile full name and not hiding the line, because the "Información del expediente" card renders empty values as `value || "—"` and this bug's expectation is that consistency ("like the sibling card"). `case-detail-view.tsx` now prints `Responsable: {record.responsable || "—"}`.

Test (RED observed first, kept) in `e2e/f02-expedientes.spec.ts` F02-H1: `getByText("Responsable: —")` failed while the card printed a dangling `Responsable:` → GREEN after the fix.

---

## Known gaps (planned — NOT bugs)

Tracked by `replica/build-log.md` (status "missing" columns) and `replica/features.csv` (clone = no/partial with M1 notes). Do not report these as defects:

| gap | where | milestone |
| --- | --- | --- |
| Onboarding wizard steps 4–5 of 5 | S03 | M2 |
| Filtros panel, favorites, archive, bulk bar, row ⋯ menu | S07 | M2 |
| Case-detail tabs beyond Resumen/Pruebas + full tab payloads | S08 | M2 (T6) |
| Per-type estados, person picker, historial in Agregar prueba | S12 | M2 |
| Notification bell panel, categories, pagination | S21 | M2 (T7) |
| Manual Movimientos log per case | S09 | M2 (features.csv must → clone no) |
| Tasks: creation, states, board (F04) | S16 | M2 (must → clone no) |
| Daily email digest, plazo reminder jobs | F03/F06 | M2 (Resend + Inngest) |
| Días inhábiles settings UI; official 2026/2027 feriados (`TODO(gap)`) | S30 | M2 |
| AI assistant / drafting (F05), S22/S24 | — | M2+ (could → clone no) |
| Meta Graph delivery, 24 h window, appointment booking | A01 / WA flows | M3 |
| WhatsApp bot flows 2–9 (qualification, case creation, FAQ, handoff, templates) | whatsapp-bot.md | M3 |
| Inbox **thread pane** (3 panes, quick replies, handoff banner, template picker) — M1 shipped the list + states only per build-log A01, while whatsapp-bot.md §4 requires the thread pane | A01 | scope decision to confirm with the user (M2/M3) |
| PJN/MEV/other portal connectors (F01) | S25 | not started (should → clone no) + needs real credentials |

## To check (not reproduced as bugs here)

1. **`ana.beltran@example.com` is rejected by GoTrue** — password grant answers `unexpected_failure` (evidence already on file from the backend phase). Do not use this address for the second-user RLS pass; create the second dashboard user with a real mailbox you control (auto-confirm ON) — exact steps in `replica/test-plan.md`, Step 3.
2. **Seed notification title/body mismatch** — the seeded row titled "Vence en 3 días: Contestar el informe pericial" carries a body about the *Informe contable del demandado* plazo (`supabase/seed.sql` content, cosmetic): confirm whether the title should name the actual prueba.
3. **`email_address_invalid` from GoTrue for syntactically valid test addresses** — signup attempts with `e2e.<ts>@example.test` and `e2e.<ts>@example.com` were answered `HTTP 400 {"code":"email_address_invalid"}` in some runs (raw response captured in the failing test output), while the same addresses at other times hit the normal `over_email_send_rate_limit` 429. Cause unknown (provider-side validation/quota interplay); the automated signup case skips with the raw reason rather than failing. Reproduce from the Supabase Auth logs when the email quota resets.
4. **Non-UUID case id shows the generic error state** — `/expedientes/<not-a-uuid>` makes the REST `id=eq.<text>` uuid cast fail → "No pudimos cargar el expediente." + Reintentar instead of the friendly "No encontramos este expediente…" missing state (valid-but-absent UUIDs behave correctly and ARE asserted by F02-N3). Low impact (links always carry real UUIDs); decide whether the route should validate the id shape.
5. **Multi-instance store** — `lib/data/store.ts` is per-process (fake driver only); irrelevant while `DATA_DRIVER=supabase`, but worth re-checking if the fake driver is ever used behind more than one process.

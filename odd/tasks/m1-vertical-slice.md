# M1 — Vertical slice (prove the stack)

Branch: `master` (repo has no commits yet; commits are held until the user asks for the first one).
Delivery: work-unit commits on `master` once commits are authorized; heuristic ~400 authored lines per unit.
Test runner: `npm test` (Vitest) — scaffolded in T1.

## Specs

Scope is exactly build order step 1 of `replica/architecture.md`:

> **Vertical slice (M1) — prove the stack:** sign up → wizard (minimal) → manual case → prueba with plazo → in-app alert → WhatsApp ping (webhook → bot reply).

- **S1 (S01/S02 auth):** email + password sign-up and login, no credit card. Feature row: "Email and password sign-up and login … no credit card required at sign-up".
- **S2 (S03 wizard, steps 1–3 only):** minimal onboarding wizard that creates the studio right after sign-up. Feature row: "Five-step onboarding wizard (jurisdictions / profile / studio) … creates the studio right after sign-up". Steps 4–5 are out of M1 scope (M2).
- **S3 (S07):** manual case creation + the expedientes list. Feature row: "Manual case creation … Module B MVP entry point; S07 Nuevo expediente".
- **S4 (S08):** case detail hub with Resumen cards + Pruebas tab. Feature row: "Case detail hub with tabs … Resumen cards + deep-link ?tab=".
- **S5 (S12):** add a prueba with a plazo; the fecha límite is computed by the data layer (never in the client). Feature rows: "Pruebas tracking (six evidence types)" and "Plazos engine (horas / corridos / habiles) … count starts the day after fecha efectiva".
- **S6 (S21):** in-app alert — a notification appears for the new plazo and is readable from the bell. Feature row: "In-app notification panel and page … read-on-click + deep links".
- **S7 (Module A, no reference screen):** WhatsApp ping — `GET|POST /api/webhooks/whatsapp` verify + inbound message → minimal inbox showing the bot reply. Everything in Module A is an assumption (Meta WhatsApp Business Cloud API).
- **S8 (data layer):** fake data layer with the same function signatures as the future Supabase/Drizzle layer, plus seed data, "so swapping in the real one changes no screen code".

Out of M1: steps 4–5 of the wizard, search/filters/favorites/archive, movements log, tasks, agenda, digest email, real Meta calls (webhook is verified and stored, bot reply is local), any `should`/`could` feature.

Rules in force: clean-room (no Veredicta HTML/CSS/JS/assets/copy), own wording for every label, tokens only (no raw hex/pixel values in components), skeleton loaders not spinners, Spanish voseo UI copy, English code/comments.

## Tasks

- [x] T1 — scaffold Next.js (App Router, TS, Tailwind) + wire `replica/design/` tokens + app layout (nav/header/sidebar) + primitives + seed. **DONE** by session B 2026-11-14 (15 files in `components/`, layout + route groups present).
- [x] T2 — routing stubs for every M1 screen. **DONE** by session B (10 `page.tsx` covering S01/S02/S03/S07/S08/S12/S21/bandeja).
- [x] T3a — `lib/plazos/` engine (day-after start, hábiles/corridos/horas, feria/feriados/días inhábiles, guards) with golden tests. **DONE** 2026-11-14: 21/21 `node --test lib/plazos/compute.test.ts`. Route: inline.
- [x] T3b — fake data layer (`lib/data/*`) with typed signatures + seed. **DONE** by session B 2026-11-14 (10 tests incl. "every seeded plazo agrees with the plazos engine").
- [x] T4 — S1 signup/login + S2 wizard steps 1–3. **DONE** by session B (wizard code verified: steps 1–3 of 5).
- [x] T5 — S3 case create + list (S07). **DONE** by session B (list + text search verified; filters/favorites/archive are M2).
- [x] T6 — S4 case detail Resumen + Pruebas tab (S08), S5 add prueba (S12). **DONE** by session B (`?tab=` deep link verified; informante is a plain input until Personas lands).
- [x] T7 — S6 notification bell (S21). **DONE** by session B (page + header bell render from the data layer).
- [x] T8 — S7 WhatsApp webhook. **DONE** 2026-11-14: handshake requires `WHATSAPP_VERIFY_TOKEN` (no hardcoded fallback), POST verifies `X-Hub-Signature-256`, stores each event exactly once (`markEventProcessed`) and runs the local bot; `GET /api/wa/conversations` feeds the inbox, which now lists, filters and handles every state. 9 new tests, lint/tsc/build clean. Graph delivery + 24 h window remain M3.
- [x] T9 — `replica/features.csv` clone column + `replica/build-log.md`. **DONE** 2026-11-14 by session A: 70 rows (5 yes / 6 partial / 52 no / 7 skip), tests re-run 34/34.

### Surfaces (two-session split, declared 2026-11-14)

Session B (the other one, shell + screens) owns: `app/**`, `components/**`, `public/**`, `lib/seed.ts`, `lib/types.ts`, `lib/auth-stub.ts`.
Session A (this one) owns: `lib/plazos/**`, `odd/tasks/m1-vertical-slice.md`, `replica/build-log.md` (final write).

**Seam contract for S5 (live fecha límite in `nueva-prueba-form.tsx`):** the form never computes a deadline. It imports `computeFechaLimite` from `lib/plazos` and receives `nonWorkingDays: ReadonlySet<string>` from the data layer (`lib/data`, session B). **LANDED 2026-11-14:** `lib/data/calendar.ts` exports the set, `lib/data/pruebas.ts` calls the engine, and `data.test.ts` asserts every seeded plazo agrees with it.

Risk line at close of each unit (high-risk items: 1 data/irreversible, 2 security, 3 contracts, 4 concurrency, 5 delivery/deps, 6 no test coverage).

## Log

- **L1** (recovered from Engram #670, yesterday's session, verbatim goal line): "Ingenieria inversa clean-room de Veredicta para una app propia de abogados (M-A: bot WhatsApp; M-B: expedientes criticos + vencimientos). Pack replica: recon -> architect -> design -> build. Sesion detenida tras \"guardalo y seguimos luego\"."
- **L2** (2026-11-13, user): "seguimos donde nos quedamos ayer!" → next step is `/replica-build` Step 1 (shell) + Step 2 (M1 vertical slice), per Engram #670 Next Steps.
- **L3** (2026-11-13): commits deferred — Engram #670 records "Primer commit del repo cuando el usuario lo pida"; work is staged in the working tree until the user authorizes the first commit.
- **L4** (2026-11-14, user): "la otra sesion esta delegando el shell de m1 (t1 y t2)" → surfaces split declared below; session A delivers T3a (plazos engine, 21/21 golden tests, RED→GREEN observed: first run failed with ERR_MODULE_NOT_FOUND for `./calendar.ts`, then passed). Session B was writing `app/` + `components/` + `lib/seed.ts|types.ts|auth-stub.ts` continuously from 10:39 to 10:52.
- **L5** (2026-11-14, user): "metele a lo que quedò pendiente" → session A closes T9: rewrites `replica/features.csv` clone column (70 rows: 5 yes / 6 partial / 52 no / 7 skip; the 8 `must` still `no` are exactly the M2/M3 rows) and writes `replica/build-log.md`. Verification: `npm test` (Vitest) 34/34 green (seed 3, plazos 21, data 10); T8 confirmed partial by reading the route (stub comment: signature/idempotency/bot reply "land in T8"); T9 evidence per row taken from code greps, not from memory. Feature doc T1–T9 now reflects who did what.
- **L6** (2026-11-14, user: "si" to "seguimos con T8") → T8 implemented by session A: `lib/data/webhook.ts` (HMAC verification, Meta payload parsing, idempotent loop), `markEventProcessed` + `waWebhookEvents` in the store, webhook route rewritten with required env secrets, `GET /api/wa/conversations` added, inbox rebuilt as `InboxView` (status filters that actually filter, loading/error/empty/no-results), dead `inbox-tabs.tsx` removed, `.env.example` added and un-ignored. Evidence: 43/43 tests (9 new), `eslint` OK, `tsc` OK, `next build` ✓ 6.0s. Also resolved advisory R3-10 (tabs were inert) and R3-8 (inbox row now truthful).

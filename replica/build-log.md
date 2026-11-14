# Build log — M1 vertical slice

Scope: step 1 of the build order in `replica/architecture.md` (sign up → wizard (minimal) → manual case → prueba with plazo → in-app alert → WhatsApp ping).
Runner: `npm test` (Vitest) — **34 tests green** as of 2026-11-14. Clean-room: every label and sentence is our own.

Two sessions worked this slice in parallel with declared edit surfaces (see `odd/tasks/m1-vertical-slice.md`, "Surfaces"): session A owned `lib/plazos/**`, session B owned `app/**`, `components/**` and `lib/data|seed|types|auth-stub`.

## Screens

| ID | date | status | missing | notes |
| --- | --- | --- | --- | --- |
| S01 signup | 2026-11-14 | done | — | email + password, no card; no test coverage yet |
| S02 login | 2026-11-14 | done | — | session stub only (`lib/auth-stub.ts`) until Supabase Auth lands |
| S03 onboarding | 2026-11-14 | partial | steps 4–5 of 5 (M2) | steps 1–3 verified in code: jurisdicciones → perfil → crear estudio |
| S07 expedientes | 2026-11-14 | partial | filters panel, favorites, archive, bulk bar (M2) | list + text search verified; row menu not started |
| S07 nuevo expediente | 2026-11-14 | done | — | writes through the data layer |
| S08 case detail | 2026-11-14 | partial | remaining tabs + full tab payloads (T6/M2) | Resumen + Pruebas tabs with `?tab=` deep link verified |
| S12 agregar prueba | 2026-11-14 | partial | per-type estados, person picker, historial (M2) | informante is a plain input pointing at Personas (directory is M2) |
| S21 notificaciones | 2026-11-14 | partial | read-on-click deep links, categories (M2) | page + header bell render from the data layer |
| A01 bandeja WhatsApp | 2026-11-14 | done | Meta Graph delivery + 24 h window (M3) | our own design, no reference screen; T8: lists conversations from `GET /api/wa/conversations` with status filters and loading / error / empty / no-results states |

## Infrastructure

- **T1/T2 shell** (session B): Next.js 16 App Router layout, sidebar/header/bottom bar, 9 primitives in `components/ui`, tokens from `replica/design/`, auth + app route groups.
- **T3a plazos engine** (session A): `lib/plazos/` mirrors `compute_fecha_limite()` from `replica/schema.sql` — day-after start, hábiles/corridos/horas, feria + feriados + studio días inhábiles, 23:59:59 ART, guards 1..5000 / 10 years. 21 golden tests, RED observed before GREEN.
- **T3b data layer** (session B): `lib/data/*` fake layer with typed signatures + seed, so the real Supabase/Drizzle layer can be swapped in without touching screen code. 10 tests, including "every seeded plazo agrees with the plazos engine".
- **Seam**: `lib/data/calendar.ts` exports `nonWorkingDays`; `lib/data/pruebas.ts` calls `computeFechaLimite` — no component computes a deadline (spec S5).
- **T8 webhook** (done 2026-11-14): `app/api/webhooks/whatsapp/route.ts` verifies `X-Hub-Signature-256` (HMAC-SHA256, constant time, `WHATSAPP_APP_SECRET`), requires `WHATSAPP_VERIFY_TOKEN` for the handshake with no hardcoded fallback, stores each Meta event exactly once (`lib/data/webhook.ts` + `markEventProcessed`, the fake `wa_webhook_events` unique index) and runs the local rule-based bot. `GET /api/wa/conversations` is what the inbox reads, because the webhook writes server-side. 9 unit tests cover signature, payload parsing, idempotency and the bot rules.
- **T9**: this log + `replica/features.csv` clone column (M1 rows marked yes/partial with M1 notes).

## Open items

- Official 2026/2027 Argentine feriado dates are still `TODO(gap)` — tests use fixtures.
- The two webhook secrets are now required: copy `.env.example` to `.env.local` or both routes answer 503.
- Meta Graph delivery (sending the bot reply to the client), the 24 h window and appointment booking are M3.
- Reminder jobs, daily digest and any Inngest work are out of M1.
- No screen has a screenshot in `replica/clone-screens/` yet (replica-diff input).
- Commits: none yet — repo has no commits; the user holds that decision.

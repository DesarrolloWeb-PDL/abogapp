# Architecture: {{working name — set later by /replica-brand}} (a rebuild of Veredicta's core features)

Scope: **Module B** (critical cases + procedural deadlines + alerts; reference = Veredicta, per `recon.md`) + **Module A** (WhatsApp client intake; NO reference — designed from scratch against Meta's official WhatsApp Business Cloud API, every Module A element is an **assumption**). MVP = the 19 `must` rows of `features.csv`. DB enum/status keys are Spanish domain vocabulary (single-language product, es-AR); identifiers and comments are English. `TODO(gap)` marks anything not decidable from the recon inputs.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js (App Router) + TypeScript | one framework for pages, route handlers and webhook endpoints; the recon shows a web-only SPA is enough (no native app, S38). |
| styling | Tailwind + tokens from replica-design | fastest path to the (undocumented) Veredicta visual layer once screenshots land; utility classes keep the reader/tables dense. |
| database | Postgres on Supabase | RLS puts multi-tenancy inside the database (48 tables, one policy each) instead of a hand-written authorisation layer per query. |
| ORM | Drizzle ORM | typed client that stays close to SQL — the plazos function, partial unique indexes and triggers are hand-written SQL anyway. |
| auth | Supabase Auth | same Postgres as the data, so `auth.uid()` feeds RLS directly; email/password for MVP, Google/passkeys/2FA in the should milestone. |
| payments | Stripe Checkout + Billing (phase 2, not MVP) | hosted checkout avoids handling cards; webhooks flip `studies.read_only` when a trial ends. |
| email | Resend | transactional + Mon–Fri digest with low setup cost and built-in deliverability tooling. |
| jobs | Inngest | sync needs durable retries with a 2 min–6 h backoff window (F01) that plain cron cannot express; runs on Vercel functions, no separate worker. |
| files | Supabase Storage | same RLS boundary as the rows; object paths are `{study_id}/…` and the storage policies enforce the tenant folder. |
| hosting | Vercel | zero-config App Router deploys, preview envs, cron/webhook latency close to Argentina. |
| WhatsApp (Module A) | **Meta WhatsApp Business Cloud API — ASSUMPTION** | official, no per-message markup and native template/window rules; **tradeoff vs Twilio**: Twilio abstracts WhatsApp/SMS in one SDK at per-message cost, Meta Cloud API is cheaper and first-party but we own webhook verification, template approval and quality-rating handling. |
| realtime | Supabase Realtime (inbox + reader badges) | already in the stack; used sparingly (WhatsApp inbox, unread badges), polling elsewhere. |

One database. No microservices: web, API routes, webhooks and Inngest functions all talk to the same Postgres; the "workers" are just scheduled functions.

## Schema

Tables: **48**. Access rules: **Supabase RLS** (policies written in `replica/schema.sql`; service role for jobs/webhooks, `is_member(study_id)` / `has_permission()` security-definer helpers for members).

Full SQL lives in `replica/schema.sql`. Grouped by domain:

| domain | tables |
| --- | --- |
| identity / study | `plans`, `profiles`, `studies`, `roles`, `memberships` |
| cases / sync | `case_stages`, `cases`, `movements`, `integrations`, `sync_runs`, `actuaciones`, `novedades`, `novedade_reads`, `inbound_emails`, `persons`, `case_partes` |
| deadlines (crown jewel) | `calendar_days` (feriados + feria + días inhábiles, with generated `origen`), `plazos` |
| pruebas | `pruebas`, `prueba_estado_hist`, `prueba_status_defs` |
| tasks / calendar | `task_statuses`, `tasks`, `event_categories`, `events`, `hearings` |
| documents | `documents`, `document_versions` |
| notifications | `notifications`, `notification_preferences` |
| AI / assistant (could) | `conversations`, `conversation_messages`, `drafts`, `ai_usage` |
| WhatsApp Module A (assumption) | `wa_contacts`, `wa_conversations`, `wa_messages`, `wa_webhook_events`, `wa_appointment_slots`, `wa_appointments` |
| config / library | `activity_logs`, `block_configs`, `templates`, `template_favorites` |
| billing (phase 2) | `subscriptions`, `fin_movements`, `fin_categorias` |
| jobs | `job_executions` |

**Relationship map:** `studies` 1–n `memberships, roles, case_stages, persons, cases, integrations, notifications, plazos…` (every tenant table carries `study_id`); `users` n–1 `roles` via `memberships`; `cases` 1–n `movements, actuaciones, novedades, tasks, events, hearings, pruebas, documents, case_partes, plazos` (case children use the composite FK `(case_id, study_id) → cases(id, study_id)` so a row can never leak across tenants); `pruebas` 1–n `plazos` (one row per estado-cycle) and 1–n `prueba_estado_hist`; `persons` 1–n `case_partes` + `pruebas.informante`; `integrations` 1–n `actuaciones, sync_runs, inbound_emails`; `conversations` 1–n `conversation_messages, drafts`; `drafts` n–1 `documents`; `wa_conversations` 1–n `wa_messages, wa_appointments`; `wa_appointments` n–1 `wa_appointment_slots`.

**RLS approach:** enable RLS on all 48 tables. 33 study-scoped tables share one generated policy pair (`using/check = is_member(study_id)`); user-scoped tables (`profiles, notifications, notification_preferences, ai_usage, conversations, conversation_messages, template_favorites`) check `auth.uid()`; `plans, templates, prueba_status_defs` are read-for-signed-in; `calendar_days` allows reading system rows (`study_id is null`) but writes only studio rows; `job_executions` and `wa_webhook_events` are RLS-on with **no** policies → service role only. Read-only mode (`studies.read_only`) is enforced in the data layer, not RLS, so the owner can still reach billing.

The four hardest constraints (also the ones the MVP cannot ship without):

```sql
-- 1) Plazos: the DB owns the computation; one fecha_limite per cycle (F03).
create trigger trg_plazos_compute
  before insert or update of study_id, fecha_efectiva, tipo, cantidad on plazos
  for each row execute function public.trg_plazos_compute();   -- -> compute_fecha_limite()
create unique index uq_plazos_case_prueba_cycle
  on plazos (case_id, prueba_id, estado_cycle) where prueba_id is not null;

-- 2) Sync/webhook idempotency: re-reads and Meta retries must be no-ops.
create unique index uq_actuaciones_case_portal_ref on actuaciones (case_id, portal_ref);
create unique index uq_wa_messages_provider_id on wa_messages (provider, provider_message_id)
  where provider_message_id is not null;
-- wa_webhook_events.event_key, inbound_emails.provider_message_id,
-- job_executions(job_name, slot_start), notifications(user_id, dedupe_key) same idea.

-- 3) Storage quota: reject the upload before it lands, keep the counter honest.
create trigger trg_document_quota before insert on documents
  for each row execute function public.chk_document_quota();
  -- raises 'storage quota exceeded: used of quota bytes' (errcode check_violation)

-- 4) One active Integration per (study, portal); one carátula per study.
create unique index uq_integrations_active
  on integrations (study_id, portal) where status <> 'desconectada';
create unique index uq_cases_study_caratula
  on cases (study_id, caratula) where deleted_at is null;
```

## API

`method path | does | who | input | output | flow`

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /api/auth/signup | create account (email+password, no card) via Supabase Auth | public | email, password, full_name | session, user | onboarding (S01/S02) |
| POST /api/studies | finish 5-step wizard: create study + `init_study_defaults()` | authenticated | name, jurisdictions, logo | study | onboarding (S03) |
| POST /api/members/invitations | email invite with role + expiry | owner/admin (has_permission) | email, role_id | membership(invited) | should (S28) |
| GET /api/integrations | portal catalogue + status chips | member | — | integration[] with status | F01 |
| POST /api/integrations | create + verify credentials (CUIT/CUIL), start first sync | owner/admin | portal, credentials | integration(status) | F01 |
| POST /api/integrations/:id/sync | trigger/resume sync ("en tandas"), guarded by advisory lock | owner/admin (or job) | — | sync_run | F01 |
| DELETE /api/integrations/:id | disconnect (status→desconectada, keeps cases) | owner/admin | — | ok | F01 |
| POST /api/integrations/:id/mev-forwarding | save the 6-step email-forwarding setup (no credentials) | owner/admin | forwarding address | integration.email_forwarding | F01 (MEV) |
| GET /api/cases | list, accent/typo-tolerant search, filters, 50/page | member | q, filters, cursor | cases[] | F02 |
| POST /api/cases | manual case creation (MVP entry point) | member (not read_only) | caratula, numero, fuero… | case | F02 / slice |
| GET /api/cases/:id | detail + Resumen cards + tab payload | member | — | case + aggregates | F02 |
| PATCH /api/cases/:id | edit, favorite, archive, soft-delete, pause sync | member | fields | case | F02 |
| GET /api/cases/:id/movimientos | hand-entered movement log | member | — | movements[] | F02 (S09) |
| POST /api/cases/:id/movimientos | add movement, pin | member | fecha, tipo, detalle | movement | F02 (S09) |
| GET /api/cases/:id/actuaciones | portal actuaciones with estado chips (synced only) | member | filters | actuaciones[] | F02 |
| GET /api/actuaciones/:id | reader payload: signed doc URL, prev/next, citations | member | — | actuacion + doc | F02 |
| PATCH /api/actuaciones/:id/read | mark read (drives unread badge) | member | — | ok | F02 |
| POST /api/cases/:id/pruebas | create prueba + insert its plazo (DB computes fecha_limite) | member | type, titulo, informante, fecha_efectiva, plazo{tipo,cantidad} | prueba + plazo | F03 |
| PATCH /api/pruebas/:id/status | change estado → historial + new plazo row (estado_cycle+1) | member | estado | prueba + new plazo | F03 |
| GET /api/tools/deadline-calculator | standalone calculadora de plazos (free, no case needed) | member | fecha_efectiva, tipo, cantidad | fecha_limite + copy text | F03 alt (S34) |
| GET /api/plazos | upcoming deadlines (agenda/Inicio/reminder views) | member | from, to, case_id | plazos[] | F03/F06 |
| GET /api/tasks | board/list payload, grouping + filters | member | group, filters | tasks[] | F04 |
| POST /api/tasks | create + assign (3-click happy path) | member | titulo, case?, responsable, vence_at… | task | F04 |
| PATCH /api/tasks/:id | state/assignee/priority/due (bulk endpoint for the bulk bar) | member | fields | task | F04 |
| POST /api/assistant/conversations/:id/messages | chat with page-level citations; quota gate before provider call | member (plan/trial quota) | message, context chips | answer + citations | F05 (could) |
| POST /api/drafts/:id/save | save draft into a case folder ("Guardar en Documentos") | member w/ doc-create permission | folder target | document | F05 (could) |
| GET /api/notifications | bell panel + /notifications page (20/page) | member | filters, cursor | notifications[] | F06 |
| PATCH /api/notifications/:id/read | mark one / all read (deep link on click) | member | id or all=true | ok | F06 |
| PATCH /api/notification-preferences | per-category in_app/email/push toggles | member | preferences | preferences[] | should (S21) |
| GET /api/webhooks/whatsapp | Meta webhook verification (hub.challenge) | Meta, verify-token checked | hub.mode, hub.verify_token, hub.challenge | challenge | Module A |
| POST /api/webhooks/whatsapp | inbound Meta events → inbox row → bot reply / handoff | Meta, X-Hub-Signature-256 verified | messages, statuses | 200 fast; work async | Module A |
| GET /api/wa/conversations | WhatsApp inbox list (bot/humano/cerrada, unread) | member | status filter | conversations[] | Module A |
| POST /api/wa/conversations/:id/reply | human sends a reply (in window) or approved template (out of window) | member | body \| template | message | Module A |
| POST /api/wa/conversations/:id/handoff | bot → human handoff (status='humano', assign) | member/system | reason | conversation | Module A |
| POST /api/wa/appointments | book an open slot (bot flow or human confirm) | system/member | slot_id, contact | appointment | Module A |
| GET /api/settings/calendar-days | días inhábiles with Origen (sistema/estudio) | member | month filter | calendar_days[] | plazos must (S30) |
| POST /api/settings/calendar-days | add/remove a studio non-working day (recompute pending plazos) | owner/admin | day, kind | calendar_day | plazos must (S30) |
| POST /api/roles | create/update role, ≤28 permissions, ≤50 roles | owner/admin | name, permissions[] | role | should (S27) |
| POST /api/persons | directory entry (feeds informante/parte pickers) | member | nombre, contactos | person | should (S30) |
| POST /api/cases/:id/documents | upload to case folder (quota + antivirus gate) | member, doc permission, not read_only | file | document | should (S18) |
| GET /api/documents/:id/preview-url | signed URL for the visor + versions list | member | — | url + versions | should (S19) |
| POST /api/billing/checkout | Stripe Checkout session for a plan | owner | plan, cycle | checkout url | phase 2 |
| POST /api/webhooks/stripe | subscription lifecycle → plan/quota/read_only | Stripe, signature verified | event | 200 | phase 2 |

**Webhooks in:** `GET/POST /api/webhooks/whatsapp` (Meta Cloud API, verify-token + HMAC signature), `POST /api/webhooks/stripe` (phase 2), inbound email for MEV forwarding — **TODO(gap):** Resend inbound-email support is unverified; fallback = Postmark/Mailgun inbound, same `inbound_emails` table.
**Webhooks out:** none in the MVP — notifications go in-app/email/push and WhatsApp outbound uses the Graph API directly (Google Calendar push is a could).

**Jobs (Inngest; schedules in UTC, ART = UTC−3, no DST):**

| job | schedule | what it does |
| --- | --- | --- |
| `sync-scheduler` | `*/30 11-23 * * 1-5` (every 30 min, 08:00–20:55 ART, Mon–Fri) | one run per integration behind an advisory lock; UPSERT actuaciones/novedades idempotently; 5-failure stop + backoff 2 min–6 h; first sync "en tandas" |
| `notice-fanout` | `*/5 11-23 * * 1-5` (every 5 min business hours) | new-actuation notifications; skips first-sync history and batches ≥25 acts that are ≥80 % of the case (F06) |
| `digest-daily` | `0 11 * * 1-5` (08:00 ART Mon–Fri) | Resend "Resumen diario" per member, honours `notification_preferences` |
| `plazo-reminders` | `0 10 * * *` (07:00 ART daily) | day-before + day-of for every open plazo and task `vence_at`; dedupe via `notifications(user_id, dedupe_key)`; also `assert_calendar_ready()` warning |
| `hearing-reminders` | `0 * * * *` (hourly) | event `source='audiencia'` starting within 1 h → notify |
| `wa-window-watch` | `0 * * * *` (hourly) | expire the 24 h Meta window (`window_expires_at`), flag template-only messaging, age the handoff queue |
| `cleanup` | `0 6 * * *` (03:00 ART) | purge soft-deleted >30 d, expired invites, `wa_webhook_events`/`job_executions` >30 d, trial → `read_only` flip |
| `calendar-seed` | `0 6 1 12 *` (yearly) | `seed_feria_year(y+1)` + reminder to load next year's feriados |

## The parts that bite

- **time zones:** Argentina is UTC−3 with no DST since 2009, so ART offsets are constant — but feriados, feria and `fecha_efectiva` are **dates**, not instants: `compute_fecha_limite()` builds the naive wall-clock in ART and only then converts to `timestamptz`. Cron schedules are UTC (07:00 ART = `0 10 * * *`). Never compute a plazo in the client: the trigger recomputes on write so API, UI and jobs cannot disagree. Cut-off hour for date-based plazos = 23:59:59 ART — **TODO(gap)**, not evidenced.
- **idempotency (webhooks):** Meta retries deliveries until it gets a 200 and may deliver the same message twice. `wa_webhook_events.event_key` (message id or payload hash) is unique, so retries insert-conflict into no-ops; verify `X-Hub-Signature-256` before touching anything, respond 200 immediately and process async. Same pattern for `job_executions(job_name, slot_start)`, `notifications(user_id, dedupe_key)`, `inbound_emails.provider_message_id`.
- **portal rate limits + credentials:** credentials are AES-GCM encrypted by the app before insert (key in Supabase Vault/KMS) and never logged; `consecutive_failures` is CHECKed `0..5` (stop after 5, F01), `next_retry_at` implements the 2 min–6 h backoff, and a partial unique index guarantees one active integration per (study, portal). Sync runs take a Postgres advisory lock per integration so two schedulers cannot race.
- **races on sync:** upserts are keyed on `(case_id, portal_ref)` / `(case_id, actuacion_id)` so concurrent runs converge instead of duplicating; `sync_runs(status='running')` is partially unique; case `last_activity_at` is updated by the sync, not by read paths.
- **multi-tenancy (RLS):** every tenant table has `study_id`; case children use composite FKs so a mismatched `(case_id, study_id)` cannot be inserted. `is_member()` is `security definer` with a pinned `search_path` to dodge policy recursion through `memberships`; jobs and webhooks run on the service role only (two tables have RLS with no policies on purpose). Cross-tenant bugs surface as empty results, not 500s — test with two studies in every e2e run.
- **email deliverability:** authenticate the sending domain (SPF/DKIM/DMARC) before the first digest; one digest per user per day (no per-event mail storm); `notification_preferences.email` is the unsubscribe path; Resend suppression lists must be surfaced as a profile warning.
- **file size/storage quotas:** per-file cap 25 MB (the only evidenced number — **TODO(gap)** for the real document limit), `chk_document_quota()` rejects the insert before the upload starts, `maintain_storage_counter()` keeps `studies.storage_used_bytes` honest on insert/delete, and the storage meter in S18 reads metadata, not bucket listing. Antivirus: `virus_status` goes `pending → clean|blocked` — **TODO(gap):** scanner choice (ClamAV container vs. scanned-API) is not in the inputs.
- **AI cost quotas:** gate on `ai_usage(user_id, week_start)` **before** calling the provider (trial = 5 consultas, evidenced); `effort` (bajo/medio/alto) multiplies cost so cap per study too; a failed provider call must not burn quota; every citation stored with the message so answers are auditable.
- **GDPR / Ley 25.326 (datos personales):** deletion = soft-delete + `cleanup` purge at +30 days across rows **and** storage objects; export = JSON/CSV of the study's rows before deletion; store the minimum (no DNI unless a portal requires it), encrypt portal credentials, and log every destructive action in `activity_logs`. MEV copies of forwarded emails are purged with the same job.
- **WhatsApp template/message-window rules:** free-form replies are only legal inside the 24 h window from the last client message (`window_expires_at`); outside it only pre-approved es-AR templates may be sent (quality rating can downgrade the number). Opt-in is mandatory (`wa_contacts.opt_in`), the bot must offer a human handoff (status `bot → humano`), and appointment offers must be idempotent against Meta's retries. Everything in Module A is an assumption pending the MetaJurídico/Whaticket recon.
- **plazos correctness (crown jewel):** golden tests against hand-computed dates for all three units, weekends, feriados, full January/July feria, study días inhábiles, the day-after start rule and corridos' no-roll-over; `seed_feria_year()` is idempotent; **TODO(gap):** official 2026/2027 feriado dates are not in the recon inputs and must be loaded from an authoritative source before M2.

## Build order

1. **Vertical slice (M1) — prove the stack:** sign up → wizard (minimal) → manual case → prueba with plazo → in-app alert → WhatsApp ping (webhook → bot reply).
   Screens: S01, S02, S03 (steps 1–3), S07 (create + list), S08 (Resumen + Pruebas tab), S12 (add prueba, live fecha límite), S21 (bell); Module A has no reference screen (our own minimal inbox).
   Tables: `plans, profiles, studies, roles, memberships, case_stages, cases, pruebas, prueba_status_defs, plazos, calendar_days, notifications, task_statuses, wa_contacts, wa_conversations, wa_messages, wa_webhook_events, job_executions`.
   Routes: `POST /api/auth/signup, POST /api/studies, POST|GET /api/cases, POST /api/cases/:id/pruebas, GET /api/plazos, GET /api/notifications, GET|POST /api/webhooks/whatsapp, GET /api/wa/conversations`.
2. **Must-haves, Module B (M2):** full wizard (S03), expedientes list/search/filters/favorites/archive (S07), case detail hub all tabs (S08), manual movement log (S09), pruebas six types + per-type estados + informante picker (S12), plazos engine + días inhábiles settings + reminders (F03, S30), task creation/assignment + five states (S16), notification panel/page + daily digest (S21, F06).
   Tables added: `movements, tasks, task_statuses, persons, case_partes, events, event_categories, notifications (full), calendar_days (settings writes)`.
   Routes added: `GET /api/cases/:id, PATCH /api/cases/:id, GET|POST /api/cases/:id/movimientos, PATCH /api/pruebas/:id/status, GET /api/tasks, POST|PATCH /api/tasks, PATCH /api/notifications/:id/read, GET|POST /api/settings/calendar-days, POST /api/persons`.
3. **Must-haves, Module A (M3):** WhatsApp intake bot with human handoff, conversation inbox, appointment booking — all assumption-flagged, provider = Meta Cloud API.
   Screens: our own — wa inbox, bot conversation flow, slot picker (no Veredicta S-ID).
   Tables added: `wa_appointment_slots, wa_appointments` (+ `persons` link for the contact).
   Routes added: `POST /api/wa/conversations/:id/reply, POST /api/wa/conversations/:id/handoff, POST /api/wa/appointments`.
4. **Should-haves (M4):** Google/passkey + 2FA (S01, S26), email invitations (S28), PJN + MEV connectors behind the port/adapter boundary + sync scheduler + rate-limit retry (S25, F01), actuaciones list + reader with citations (S10, S11), novedades feed two views (S05, S06), countdown color states (S12), deadline calculator (S34), kanban views (S16), agenda five views + categories/overlays + reader shortcuts (S17), file upload/preview/protected folders (S18, S19), notification preferences (S21), roles & permissions UI (S27), read-only mode, etapas + Personas directory (S30), mobile shell (S38), background sync status chips.
   Tables added: `integrations, sync_runs, inbound_emails, actuaciones, novedades, novedade_reads, documents, document_versions, hearings, notification_preferences`.
   Routes added: `GET|POST|DELETE /api/integrations*, POST /api/integrations/:id/mev-forwarding, GET /api/cases/:id/actuaciones, GET /api/actuaciones/:id, PATCH /api/actuaciones/:id/read, GET /api/tools/deadline-calculator, POST /api/members/invitations, POST /api/roles, PATCH /api/notification-preferences, POST /api/cases/:id/documents, GET /api/documents/:id/preview-url`.
5. **Could-haves (M5):** vista general matrix (S15), AI assistant chat/drafting/review + quota gating + own MCP endpoint (S22–S24, S36, F05), finanzas phase 2 (S31, S32), jurisprudencia via direct public SAIJ/JUBA queries + our smaller template library + herramientas (S33, S34, S35), collaborative editor (S20), activity log (S30), help/tutorial overlays (S37), dashboard block engine (S04), web push, other portal connectors (EJE/IOL/SED/PCJ), Google Calendar sync, AI-created tasks.
   Tables added: `conversations, conversation_messages, drafts, ai_usage, activity_logs, block_configs, templates, template_favorites, subscriptions, fin_movements, fin_categorias`.
   Routes added: `POST /api/assistant/conversations/:id/messages, POST /api/drafts/:id/save, POST /api/billing/checkout, POST /api/webhooks/stripe`.
6. **Fixes from replica-entrepreneur:** re-prioritise from real user evidence once that skill has run (placeholder — no fixes known yet).

Skipped everywhere (per `features.csv` skip rows): their content libraries, their AI prompts/MCP, their brand, their users/data, the portals themselves, the sworn-lawyer sign-up.

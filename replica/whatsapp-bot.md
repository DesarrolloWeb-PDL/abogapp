# WhatsApp bot specification — Module A (client intake)

Status: **all assumptions flagged** — Module A has no Veredicta reference
(`recon.md` out-of-scope) and the MetaJurídico/Whaticket recon is still pending.
This spec is written against `architecture.md` (tables, routes, jobs) and
`features.csv` (3 WhatsApp `must` rows). Screen IDs are `A01…`, distinct from the
Veredicta `S01–S38` IDs.

> **Language:** every user-facing string in this document is Argentine Spanish
> (rioplatense voseo, neutral-professional register) and is prefixed `[UI copy]`.
> Strings are written fresh for this clean-room build.

---

## 1. Purpose & scope

**In scope**

| # | Capability | features.csv row |
| --- | --- | --- |
| 1 | **Client intake** — greeting, opt-in, lead qualification (name, matter type, urgency), case data collection → creates a manual `cases` row through the same `POST /api/cases` the web app uses | WhatsApp intake bot (must) |
| 2 | **FAQ auto-reply** — business hours, what the studio handles, how to send documents, fees framing (no legal advice) | WhatsApp intake bot (must) |
| 3 | **Appointment booking** — proposes open slots from the firm's Agenda and books one, unique per slot | Appointment booking via WhatsApp (must) |
| 4 | **Case-status handoff** — routes "¿cómo va mi causa?" to a human (or to Module B data when available) with full conversation context | WhatsApp intake bot (must) |
| 5 | **Conversation inbox** — the studio reads and answers every thread (bot/human) | WhatsApp conversation inbox (must) |

**Out of scope**

- **Not a legal advisor.** No legal opinions, no plazo computations, no case
  strategy. Every answer that is generated or summarised carries the disclaimer
  `[UI copy] "Esto es orientación general, no es asesoramiento legal. Para tu caso concreto, consultá con una persona del estudio."`
- No payments, no document storage inside WhatsApp (links only), no mass
  marketing in MVP (phase 2, see flow 9).
- No silent auto-close of a conversation with an open handoff.

**Service levels (MVP):** bot answers instantly 24/7 inside its intent list;
human replies within business hours (09:00–18:00 ART, Mon–Fri —
**TODO(gap): unmeasured**, not decidable from the inputs).

---

## 2. Flows

Shared state (per `wa_conversations.status` + `wa_conversations.window_expires_at`):

```
nuevo ─▶ calificando ─▶ recogiendo_datos ─┬─▶ agendado ─▶ cerrada
        │                                 └─▶ caso_creado ─▶ cerrada
        ├─▶ en_espera ─▶ humano ─▶ cerrada
        ├─▶ en_espera (timeout) ─▶ bot (re-engaged, flow 6)
        └─▶ bloqueado (opt-out, flow 8)
window_expires_at = last inbound client message + 24 h (Meta rule, architecture.md "The parts that bite")
```

### Flow 1 — Greeting & opt-in
1. Inbound first message hits `POST /api/webhooks/whatsapp`; signature verified
   (`X-Hub-Signature-256`), `wa_webhook_events.event_key` dedupes Meta retries,
   respond 200 fast, process async.
2. Upsert `wa_contacts` (wa_id, name if known); **opt-in is mandatory** — the
   reply is only sent if `opt_in = true`, which the first outgoing message
   itself establishes (user messaged us = documented opt-in, stored with source
   `webhook` and timestamp).
3. Bot greets (WA-001) and shows the quick-reply chips: what the studio does,
   book a case, check a case status, fees.
4. **States:** `nuevo → calificando`.
5. **Edge cases:** message from an unsaved number (still a valid contact — no
   address-book requirement); media-only first message → text fallback asking
   to write the query; duplicate delivery (Meta retry) → no second greeting;
   message from another country/number → same flow, but tag `internacional`;
   template message received (user tapped a template) → do not re-greet, jump
   to the intent.

### Flow 2 — Lead qualification (name, matter type, urgency)
1. Bot asks for the name (WA-005) only if the profile name is absent.
2. Matter type via quick-reply chips (WA-003): familia, laboral, civil,
   comercial, cobranzas, penal, otra. Free text is accepted and mapped by
   keyword; unmapped → WA-021 (fallback) then handoff offer.
3. Urgency (WA-004): "Hoy", "Esta semana", "Este mes", "Solo consultar".
4. Store on `wa_contacts` / conversation metadata (no case is created yet).
5. **States:** `calificando`, resumable — if the user leaves and returns within
   the window, resume at the last unanswered question (do not re-ask).
6. **Edge cases:** user answers several questions in one message → parse all,
   ask only what is missing; user writes "hablar con una persona" at any point
   → jump to flow 6 immediately (qualification never blocks handoff); user goes
   silent → no nagging; after 24 h the window expires (flow 9).

### Flow 3 — Collect case data → creates a manual Case
1. Bot asks for **carátula** (WA-006), then **número de expediente**, then
   **juzgado/secretaría**, one field per message with a quick reply to skip
   ("Todavía no lo tengo").
2. Validate: carátula non-empty (min 3 chars), número free-text with digits
   preferred, juzgado free-text. On empty input, re-ask once, then offer skip.
3. Confirm the summary (WA-007a) → user confirms → bot calls
   **`POST /api/cases`** (the web app's own endpoint, `member` scope, not
   `read_only`) with `source: 'whatsapp'` and the contact linked
   (`persons` row, `cases` → responsible member **TODO(gap): unmeasured** —
   default: unassigned, the inbox shows a "sin responsable" chip).
4. Result: success → WA-007b (with a link to the case in the web app);
   failure → WA-019 (retry once, then offer human handoff; the data collected
   is kept in the thread so a human does not re-ask).
5. **States:** `recogiendo_datos → caso_creado → cerrada`.
6. **Edge cases:** carátula already exists in this study (unique
   `uq_cases_study_caratula`) → do not create a duplicate; reply
   `[UI copy] "Ya tenés un expediente con esa carátula en el estudio."` and link
   it; user sends a photo of the case cover → do not OCR in MVP, ask to type it
   (**TODO(gap): unmeasured** — OCR is phase 2); API timeout → WA-019 with
   retry; read-only study (trial ended) → creation blocked → WA-019 variant
   with `[UI copy] "El estudio está en modo lectura y no puede crear expedientes."` +
   human handoff offer.

### Flow 4 — FAQ auto-reply (business hours vs 24/7)
1. Keyword/intent match against a small FAQ set (hours, areas, how to send
   documents, where you are, whether you handle X).
2. Inside business hours: answer + chips to continue (WA-008).
3. Outside business hours: WA-009 (auto-reply stating hours + that the bot
   keeps taking data 24/7, and that a person will answer next business day).
4. FAQ answers are static, reviewed copy — **no LLM in MVP** (phase 2 fallback,
   see §5). Any answer that touches a specific case is *not* answered by FAQ:
   it goes to flow 6.
5. **States:** stays in the current flow state (FAQ is a side branch).
6. **Edge cases:** repeated identical question in 24 h → same answer, no
   escalation; question about fees → canned range-free answer + offer a
   consultation slot (never quote a price for a specific case);
   "¿es legal hacer X?" → disclaimer + handoff (legal advice is out of scope);
   unknown question → WA-021 then handoff offer.

### Flow 5 — Appointment booking (proposed slots, uniqueness per slot)
1. Trigger: "quiero un turno" chip, or bot offers it after qualification.
2. Bot reads **open slots** (`wa_appointment_slots`, seeded from the firm's
   Agenda `events` with category = turnos; **TODO(gap): unmeasured** — the
   exact seeding cadence is not in the inputs; MVP = manual slots created by
   members) and proposes 3 (WA-010) as interactive options.
3. User picks one → `POST /api/wa/appointments` with `slot_id` + `contact_id`.
   Uniqueness: a partial unique index on `wa_appointment_slots` guarantees one
   appointment per open slot, and the endpoint is idempotent against Meta
   retries (same `provider_message_id` → no double booking).
4. Confirmed → WA-011 + a `hearings`/`events` row in the Agenda (source
   `manual`) so the web app shows it; member gets an in-app notification.
5. **States:** `agendado → cerrada`.
6. **Edge cases:** slot taken between proposal and confirmation (race) →
   constraint violation → WA-012 with 3 fresh slots; user proposes a custom
   time → record as a request, handoff to a human (no auto-booking);
   booking outside business hours → still allowed (the slot is what matters);
   user cancels → confirm cancel → slot released, notification to the studio;
   no open slots → WA-010b offering the waiting list; window expired at
   confirmation time → still allowed (appointment replies are service messages
   inside the same conversation flow — **TODO(gap): unmeasured**, Meta approval
   may be required; fallback = approved template WA-017).

### Flow 6 — Human handoff (assign, queue, waiting)
1. Trigger: user asks for a person, bot fails twice on intent, case-status
   question, or a member clicks **Escalar** in A01.
2. `POST /api/wa/conversations/:id/handoff` → `status = 'humano'`, `reason`
   stored, conversation enters the queue (waiting state), bot stops replying.
3. Queue: first-unassigned-first-served; A01 shows the queue with position;
   `wa-window-watch` (hourly) ages the queue and flags items nobody picked up.
4. Member accepts → assigned to that member → WA-015 to the client, badge
   switches to `Humano` (component 26).
5. **States:** `en_espera → humano → cerrada`; timeout (10 min, **TODO(gap): unmeasured**)
   → bot re-engages with WA-014t and the conversation returns to the queue.
6. **Edge cases:** nobody online → waiting message still says next-business-day
   (WA-014b); member declines → back to queue, notify another member; user
   messages while waiting → bot acknowledges (WA-014c) but does not answer the
   substance; window expires while queued → free-form human reply is blocked,
   use the approved template (flow 9); studio closed permanently → auto-reply
   + opt-out offer.

### Flow 7 — After-hours + out-of-office
1. Clock check (ART, Mon–Fri 09:00–18:00, **TODO(gap): unmeasured**) before every
   bot reply.
2. Outside hours: WA-009 first, then the bot keeps running intake (flows 1–5)
   because it costs nothing and Meta's window is 24/7.
3. Out-of-office: a member sets an OOO note in A01 (or settings) → every reply
   carries it as a prefix line; handoffs during OOO show "fuera de horario" on
   the banner (component 28).
4. **States:** no dedicated state — a `hours` flag on the conversation view.
5. **Edge cases:** Argentine holiday → treated as after-hours (**TODO(gap): unmeasured**
   — reuse `calendar_days` once seeded); OOO ends → banner clears on next
   reload; user writes at 03:00 expecting a person → the WA-009 copy must say
   explicitly when a human answers.

### Flow 8 — Blocked / spam / opt-out (STOP handling)
1. Inbound `STOP`, `BAJA`, `CANCELAR`, `NO`, or Meta's unsubscribe keyword →
   `wa_contacts.opt_in = false`, `status = 'bloqueado'`.
2. One confirmation only (WA-016), then **all outbound to that contact stops**
   (hard stop in the send path, not only in the UI).
3. Manual re-opt-in: the user must message again (new inbound = new consent,
   logged with timestamp) or a member flips `opt_in` in A01 (logged in
   `activity_logs`).
4. **States:** `bloqueado` (terminal until re-opt-in).
5. **Edge cases:** Meta reports the number as blocked/rate-limited → stop
   sending, surface an error chip in A01 (WA-022), never retry-storm; spam
   (cold promotional inbound) → no reply beyond opt-out line, tag `spam`,
   exclude from all future templates; template re-engagement to a blocked
   contact is forbidden even in phase 2; double opt-out message → idempotent,
   no second confirmation.

### Flow 9 — 24-hour service window vs Meta template messages
1. `window_expires_at` = last inbound client message + 24 h; recomputed on every
   inbound, expired hourly by the `wa-window-watch` job.
2. **Inside the window:** free-form replies from the bot and from members
   (`POST /api/wa/conversations/:id/reply` with `body`).
3. **Outside the window:** free-form is blocked in the composer; only
   pre-approved es-AR **utility/marketing templates** can be sent (reply with
   `template`). A01 locks the composer to the template picker (component 30)
   and the countdown chip shows `Ventana vencida` (component 29).
4. **Marketing re-engagement templates = phase 2.** MVP ships only utility
   templates (appointment reminder, handoff notice, case-data confirmation).
   Any marketing template must respect `opt_in = false` as a hard stop and be
   reviewed for quality rating (a downgraded quality rating blocks sends —
   surface it as an A01 error chip).
5. **States:** `ventana_activa / ventana_por_vencer (≤6 h) / ventana_vencida`.
6. **Edge cases:** user messages again after expiry → window reopens, status
   flips back, bot resumes; template rejected by Meta → error chip + retry with
   another approved template; member tries to type free-form out of window →
   blocked with an explanatory line (WA-017), never a silent failure.

---

## 3. Message inventory

At least 12 required — 26 shipped. **Every `message` cell is `[UI copy]`
(Spanish, rioplatense voseo), written fresh.**

| id | trigger | message (UI copy) | type | notes |
| --- | --- | --- | --- | --- |
| WA-001 | first inbound message | `[UI copy] Hola, soy el asistente del Estudio. ¿En qué te puedo ayudar? Podés agendar un turno, dejarnos los datos de tu causa o consultar por una que ya tenés.` | interactive | chips: WA-001a "Quiero agendar un turno" / WA-001b "Dejar datos de mi caso" / WA-001c "Consultar mi caso" / WA-001d "Hablar con una persona"; establishes opt-in (flow 1) |
| WA-002 | opt-in confirmed | `[UI copy] Listo. Te vamos a responder por este número de WhatsApp dentro de nuestro horario, y el asistente atiende a cualquier hora. Si no querés más mensajes, respondé BAJA.` | text | records `opt_in=true` + timestamp; mentions STOP keyword (flow 8) |
| WA-003 | qualification: matter type | `[UI copy] ¿Qué tipo de consulta es?` | interactive | chips: Familia / Laboral / Civil / Comercial / Cobranzas / Penal / Otra; free text accepted → keyword map; unmapped → WA-021 |
| WA-004 | qualification: urgency | `[UI copy] ¿Con qué urgencia lo necesitás?` | interactive | chips: "Necesito atención hoy" / "Esta semana" / "Este mes" / "Solo quiero consultar" |
| WA-005 | qualification: missing name | `[UI copy] ¿Cómo te llamás?` | text | skipped when the WhatsApp profile name exists |
| WA-006 | case data: step 1 | `[UI copy] Pasame la carátula del expediente. Si todavía no la tenés, elegí "Todavía no lo tengo".` | interactive | chip "Todavía no lo tengo"; then número, then juzgado (one field per message) |
| WA-007a | data complete, before creating | `[UI copy] Revisá los datos: carátula ${caratula}, expediente ${numero}, juzgado ${juzgado}. ¿Los creo?` | interactive | chips "Sí, crealo" / "Quiero corregirlo"; confirmation required before the API call |
| WA-007b | `POST /api/cases` 201 | `[UI copy] Creé tu expediente. Ya lo vas a ver en el estudio, y acá te voy a avisar de las novedades que mandemos.` | text | idempotent on the client side; links to the web app deep link |
| WA-008 | FAQ inside business hours | `[UI copy] Nuestro horario es de lunes a viernes de 9 a 18. Atendemos causas de familia, laboral, civil, comercial y cobranzas. Para mandar un documento, respondé con el archivo y lo adjuntamos al expediente.` | text | static reviewed copy, no LLM (flow 4) |
| WA-009 | FAQ or greeting outside hours | `[UI copy] Estamos fuera de horario: de lunes a viernes de 9 a 18 respondemos las consultas de una persona. El asistente sigue tomando tus datos a cualquier hora y el próximo día hábil te respondemos.` | text | after-hours branch of flow 7; copy states exactly when a human answers |
| WA-010 | booking: propose slots | `[UI copy] Tengo estos turnos disponibles. ¿Cuál te sirve?` | interactive | 3 chips from `wa_appointment_slots`; no slots → WA-010b `[UI copy] No me quedan turnos esta semana. ¿Te anoto en la lista de espera?` |
| WA-011 | booking confirmed | `[UI copy] Listo, te anoté para el ${fecha} a las ${hora}. Te vamos a recordar el día anterior. Si necesitás cambiarlo, respondé ACAMBIAR.` | text | unique slot enforced by index + idempotent on Meta retries |
| WA-012 | slot taken (race / constraint) | `[UI copy] Ese turno lo acaban de ocupar. Te propongo estos otros:` | text | re-reads 3 open slots; edge of flow 5 |
| WA-013 | handoff triggered | `[UI copy] Te paso con una persona del estudio. En horario hábil te responden el mismo día; si es fuera de horario, el próximo día hábil.` | text | sets `status='humano'`, bot stops; flow 6 |
| WA-014 | queued, nobody accepted yet | `[UI copy] Tu consulta está en cola. Ya la está viendo el equipo del estudio.` | text | queue position is shown in A01 as `[UI copy] "Hay 1 conversación antes que la tuya"`; edge variants WA-014b / WA-014c / WA-014t below |
| WA-014b | queued and nobody is online (after hours) | `[UI copy] Tu consulta quedó guardada. Como estamos fuera de horario, un integrante del estudio la retoma el próximo día hábil.` | text | flow 6 edge case; copy states exactly when a human answers |
| WA-014c | client writes again while still queued | `[UI copy] Recibí tu mensaje. La consulta sigue en cola y te responde una persona en cuanto puedan tomársela.` | text | acknowledges without answering the substance (flow 6) |
| WA-014t | handoff timeout (nobody picked it up) | `[UI copy] El equipo todavía no tomó tu consulta, volví con el asistente para seguir mientras tanto.` | text | 10-minute timeout **TODO(gap): unmeasured**; returns the thread to the queue |
| WA-015 | member accepts the conversation | `[UI copy] ¡Hola! Soy ${nombre} del estudio. Ya veo tu consulta, te respondo en un momento.` | text | badge switches to `Humano` (component 26) |
| WA-016 | inbound STOP / BAJA / CANCELAR / NO | `[UI copy] Listo, no te vamos a escribir más por WhatsApp. Si querés volver, escribinos cuando quieras y reactivamos la conversación.` | text | sets `opt_in=false`; one confirmation only; hard stop in the send path |
| WA-017 | member or bot tries free-form out of window | `[UI copy] La ventana de 24 horas con este número venció: solo puedo enviar mensajes de plantilla aprobada hasta que la persona nos escriba de nuevo.` | text | also rendered as helper text in A01's locked composer (component 30) |
| WA-018 | marketing re-engagement (phase 2) | `[UI copy] Hace tiempo que no hablamos. Si seguís con esa consulta, escribinos y seguimos donde lo dejamos.` | template | **phase 2 only**, utility/marketing template pre-approved by Meta; forbidden when `opt_in=false` |
| WA-019 | `POST /api/cases` failed (timeout / 409 / read-only) | `[UI copy] No pude crear el expediente ahora. Guardé todos los datos que me pasaste: un integrante del estudio lo carga a mano y te avisa.` | text | retry once, then offer handoff; never lose collected data |
| WA-020 | any generated/summarised answer | `[UI copy] Esto es orientación general, no es asesoramiento legal. Para tu caso concreto, consultá con una persona del estudio.` | text | **mandatory disclaimer** on every AI-ish answer (phase-2 LLM inherits this) |
| WA-021 | intent not understood (2 failures) | `[UI copy] No te entendí bien. Podés reescribirlo, elegir una opción o pedir que te atienda una persona.` | interactive | chips: "Repetir" / "Ver opciones" / "Hablar con una persona"; never loops more than twice |
| WA-022 | Meta rejected the send (quality/rate-limit/invalid template) | `[UI copy] No se pudo enviar el mensaje. El equipo ya vio el error en la bandeja.` | text | internal only where possible; A01 shows the error chip + Reintentar; no retry storms |

---

## 4. Inbox screen spec — `A01 Bandeja WhatsApp`

**Entry:** sidebar item **Bandeja** (added below **Expedientes**, Main group of
the sidebar; icon `message-circle`, Lucide). Mobile `<768px`: bottom-bar item
**Bandeja** inside the Menú screen (**TODO(gap): unmeasured** — whether it earns
a permanent bottom-bar slot vs living only in Menú; MVP = Menú screen, promoted
only if usage justifies it). Route: `/bandeja` (own route, not part of the
Veredicta `S`-ID set).

**Layout (desktop ≥1024px):** three panes —
1. **List pane 360px** (component 24): filter tabs with counts, search, rows.
2. **Thread pane (flex)** (component 25): header (contact, Bot/human badge (26),
   24h-window countdown chip (29), ⋯ menu), messages, handoff banner (28) when
   active, composer (human reply / quick replies (27) while bot-active / template
   picker (30) when window-expired).
3. **Info rail 280px (toggleable):** contact data, linked expediente (deep link
   to the Module B case created by flow 3), qualification tags (materia,
   urgencia), internal notes, "Escalar" action.

**Layout (<768px):** list → full-screen thread with back arrow; info rail as a
sheet; composer above the safe area.

**Components used:** 24 conversation list · 25 chat thread · 26 bot/human badge ·
27 quick reply chips · 28 handoff banner · 29 24h-window countdown chip ·
30 message template picker · plus shared: 1 sidebar nav (with the new Bandeja
item), 3 search+filter bar, 17 status chips, 6 dialogs, 7 toasts, 23 padlock
(send permission / read-only).

**States (all required):**

| state | list row | thread |
| --- | --- | --- |
| empty | `[UI copy] Todavía no hay conversaciones de WhatsApp` + hint to share the number | placeholder with the number to share |
| bot-active | badge `Bot`, unread count, snippet = last bot line | quick-reply chips enabled, composer for members is "observar" mode |
| waiting (queued) | badge `En espera` (`warning`), queue position | handoff banner (28) with position + "Aceptá" for members |
| escalated (human) | badge `Humano` + member name (`success`) | free composer enabled, internal-note mode |
| window-expired | chip `Ventana vencida` (`danger`) | composer locked → template picker (30), countdown chip red |
| failed send | red retry icon + `danger` chip on the row | message bubble `danger-tint` + `[UI copy] "No se pudo enviar. Reintentar"` |
| blocked / opt-out | badge `Bloqueado`, read-only row | composer disabled with `[UI copy] "Contacto dado de baja"` |
| loading / error | skeleton rows / `[UI copy] "No pudimos cargar la bandeja"` + Reintentar | banner + retry, thread never silently blank |

**Interaction rules:** selecting a row marks it read (unread is per member,
same rule as Module B notifications); bot and member messages share one ordered
timeline; every send shows a state (sending → sent → delivered/read or failed);
internal notes are visually distinct and never leave the studio;
**destructive actions (cerrar conversación, bloquear contacto) are confirmed**
by dialog (component 6).

---

## 5. Assumptions flagged

1. **Provider = Meta WhatsApp Business Cloud API.** *Tradeoff vs Twilio:* Twilio
   abstracts WhatsApp/SMS behind one SDK at per-message cost, while Meta's
   Cloud API is first-party and cheaper but we own webhook verification,
   template approval and quality-rating handling (`architecture.md` stack row).
2. **Bot logic = rule-based intents first** (keyword + chip routing, static FAQ),
   **LLM fallback in phase 2** — and any LLM-generated answer must carry
   WA-020's disclaimer. Rationale: predictable cost, auditable copy, no legal
   advice from a probabilistic model in MVP.
3. **MetaJurídico/Whaticket recon still pending** — every flow above, the
   business hours (09:00–18:00 ART), the 10-minute handoff timeout and the
   inbox IA are assumptions to be refined when that recon runs. Marked
   `TODO(gap): unmeasured` where the inputs cannot decide.
4. Slot seeding from the Agenda, the responsible-member default for
   WhatsApp-created cases, and Meta's approval requirement for appointment
   confirmations out of window are likewise `TODO(gap): unmeasured`.

---

## 6. Routes to add (architecture.md has no entry for these)

`architecture.md` already covers: `GET|POST /api/webhooks/whatsapp`,
`GET /api/wa/conversations`, `POST /api/wa/conversations/:id/reply`,
`POST /api/wa/conversations/:id/handoff`, `POST /api/wa/appointments`
(and tables `wa_contacts, wa_conversations, wa_messages, wa_webhook_events,
wa_appointment_slots, wa_appointments`). The flows above additionally need:

| method path | does | who | needed by |
| --- | --- | --- | --- |
| `GET /api/wa/conversations/:id` | thread payload: messages, window state, handoff/assignee, linked case | member | A01 thread pane (component 25) |
| `PATCH /api/wa/conversations/:id/read` | mark read per member (unread badge) | member | A01 list, flow 6 |
| `GET /api/wa/slots` | open appointment slots to propose (idempotent read) | member/system | flow 5 (WA-010) |
| `PATCH /api/wa/contacts/:id` | opt-in / opt-out / tag (`spam`, `internacional`), logged in `activity_logs` | member (manual) / system (STOP) | flow 8, flow 1 |
| `GET|POST /api/settings/wa-hours` | business hours + out-of-office note feeding WA-009/WA-013 | owner/admin | flows 4, 7 |
| `GET /api/wa/templates` | list Meta-approved templates + their variable schema for the picker | member | flow 9, component 30 |

Also implied (already in `architecture.md` but not yet wired for Module A):
the `wa-window-watch` job must write `window_expires_at` and age the handoff
queue — confirm the job's payload covers `wa_appointments` cleanup on cancel.

**features.csv coverage check (WhatsApp `must` rows):**
`WhatsApp intake bot (Module A)` → flows 1–4, 6–9 + WA-001…WA-022;
`WhatsApp conversation inbox` → §4 A01 + components 24–30;
`Appointment booking via WhatsApp` → flow 5 + WA-010/WA-011/WA-012 + `GET /api/wa/slots`.
Non-WhatsApp `must` rows the bot reuses rather than reimplements: manual case
creation (`POST /api/cases`, flow 3), notifications (appointment + handoff
alerts reuse `notifications`), agenda/events (booked slot writes an `events`
row).

---

## 7. Admin de mensajes — `/configuracion/bot` (WhatsApp Unit 1)

**Entry:** sidebar item **Configuración** (below Notificaciones, icon
`settings`, Lucide — `components/shell/main-nav.tsx`). Route
`/configuracion/bot`, own route like A01 (not part of the Veredicta `S`-ID
set). Mobile `<768px`: no bottom-bar slot yet (the bar keeps Expedientes /
Bandeja / Avisos), so the screen is reachable from the desktop sidebar or
by URL — promoted to the bar only if usage justifies it.

**Why:** Module A's greeting was hardcoded in `lib/data/bot.ts` and the
off-hours / handoff strings had no home at all. This unit externalises all
three into one study-level row so the studio edits the bot's copy without a
deploy.

**Storage — `bot_settings`** (migration
`supabase/migrations/20261117120000_bot_settings.sql`, mirrored in
`replica/schema.sql`): one row per study (`study_id` PK, `on delete
cascade`), `enabled boolean`, three `text` columns with 1..500-char checks,
`created_at`/`updated_at` (the `set_updated_at` trigger attached
explicitly — the init migration's DO loop only covered the tables that
existed when it ran), RLS enabled with `is_member(study_id)` SELECT/UPDATE
policies plus an explicit INSERT `with check` (the app upserts the defaults
when a row is missing; no DELETE policy on purpose). Seeded twice: the
migration backfills every existing study, `init_study_defaults()` gives
every NEW study the row — both fill from the column defaults, which are
byte-identical to `DEFAULT_BOT_SETTINGS` in `lib/data/bot.ts` (**keep the
two in sync**).

**Form** (`app/(app)/configuracion/bot/`, all `[UI copy]`, rioplatense
voseo):

| element | copy |
| --- | --- |
| heading | `Configuración del bot` |
| toggle | `Bot activado` → `El bot responde a los saludos de tus clientes.` / `El bot está en pausa: no responde a los mensajes.` |
| field | `Saludo` — hint `Respuesta del bot cuando alguien escribe un saludo, por ejemplo «hola».` |
| field | `Fuera de horario` — hint `Texto para avisar el horario de atención: lunes a viernes de 9 a 18.` |
| field | `Traspaso a humano` — hint `Texto para avisar que la consulta la retoma una persona del estudio.` |
| actions | `Guardar cambios` → toast `Guardamos la configuración del bot.` · `Descartar cambios` |
| inline errors | `El saludo no puede quedar vacío.` (and the same shape per field, plus `… no puede superar los 500 caracteres.`) |
| load error | `No pudimos cargar la configuración del bot.` + `Reintentar` |

States: loading skeleton (`aria-busy`), error + Reintentar — this doubles
as the M1 "no permission" state, since RLS returns a row only to members —
and the ready form with per-field inline errors. Validation runs twice: per
field in the form (precise Spanish copy) and in the data layer
(`updateBotSettings`: non-empty trimmed copy, ≤500 = `BOT_MESSAGE_MAX`,
boolean `enabled`, typed `missing_fields`), before anything reaches a
store.

**Rules vs copy:** `decideBotReply(status, text, settings?)` keeps every
RULE in code (STOP, status gating, the greeting trigger) and takes the
strings from `settings`:

- `greeting` replaces the built-in `GREETING_REPLY` (fallback when absent);
- `enabled: false` keeps the bot silent — STOP still closes the
  conversation, because opt-out is never gated on the bot being on;
- callers that pass no settings (fake driver, failed reads) behave exactly
  as before this unit existed.

The webhook reads the row **once per inbound message** through
`getBotSettingsSupabase(studyId, client)` with its service-role client (no
N+1) and falls back to the built-in defaults when the read fails — a
settings outage must never stop the bot from answering.

**Scope notes (M1):**

- `off_hours` (WA-009) and `handoff` (WA-013) are stored, validated and
  editable but NOT yet consumed by any rule: the after-hours clock check
  (flow 7) and the handoff trigger (flow 6) arrive with Unit 2 — which
  needs no further migration for them, by design.
- **Permission gap:** ANY member can edit the bot copy (RLS `is_member`
  only) — no owner/admin gate. Whether "configurar el bot" becomes an S27
  permission key is left to the roles work.
- The non-greeting acknowledgement (`DEFAULT_REPLY`) stays a code constant:
  `bot_settings` holds only the three study-editable strings.

**Unit-2 prep shipped in the same migration:** `alter table wa_conversations
add column if not exists last_inbound_at timestamptz` — the column has
existed since `20261114120000_init.sql` and in `replica/schema.sql`, so the
statement is an idempotent guard that keeps any older database in step.
Meta's 24 h customer-service window (flow 9) computes
`window_expires_at = last inbound + 24 h` from this column, which
`meta-webhook.ts` has written on every delivery since T8.

**Tests:** `lib/data/bot-settings.test.ts` (bot uses the settings — custom
greeting appears in the reply; validation rejects empty/oversized;
supabase upsert-defaults with a mocked client; fake-driver parity) and
`e2e/bot-settings.spec.ts` (login → Configuración → change the greeting →
save → signed webhook → the new greeting in the inbox thread; skips with a
printed reason until the migration is applied; restores the defaults in
`finally`).

---

## 8. Outbound delivery — WhatsApp Unit 2

The reply the bot already stored locally is now delivered through the Meta
Graph API, the 24 h window gates the send, and Meta's delivery receipts
come back onto the same row.

### Sender — `lib/supabase/wa-graph.ts`

- `sendWhatsAppText({ to, type: "text", text })` POSTs to
  `https://graph.facebook.com/{WHATSAPP_API_VERSION|v21.0}/{WHATSAPP_PHONE_NUMBER_ID}/messages`
  with `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}` and the body
  `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`.
  `to` is the wa_id (digits only): the webhook stores E.164 with `+`
  because of `wa_contacts_phone_e164_check`, and `toWaId()` strips it on
  the way out.
- Plain `fetch`, ~10 s abort, no SDK.
- **Never throws.** Every failure is `{ ok: false, reason }` with a typed
  reason: `not_configured | outside_window | rate_limited |
  invalid_recipient | timeout | network_error | api_error`.
- **Config guard:** without `WHATSAPP_ACCESS_TOKEN` or
  `WHATSAPP_PHONE_NUMBER_ID` the sender answers `not_configured` before
  any network I/O and logs once per process. The webhook keeps working
  inbox-only — the reply is stored, the send is recorded as failed with
  that reason, nothing fails. This is the state until the real token
  arrives.
- `.env.example` documents `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID` and the optional `WHATSAPP_API_VERSION`
  (default `v21.0`), with no values. Secrets stay server-side: the module
  is reached only from the webhook path and never lands in a client bundle.

### Graph error mapping (by numeric `code`, as Meta recommends)

| code | meaning (Meta's error table) | reason |
| --- | --- | --- |
| 131047 | more than 24 h since the recipient last replied | `outside_window` |
| 131026 | unable to deliver (not on WhatsApp / old app / no ToS) | `invalid_recipient` |
| 131021 | sender and recipient are the same number | `invalid_recipient` |
| 130429, 131056, HTTP 429 | rate limit | `rate_limited` |
| anything else (incl. bad token, 5xx) | — | `api_error` |

**Correction against the unit brief:** the brief listed 131026 as the
"recipient outside the 24 h window" code. Meta's table says the opposite —
the window rejection is **131047**, while 131026 is *Message
Undeliverable*. Labeling 131026 as the window would paint `Fuera de
ventana` over a number that simply cannot receive WhatsApp messages, so
each code maps to its real meaning; both still end as a recorded typed
failure. Source: `developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes`.

### Window rule (flow 9)

- Every inbound delivery stamps `wa_conversations.last_inbound_at = now()`
  (and `window_expires_at = now + 24 h`) — that write has existed since
  T8; Unit 2 only relies on it.
- `withinWindow(conversation, now?)` implements
  `now - last_inbound_at <= 24 h`, falling back to `window_expires_at` and
  answering `false` when neither exists (a conversation that never
  received a message has no window).
- The gate lives in exactly one place: `deliverOutbound(message,
  conversation, { sender?, supabase? })`. The bot's reply is inside the
  window by construction (it was just stamped), so the gate exists for
  human/late replies — outside it **no Graph call is made** (Meta would
  answer 131047 anyway) and the row is marked `failed` +
  `error = outside_window`.
- A delivery failure never fails the webhook: the row already holds the
  reply, the outcome is written back as `status` + `error`, and the
  handler still acknowledges Meta with a 200 (a 500 would make Meta retry
  the same delivery forever).

### Statuses

`wa_messages` already carried everything this unit needs — **no
migration**: `provider_message_id text`,
`status text check (in ('received','sent','delivered','read','failed'))`,
`error text`, `payload jsonb`.

- **On send:** the outbound row is inserted first — with the exact Graph
  body in `payload`, recorded *before* the attempt as an audit trail —
  and then updated. Graph ack → `status = sent` +
  `provider_message_id = <wamid>`; failure → `status = failed` +
  `error = <reason token>`. The insert starts at `failed` because the
  check constraint has no `pending`/`unsent` value and a row Meta has not
  confirmed must not claim `sent`; `deliverOutbound` overwrites it within
  the same request (adding a `pending` value would need a migration this
  unit does not require).
- **Receipts:** `parseStatusUpdates()` (`lib/data/webhook.ts`) reads
  `entry[].changes[].value.statuses[]`;
  `processStatusUpdatesMeta()` applies them, matching on
  `provider + direction = out + provider_message_id`. Idempotent on
  `${id}:${status}` through the same `wa_webhook_events` claim/release
  gate as inbound messages, and the counts fold into the route's existing
  `accepted` / `duplicates`, so the response shape is unchanged. `sent`,
  `delivered` and `read` therefore arrive with no further work.
- One vocabulary in `wa_messages.error`: the typed reason tokens above —
  including Meta's async `failed` receipts, whose code goes through the
  same `mapGraphErrorCode()` table (e.g. 131047 → `outside_window`).

### Status chip in A01 — NOT shipped (TODO)

The schema has the status column, but A01 in M1 renders **only the
conversation list**: there is no thread pane and no message bubble to
attach a delivery chip to, and neither `WaConversation` nor
`listConversationsSupabase` carries message-level status. Wiring it
through `GET /api/wa/conversations` would touch files outside this unit's
surfaces and would redesign the list row (§4 places the chip on the
message bubble, component 25). The chip ships with the thread pane; the
copy is ready:

| state | `wa_messages` | chip |
| --- | --- | --- |
| ack from Meta | `sent` / `delivered` / `read` | `Enviado` |
| any failure reason, incl. `not_configured` (today's state) | `failed` ≠ `outside_window` | `Falló` |
| outside the 24 h window | `failed` + `error = outside_window` | `Fuera de ventana` |

### Tests

- `lib/supabase/wa-graph.test.ts` (29) — URL/headers/body and the wa_id
  normalisation; `WHATSAPP_API_VERSION` override; `not_configured` never
  touches the network and logs once per process; error mapping (131047 →
  `outside_window`, 131026 → `invalid_recipient`, 429/130429 →
  `rate_limited`, unknown → `api_error`, abort → `timeout`, refused
  connection → `network_error`); the `withinWindow` table (inside, exact
  24 h boundary, outside, derived from `window_expires_at`, never-inbound,
  garbage timestamps); `deliverOutbound` (inside → sender called + row
  `sent` with Meta's id, outside → sender not called + `outside_window`,
  a throwing sender and a failing status write both resolve); the
  pipeline (window stamp, stored payload equals the Graph body, sender
  arguments, ack write-back, duplicate delivery); `parseStatusUpdates`;
  `processStatusUpdatesMeta` (delivered, duplicate no-op, failed → typed
  reason, status-free payload touches nothing). `fetch` is stubbed — no
  live network anywhere.
- `e2e/w05-outbound.spec.ts` (2) — H1: signed webhook → stored reply with
  `status = failed`, `error = not_configured` and the byte-identical Graph
  payload (`to` without `+`), the inbox row still rendering it, and **zero**
  attempts against `graph.facebook.com` (a browser route is registered
  with a canned ack as a safety net). H2: seed an outbound row carrying a
  Meta id → signed `statuses` delivery → `delivered`; the same delivery
  again → counted duplicate, no rewrite; `failed` + 131026 →
  `invalid_recipient`; rows removed in `finally`. H1 skips itself once
  `WHATSAPP_ACCESS_TOKEN` exists in `.env.local`.

### Scope notes / TODO(gap)

- **Template sends = phase 2** (flow 9.3/9.4): outside the window only
  approved utility/marketing templates may go out; `template_name` is
  already on the table and nothing in this unit sends one.
- **No human reply route yet** (`POST /api/wa/conversations/:id/reply`):
  M1 has no composer, so the only sender today is the bot. The gate is
  ready for it.
- **A01 window chip + composer lock (components 29/30) and the
  `wa-window-watch` job**: not built — same reason as the status chip.
- **The fake data driver does not send**: `handleInboundMessage` keeps
  storing replies in memory (it has no `wa_messages` rows); Graph delivery
  is the supabase driver's job.
- **No retry/backoff**: a failed send is recorded once (WA-022's
  "Reintentar" belongs to the member) — never a retry storm.
- **e2e cannot intercept the server-side Graph call**: Playwright routes
  only see browser-context requests, while the send runs inside the Next
  server process, and `.env.local` carries no token. H1 therefore asserts
  the recorded payload (the same builder produces the wire body) plus the
  absence of any attempt; the request shape itself is covered by the
  stubbed-`fetch` unit tests.

---

## 9. LLM fallback — WhatsApp Unit 3 (fase 2, env-gated)

The rule engine still decides everything; the model only answers the ONE
case no rule covers — the unknown intent — and only when it is switched on
through the environment.

### Gate — env-only, no migration, no admin screen

- **`AI_API_KEY` present = enabled. The key IS the switch:** *toggle en
  admin = futuro; hoy se enciende con `AI_API_KEY`.* No migration, no
  `bot_settings` column, no change to `/configuracion/bot` (§7 untouched).
- The key is **added by the user later, in `.env.local`** (git-ignored) —
  no real value exists in any repo file; `.env.example` documents the four
  names with no values (`AI_API_KEY`, `AI_MODEL` default `gpt-4o-mini`,
  optional `AI_BASE_URL` default `https://api.openai.com/v1`, optional
  `AI_MAX_TOKENS` default 400, clamped to 1..2048).
- Without the key the webhook behaves byte-identically to Units 1-2: the
  unknown intent gets `DEFAULT_REPLY` and no network call is made — that is
  the state of the dev project today, and what `e2e/w06-llm-fallback.spec.ts`
  proves end to end.

### Client — `lib/ai/llm.ts` (new)

- Provider-agnostic, OpenAI-compatible: `askLlm({ system, user, signal })`
  POSTs `{base}/chat/completions` with a bearer key, the two messages, a
  low temperature (0.2) and the capped `max_tokens`, ~10 s abort.
- **NEVER throws** — the same contract as `wa-graph.ts`: every failure is
  `{ ok: false, reason }` with a typed reason
  (`not_configured | timeout | rate_limited | api_error | network_error |
  bad_response`), and a missing key logs once per process before any I/O.
- Server-only: reached from the webhook pipeline, no `NEXT_PUBLIC_` var,
  no reference under `app/` or `components/` (grep-asserted in the unit
  suite and in the build verification).

### Wiring — `resolveBotReply(...)` (lib/data/bot-llm.ts)

- **Rules FIRST, unchanged:** `decideBotReply` (STOP, closed, disabled,
  greeting, configured copies) runs exactly as before and stays
  synchronous. `resolveBotReply` is the async wrapper around it: it returns
  the rule decision untouched for every explicit outcome, and only the
  `DEFAULT_REPLY` sentinel — "no rule matched" — may reach the model.
  STOP, a closed conversation, the admin toggle, the greeting rule and any
  future handoff/off-hours rule therefore **never reach the LLM**.
- **Call-shape change (reported):** the webhook's ONE call site
  (`lib/supabase/meta-webhook.ts`) moved from `decideBotReply(...)` to
  `await resolveBotReply(status, text, settings, { studyId, supabase })`.
  `decideBotReply` itself kept its signature, so the fake driver
  (`lib/data/whatsapp.ts`) and its tests are untouched — the demo layer
  stays rules-only, like it stays send-less (§8 scope note).
- **System prompt** (Spanish, rioplatense voseo): a legal-studio
  assistant for the study, WA-020 quoted as mandatory closing, an explicit
  ban on inventing case statuses/expediente/juzgado/dates, "a human will
  follow up" when unsure or when asked for legal advice, and no invented
  studio data. **Light context:** the study name + the case carátulas
  (≤10 rows, `id`/`caratula`, scoped to the study through the webhook's own
  service client); any failure of that read degrades to an answer WITHOUT
  context — it never blocks or fails the reply.
- **User message:** the inbound text, trimmed and capped at 1000 chars
  (`LLM_USER_MAX_CHARS`).
- **Disclaimer guarantee (WA-020):** appended *client-side, deterministically*
  — `Esto es orientación general, no es asesoramiento legal. Para tu caso
  concreto, consultá con una persona del estudio.` — included even when the
  model omits it, never duplicated when it obeys the prompt.
- **Any failure → today's default rule reply.** Timeout, rate limit, bad
  payload, a throwing seam: the bot answers `DEFAULT_REPLY` and never goes
  silent — the same philosophy as `not_configured` in Units 1-2.

### Tests (all stubbed, zero live model calls)

- `lib/ai/llm.test.ts` (12): config guard (`not_configured`, no network,
  one log per process), request shape (URL/bearer/messages/temperature/
  token default + clamp + overrides), typed failures (429, 5xx, malformed
  payload, refused connection, 10 s abort, caller signal), and the
  client-bundle grep (no `AI_API_KEY` under `app/` or `components/`).
- `lib/data/bot-settings.test.ts` (+8, where the bot's tests live):
  non-configured → default rule reply with no model call; configured → one
  call carrying system + disclaimer + case context and a reply that always
  ends in WA-020 (appended when the model omits it, not duplicated when it
  includes it); timeout/`api_error`/throwing seam → rule fallback;
  STOP/closed/disabled/greeting never call the model; >1000-char inbound
  capped; failing context fetch still answers; the real `askLlm` path with
  a stubbed `fetch`.
- `e2e/w06-llm-fallback.spec.ts` (1): signed webhook with an unknown-intent
  message on the un-configured dev project → the stored row AND the inbox
  thread show the rule fallback (and no WA-020 line, proving the model
  never ran); skips itself with a printed reason once the user adds
  `AI_API_KEY` to `.env.local`.

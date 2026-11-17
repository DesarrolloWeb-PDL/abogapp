# Test plan: clean-room clone (app-abogados)

Build: `85d202c`  Date: 2026-11-16  Env: local dev `http://localhost:3000`, real Supabase project (`.env.local`), seed data — study "Estudio Beltrán & Asociados", demo user `prueba.abogapp@gmail.com`, 2 cases, 2 pruebas + plazos, 1 notification, 2 WhatsApp conversations.

Scope: every recon flow F01–F06 in `replica/recon.md`, plus Module A (WhatsApp, `replica/whatsapp-bot.md`) and auth/onboarding (S01–S03). Only `replica/features.csv` **must** rows are expected to work. Planned M2+ gaps from `replica/build-log.md` are marked **not-built** and are NOT bugs. The original Veredicta is never touched.

**Legend (auto column)**

- **auto** — automated, spec name in `e2e/`
- **manual** — manual pass required (reason given)
- **not-built** — not-yet-built per build-log / features.csv (M2+, not a bug)
- **n/a** — does not apply to this flow (reason given)

**Edge-case checklist numbering (same for every flow)**: E1 empty input · E2 very long input · E3 accents/emoji · E4 two tabs at once · E5 double click on submit · E6 back button mid-flow · E7 refresh mid-flow · E8 slow network · E9 offline · E10 expired session · E11 second user's data invisible · E12 time zones and DST · E13 mobile width 390 · E14 keyboard only · E15 screen-reader labels.

**Negatives**: N1 invalid input / wrong credentials · N2 permission denied · N3 deleted or missing record.

---

## F01 — Lawyer connects a judicial portal (PJN) and imports cases (S25)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F01-H1 | happy | Inicio → Configuraciones → Integraciones → PJN → "Conectar mi cuenta" → CUIT/CUIL + clave → "Verificar y conectar" → "Cuenta conectada" → "Listo" → Expedientes | status chip "Conectada"; imported cases appear in the S07 list | not-built: S25 connector absent from M1 (features.csv: PJN connector = should → clone no). When built it also needs real PJN credentials → **manual/no-credentials, not a bug** | NOT-BUILT (manual/no-credentials when built) |
| F01-E1 | edge: empty input | submit connect form with empty CUIT | inline error, no connection created | not-built (S25) | NOT-BUILT |
| F01-E2 | edge: very long input | 30-digit CUIT | "Un CUIT o CUIL tiene 11 números" style error, no connection | not-built (S25) | NOT-BUILT |
| F01-E3 | edge: accents/emoji | CUIT typed with accents/spaces | normalised or rejected with typed error, never a 5xx | not-built (S25) | NOT-BUILT |
| F01-E4 | edge: two tabs at once | connect form open in two tabs, submit both | one connection, no crash / no duplicate sync | not-built (S25) | NOT-BUILT |
| F01-E5 | edge: double click on submit | double click "Verificar y conectar" | single connection attempt (button disabled while pending) | not-built (S25) | NOT-BUILT |
| F01-E6 | edge: back mid-flow | back during the progress screen | returns safely; connection state consistent | not-built (S25) | NOT-BUILT |
| F01-E7 | edge: refresh mid-flow | F5 during first sync | progress resumes, no duplicate import | not-built (S25) | NOT-BUILT |
| F01-E8 | edge: slow network | 5 s delayed portal response | loading state shown, no spinner-forever | not-built (S25) | NOT-BUILT |
| F01-E9 | edge: offline | offline during connect | typed connection error ("El portal no dio una respuesta"), retry offered | not-built (S25) | NOT-BUILT |
| F01-E10 | edge: expired session | session expires on the connect form | redirect to /login, no half-written connection | not-built (S25) + app-wide session case covered by F02-E10 | NOT-BUILT |
| F01-E11 | edge: second user invisible | second dashboard user opens Integraciones | sees only connections of their own studies | manual: needs a second confirmed dashboard user (ana.beltran@example.com rejected by GoTrue — known issue) | MANUAL (pending) |
| F01-E12 | edge: time zones / DST | sync notices 08:00–20:55 ART | shown in ART regardless of browser TZ | not-built (S25; sync scheduler is M2/M3) | NOT-BUILT |
| F01-E13 | edge: mobile 390 | open Integraciones at 390 px | form usable, no horizontal scroll | not-built (S25) | NOT-BUILT |
| F01-E14 | edge: keyboard only | complete connect form with keyboard only | every control focusable, Enter submits | not-built (S25) | NOT-BUILT |
| F01-E15 | edge: screen-reader labels | axe scan of system page | 0 violations; inputs have labels | not-built (S25) | NOT-BUILT |
| F01-N1 | negative: wrong password | portal rejects the password | "El portal no aceptó ese usuario o esa contraseña", no blind retry loop (5 attempts then stop) | not-built (S25) + no PJN credentials → manual/no-credentials | NOT-BUILT |
| F01-N2 | negative: permission denied | non-admin opens an admin-only connection action | action hidden or permission message | not-built (S25; roles are M2/M4) | NOT-BUILT |
| F01-N3 | negative: deleted record | sync finds a case deleted in the portal | case moves to "Expedientes eliminados" + "Volver a sincronizar" | not-built (S25) | NOT-BUILT |

## F02 — Lawyer opens a case and reads it (S07 list → S08 detail)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F02-H1 | happy | login → Expedientes → click carátula "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos" | detail opens: heading = carátula, cards "Información del expediente", "Próximos plazos" (seeded plazo badge `Vence 16/11/2026`), "Última actividad"; tabs Resumen / Pruebas; no empty chips (BUG-005 "Sin etapa", BUG-006 `Responsable: —` asserted) | auto `e2e/f02-expedientes.spec.ts` | PASS (re-run after BUG-005/BUG-006 fix, assertions added) |
| F02-H2 | happy (alt) | detail → tab Actuaciones → row "Leer" → reader → suggestion "Corre algun plazo para mi?" | reader with document + assistant panel | not-built: Actuaciones tab is T6/M2 and needs a synced case; no sync in M1 (build-log S08 missing) | NOT-BUILT |
| F02-E1 | edge: empty input | search "zzzzzz" in the list | "No encontramos coincidencias con tu búsqueda" + "Limpiar búsqueda" restores rows | auto `f02-expedientes.spec.ts` | PASS |
| F02-E2 | edge: very long input | search string of 1000 chars | empty state renders, no crash, no console error | auto `f02-expedientes.spec.ts` | PASS |
| F02-E3 | edge: accents/emoji | type "gomez" (no accent); then "🚀" | must-row "accent and typo tolerant search": unaccented query finds "Gómez…"; emoji → empty state, no crash | auto `f02-expedientes.spec.ts` | PASS (BUG-003 fixed, re-run — test unchanged) |
| F02-E4 | edge: two tabs at once | list open in 2 tabs, open detail in tab A | tab B unaffected; both render | auto `f02-expedientes.spec.ts` | PASS |
| F02-E5 | edge: double click on submit | — | n/a: read-only flow, no submit | n/a | N/A |
| F02-E6 | edge: back mid-flow | detail → browser Back | list re-rendered with data | auto `f02-expedientes.spec.ts` | PASS |
| F02-E7 | edge: refresh mid-flow | F5 on `/expedientes/<id>?tab=pruebas` | deep link re-renders the same tab (not the list, not a crash) | auto `f02-expedientes.spec.ts` | PASS |
| F02-E8 | edge: slow network | delay the cases REST call 800 ms | skeleton rows + sr-only "Cargando expedientes", then content | auto `f02-expedientes.spec.ts` | PASS |
| F02-E9 | edge: offline | block the cases REST call → list shows error | "No pudimos cargar los expedientes." + "Reintentar"; unblock → Retry loads rows | auto `f02-expedientes.spec.ts` (simulated by aborting the data endpoint; a full browser offline shows the browser's own error page) | PASS |
| F02-E10 | edge: expired session | clear cookies, reload detail | proxy redirects to /login | auto `f02-expedientes.spec.ts` | PASS |
| F02-E11 | edge: second user invisible | second dashboard user opens /expedientes | zero rows of study 1 visible (RLS) | manual: needs a second confirmed dashboard user (ana.beltran@example.com rejected — known issue) | MANUAL (pending) |
| F02-E12 | edge: time zones / DST | run with TZ `America/Argentina/Buenos_Aires`; seeded plazo badge | `Vence 16/11/2026` with no off-by-one; AR has no DST, date must not shift | auto `f02-expedientes.spec.ts` | PASS |
| F02-E13 | edge: mobile 390 | open list at 390×844 | bottom bar (Expedientes/Bandeja/Avisos) visible, sidebar hidden, no horizontal scroll | auto `e2e/mobile.spec.ts` | PASS |
| F02-E14 | edge: keyboard only | Tab to first carátula → Enter; Tab to tabs → Enter | detail opens / tab switches; focus ring visible | auto `f02-expedientes.spec.ts` | PASS |
| F02-E15 | edge: screen-reader labels | axe scan of list + detail | 0 violations; `nav` landmarks, table caption "Expedientes del estudio" | auto `f02-expedientes.spec.ts` | PASS (BUG-001 fixed — waiver removed, unwaived scan) |
| F02-N1 | negative: wrong password | — | n/a: covered by AU01-N1 | n/a | N/A |
| F02-N2 | negative: permission denied | second user requests study-1 case by id | RLS returns no row → missing state, no data leak | manual (same second-user setup as F02-E11) | MANUAL (pending) |
| F02-N3 | negative: deleted record | open `/expedientes/<unknown-id>` | "No encontramos este expediente. Puede que se haya eliminado." + "Volver a expedientes"; delete UI itself is M2 (row menu) | auto `f02-expedientes.spec.ts` | PASS |

## F03 — Lawyer sets a procedural deadline (plazo) with feriados/feria (S12)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F03-H1 | happy | Expedientes → "Nuevo expediente" (carátula `E2E <ts>`) → "Crear expediente" → tab Pruebas → "Agregar prueba" → Tipo Informativa, Título `E2E plazo <ts>`, Informante, Fecha efectiva 2026-11-16, Plazo "Días hábiles" 10 → "Guardar prueba" | lands on `?tab=pruebas` with the new row; Resumen "Próximos plazos" shows `Vence 30/11/2026` (day-after start, 10 weekdays, weekends skipped, no feriado seeded in range) equal to `plazos.fecha_limite` read from the DB; bell gains an unread; /notificaciones shows "Vence el 30/11/2026" | auto `e2e/f03-prueba.spec.ts` | PASS |
| F03-H2 | happy (alt) | Herramientas → "Calculadora de plazos procesales" → "Calcular plazo" | same date as the engine | not-built: S34 tool (features.csv: could → clone no) | NOT-BUILT |
| F03-E1 | edge: empty input | submit the form with blank Título/Informante/Fecha efectiva | typed toast "Completá todos los campos para continuar.", no row created | auto `f03-prueba.spec.ts` | PASS |
| F03-E2 | edge: very long input | Título of 1000 chars (DB limit 300) | typed error toast, no row, no 5xx / no console error | auto `f03-prueba.spec.ts` | PASS |
| F03-E3 | edge: accents/emoji | Título "Señoría 🚀 — prueba con acentos" | saved and rendered intact in the list | auto `f03-prueba.spec.ts` | PASS |
| F03-E4 | edge: two tabs at once | add-prueba form open in 2 tabs, submit only tab A | tab A saves; tab B still submits independently without crash | auto `f03-prueba.spec.ts` | PASS |
| F03-E5 | edge: double click on submit | double click "Guardar prueba" | exactly ONE prueba created (button disabled while saving) | auto `f03-prueba.spec.ts` | PASS |
| F03-E6 | edge: back mid-flow | fill form → "Volver al expediente" | returns to Pruebas tab, no partial row | auto `f03-prueba.spec.ts` | PASS |
| F03-E7 | edge: refresh mid-flow | fill form → F5 | form resets, no row created | auto `f03-prueba.spec.ts` | PASS |
| F03-E8 | edge: slow network | delay the insert 800 ms | submit shows "Guardando…" and stays disabled until done | auto `f03-prueba.spec.ts` | PASS |
| F03-E9 | edge: offline | block REST → submit | typed error toast, no row; unblock → retry succeeds | auto `f03-prueba.spec.ts` | PASS |
| F03-E10 | edge: expired session | clear cookies → submit | never a silent success: typed error or redirect to /login, no row | auto `f03-prueba.spec.ts` | PASS |
| F03-E11 | edge: second user invisible | second user opens the created case id | no row under RLS | manual (second confirmed user needed) | MANUAL (pending) |
| F03-E12 | edge: time zones / DST | whole case runs with TZ `America/Argentina/Buenos_Aires`; compare UI badge vs `plazos.fecha_limite` from REST + independent weekday computation | UI date == DB date == 30/11/2026 (a business day); AR has no DST so no shift | auto `f03-prueba.spec.ts` | PASS (re-run after BUG-004 fix) |
| F03-E13 | edge: mobile 390 | open "Agregar prueba" at 390×844 | fields stack, radiogroup usable, no horizontal scroll | auto `e2e/mobile.spec.ts` | PASS |
| F03-E14 | edge: keyboard only | fill the whole form with Tab/arrows/Enter only | radio group reachable with arrow keys, Enter submits | auto `f03-prueba.spec.ts` | PASS |
| F03-E15 | edge: screen-reader labels | axe scan of the add-prueba form | 0 violations; radiogroup labelled "Unidad", fields labelled | auto `f03-prueba.spec.ts` | PASS |
| F03-N1 | negative: invalid plazo | Cantidad 6000 (engine guard 1..5000) | typed toast "La cantidad del plazo tiene que estar entre 1 y 5000.", no row | auto `f03-prueba.spec.ts` | PASS |
| F03-N2 | negative: permission denied | second user posts a prueba for study-1 case | RLS rejects, typed error, no row | manual (second confirmed user needed) | MANUAL (pending) |
| F03-N3 | negative: deleted record | submit against a deleted/unknown case id | typed error, no orphan row | not-built: delete UI is M2 (row menu); unknown-id state covered by F02-N3 | NOT-BUILT |
| F03-N4 | negative: corrupt DB row (BUG-004 regression) | create a case → seed a prueba + plazo via REST with `fecha_efectiva 61116-02-02` (the trigger writes `fecha_limite 61116-02-10T02:59:59+00:00`) → open `/expedientes/<id>` → clean the rows up | detail renders (carátula heading, plazo shows the "Fecha pendiente" fallback, Pruebas tab readable); never "No pudimos cargar el expediente."; no out-of-range row left behind | auto `f03-prueba.spec.ts` (F03-N4) | PASS (BUG-004 fixed) |

## F04 — Lawyer assigns a task (S16)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F04-H1 | happy | Tareas → "Nueva tarea" (or `C`) → case picker, título, Estado, Prioridad, Responsable, Vence → "Crear tarea" | toast "Tarea creada", card on the board | not-built: Tareas screen is M2 (features.csv: task creation = must → clone no; build-log has no S16) | NOT-BUILT |
| F04-H2 | happy (alt) | reader shortcut "Crear tarea" → pre-filled → create | task linked to the case | not-built (reader itself is M2) | NOT-BUILT |
| F04-E1 | edge: empty input | create with blank título | "Falta el título" style inline error | not-built (M2) | NOT-BUILT |
| F04-E2 | edge: very long input | título 255+ chars | rejected by the documented 255-char limit | not-built (M2) | NOT-BUILT |
| F04-E3 | edge: accents/emoji | título with accents/emoji | stored and rendered intact | not-built (M2) | NOT-BUILT |
| F04-E4 | edge: two tabs at once | create task in both tabs | two tasks, no crash | not-built (M2) | NOT-BUILT |
| F04-E5 | edge: double click on submit | double click "Crear tarea" | exactly one task | not-built (M2) | NOT-BUILT |
| F04-E6 | edge: back mid-flow | back from the dialog | dialog closes, no task | not-built (M2) | NOT-BUILT |
| F04-E7 | edge: refresh mid-flow | F5 mid-dialog | no half-created task | not-built (M2) | NOT-BUILT |
| F04-E8 | edge: slow network | delayed create | "Creando…" state, no double send | not-built (M2) | NOT-BUILT |
| F04-E9 | edge: offline | offline on create | typed error, no task | not-built (M2) | NOT-BUILT |
| F04-E10 | edge: expired session | session expires pre-submit | redirect /login, no task | not-built (M2) | NOT-BUILT |
| F04-E11 | edge: second user invisible | second user opens /tareas | only their studies' tasks | manual (second confirmed user needed) | MANUAL (pending) |
| F04-E12 | edge: time zones / DST | due date across DST boundary | stored as calendar date, red "Tarea vencida" only after ART date passes | not-built (M2) | NOT-BUILT |
| F04-E13 | edge: mobile 390 | board at 390 px | usable (list fallback), no h-scroll | not-built (M2) | NOT-BUILT |
| F04-E14 | edge: keyboard only | create a task keyboard-only | dialog focus-trapped, Enter creates | not-built (M2) | NOT-BUILT |
| F04-E15 | edge: screen-reader labels | axe scan of dialog | 0 violations | not-built (M2) | NOT-BUILT |
| F04-N1 | negative: invalid input | past vence date on create | accepted with "Tarea vencida" red state (documented), not rejected | not-built (M2) | NOT-BUILT |
| F04-N2 | negative: permission denied | read-only role clicks "Nueva tarea" | padlock → plans | not-built (M2/M4; roles are M2+) | NOT-BUILT |
| F04-N3 | negative: deleted record | task of a deleted case | card disappears / link degrades | not-built (M2) | NOT-BUILT |

## F05 — Lawyer drafts an escrito with the AI assistant (S22/S24, gated)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F05-H1 | happy | Asistente → "+" → "Un expediente" → pick case → "/" → Redacción → "Oficio judicial" → fill brackets → Enter → draft card → "Abrir" → split view → ask changes → "Guardar en Documentos" | draft saved in the case folder + "Guardado en el expediente" | not-built: assistant screens S22/S24 absent from M1 (features.csv: could → clone no) | NOT-BUILT |
| F05-E1 | edge: empty input | send empty prompt | send disabled or typed validation | not-built | NOT-BUILT |
| F05-E2 | edge: very long input | prompt > model context | graceful truncation/error, no crash | not-built | NOT-BUILT |
| F05-E3 | edge: accents/emoji | prompt with accents/emoji | answered normally | not-built | NOT-BUILT |
| F05-E4 | edge: two tabs at once | two conversations in 2 tabs | independent states | not-built | NOT-BUILT |
| F05-E5 | edge: double click on submit | double Enter on prompt | one answer, no double charge of quota | not-built | NOT-BUILT |
| F05-E6 | edge: back mid-flow | back during generation | "Detener la respuesta" works, no corrupt draft | not-built | NOT-BUILT |
| F05-E7 | edge: refresh mid-flow | F5 mid-draft | draft card recovers ("Borrador" state) | not-built | NOT-BUILT |
| F05-E8 | edge: slow network | slow model response | step log + "Detener la respuesta" visible | not-built | NOT-BUILT |
| F05-E9 | edge: offline | offline mid-chat | typed error, draft preserved | not-built | NOT-BUILT |
| F05-E10 | edge: expired session | session expires | redirect /login, draft not lost silently | not-built | NOT-BUILT |
| F05-E11 | edge: second user invisible | second user opens the conversation | not visible (per-account) | not-built + manual (needs second user) | NOT-BUILT |
| F05-E12 | edge: time zones / DST | draft timestamps | rendered in local time | not-built | NOT-BUILT |
| F05-E13 | edge: mobile 390 | assistant at 390 | full screen only (no side panel) | not-built | NOT-BUILT |
| F05-E14 | edge: keyboard only | drive the chat with keyboard | input focusable, Enter sends | not-built | NOT-BUILT |
| F05-E15 | edge: screen-reader labels | axe scan of /asistente | 0 violations | not-built | NOT-BUILT |
| F05-N1 | negative: invalid input | unclosed brackets in the skill template | assistant asks for the missing fields, no broken draft | not-built | NOT-BUILT |
| F05-N2 | negative: permission denied | member without document permission saves | "No se pudo guardar" + "Descargar Word" fallback | not-built | NOT-BUILT |
| F05-N3 | negative: deleted record | draft of a deleted case | save fails typed, fallback offered | not-built | NOT-BUILT |

## F06 — Daily usage: notifications & digest (S21, bell)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F06-H1 | happy | bell ("Notificaciones…") → /notificaciones → click the seeded notification → back | list renders seeded rows; click navigates to its `deep_link` and marks it read; unread line "Tenés N notificaciones sin leer." while unread > 0 | auto `e2e/f06-notifications.spec.ts` | PASS (re-run after BUG-004 fix) |
| F06-H2 | happy (email) | email "Resumen diario" Mon–Fri 08:00 → open → lands on the case | digest email in the inbox | not-built: Resend + jobs are M2 (features.csv: daily digest = must → clone no) + **manual** (email delivery) | NOT-BUILT |
| F06-E1 | edge: empty input | all read → /notificaciones | "Estás al día con las novedades de tu estudio." + "Marcar todas como leídas" disabled | auto `f06-notifications.spec.ts` (conditional: covers both unread and all-read states) | PASS |
| F06-E2 | edge: very long input | — | n/a: display-only screen, strings come from the system | n/a | N/A |
| F06-E3 | edge: accents/emoji | seeded titles ("Vence en 3 días…", "Gómez…") render | accents intact, no mojibake | auto `f06-notifications.spec.ts` | PASS |
| F06-E4 | edge: two tabs at once | page open in 2 tabs; mark all read in tab A; reload tab B | tab B shows the updated read state (DB-backed) | auto `f06-notifications.spec.ts` | PASS |
| F06-E5 | edge: double click on submit | double click "Marcar todas como leídas" | one toast, no error, state consistent | auto `f06-notifications.spec.ts` | PASS |
| F06-E6 | edge: back mid-flow | click notification → case → Back | returns to the list; read state kept | auto `f06-notifications.spec.ts` | PASS |
| F06-E7 | edge: refresh mid-flow | F5 on /notificaciones | re-renders from DB, read states persist | auto `f06-notifications.spec.ts` | PASS |
| F06-E8 | edge: slow network | delay notifications REST 800 ms | "Cargando tus notificaciones…" + skeleton | auto `f06-notifications.spec.ts` | PASS |
| F06-E9 | edge: offline | block notifications REST | "No pudimos cargar las notificaciones." + "Reintentar"; unblock → retry works | auto `f06-notifications.spec.ts` | PASS |
| F06-E10 | edge: expired session | clear cookies → /notificaciones | redirect to /login | auto `f06-notifications.spec.ts` | PASS |
| F06-E11 | edge: second user invisible | second user opens /notificaciones | only their own notifications (per-member read state) | manual (second confirmed user needed) | MANUAL (pending) |
| F06-E12 | edge: time zones / DST | render with TZ `America/Argentina/Buenos_Aires` | `dd/mm/yyyy hh:mm` timestamps, no day-shift | auto `f06-notifications.spec.ts` | PASS |
| F06-E13 | edge: mobile 390 | "Avisos" in the bottom bar → page | page opens at 390, no h-scroll | auto `e2e/mobile.spec.ts` | PASS |
| F06-E14 | edge: keyboard only | Tab → bell → Enter → Tab → notification → Enter | full flow keyboard-reachable | auto `f06-notifications.spec.ts` | PASS |
| F06-E15 | edge: screen-reader labels | axe scan; bell accessible name | 0 violations; bell reads "Notificaciones, N sin leer" | auto `f06-notifications.spec.ts` | PASS |
| F06-N1 | negative: wrong password | — | n/a: covered by AU01-N1 | n/a | N/A |
| F06-N2 | negative: permission denied | second user marks first user's notification | RLS update touches 0 rows, no cross-user write | manual (second confirmed user needed) | MANUAL (pending) |
| F06-N3 | negative: deleted record | notification deep link to a deleted case | missing-case state (F02-N3), no crash | auto (asserted via F02-N3 state) | PASS |

---

## WA01 — WhatsApp webhook API (`GET|POST /api/webhooks/whatsapp`, `GET /api/wa/conversations`)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| WA01-H1 | happy | `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=12345` | 200, body echoes `12345` (text/plain) | auto `e2e/w01-whatsapp-api.spec.ts` | PASS |
| WA01-H2 | happy | signed `POST` (valid `X-Hub-Signature-256` HMAC-SHA256 of raw body) with a fresh Meta payload | 200 `{received:true, accepted:1, duplicates:0}`; conversation + messages written (service role) | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-H3 | happy (idempotency) | POST the exact same body again | 200 with `duplicates:1`, `accepted:0`; only one stored event | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-H4 | happy (session gate) | `GET /api/wa/conversations` with NO session | **401** `{error:"unauthorized"}` (backend.md security item 1) | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-H5 | happy (authed read) | `GET /api/wa/conversations` with the demo session | 200, array includes the webhook contact | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-E1 | edge: empty input | POST payload without `entry[]` | 200 `{accepted:0}` (no crash) | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-E2 | edge: very long input | 1 MB body with valid signature | 200/typed 4xx, no 5xx | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-E3 | edge: accents/emoji | message body "Buenos días 🚀 — ¿me ayudan?" | stored intact, greeting rule matches | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-E4 | edge: two tabs at once | — | n/a: API has no tabs (concurrent POSTs covered by idempotency) | n/a | N/A |
| WA01-E5 | edge: double click on submit | two identical deliveries in flight | one event (unique `event_key`) | auto `w01-whatsapp-api.spec.ts` (same as H3) | PASS |
| WA01-E6 | edge: back mid-flow | — | n/a: no UI flow | n/a | N/A |
| WA01-E7 | edge: refresh mid-flow | reload /bandeja after webhook | list re-reads from the route, conversation still there | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA01-E8 | edge: slow network | delay `/api/wa/conversations` 800 ms | inbox skeleton rows while loading | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA01-E9 | edge: offline | block `/api/wa/conversations` | "No pudimos cargar la bandeja" + "Reintentar"; unblock → retry loads | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA01-E10 | edge: expired session | session cleared → open /bandeja | redirect to /login (page) ; API stays 401 | auto `a01-inbox.spec.ts` / `w01-whatsapp-api.spec.ts` | PASS |
| WA01-E11 | edge: second user invisible | second user's `GET /api/wa/conversations` | only their studies' conversations (RLS) | manual (second confirmed user needed) | MANUAL (pending) |
| WA01-E12 | edge: time zones / DST | inbox timestamps | rendered in ART (`America/Argentina/Buenos_Aires`) regardless of browser TZ | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA01-E13 | edge: mobile 390 | /bandeja at 390×844 | list usable, bottom bar, no h-scroll | auto `e2e/mobile.spec.ts` | PASS |
| WA01-E14 | edge: keyboard only | filter tabs reachable by Tab/Enter | `aria-pressed` toggles work | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA01-E15 | edge: screen-reader labels | axe scan of /bandeja | 0 violations; filter group labelled "Filtrar conversaciones" | auto `a01-inbox.spec.ts` | PASS |
| WA01-N1 | negative: bad signature | POST with wrong `X-Hub-Signature-256` | **401** `{error:"invalid_signature"}`, nothing stored | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-N2 | negative: wrong verify token | handshake with wrong `hub.verify_token` | **403** Forbidden | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA01-N3 | negative: missing secrets | route with no `WHATSAPP_*` env | 503 typed | manual: needs a server restart without `.env.local` secrets (would disturb the dev server) | MANUAL (pending) |

## WA02 — WhatsApp inbox UI (A01 `/bandeja`)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| WA02-H1 | happy | login → Bandeja WhatsApp | seeded conversations render: "Marina Duarte" (+5491155550101) and "Maria Perez" (+5491122334455) with status badges, snippet, time; filter counts match rows | auto `e2e/a01-inbox.spec.ts` | PASS |
| WA02-H2 | happy (filters) | click "Bot (n)" / "Cerradas (n)" / "Todas (n)" | rows filtered accordingly; `aria-pressed` marks the active filter | auto `a01-inbox.spec.ts` | PASS |
| WA02-H3 | happy (states) | filter that matches nothing (or Cerradas before first STOP run) | "No hay conversaciones con este filtro" + "Ver todas" | auto `a01-inbox.spec.ts` | PASS |
| WA02-E1 | edge: empty input | — | empty state "Todavía no hay conversaciones de WhatsApp" + share-the-number hint | manual: requires deleting all conversations (destructive on shared dev data) | MANUAL (pending) |
| WA02-E2..E6 | edges | very long / accents / two tabs / double submit / back | n/a: read-only list (accents covered by WA01-E3 message rendering) | n/a | N/A |
| WA02-E7 | edge: refresh mid-flow | F5 on /bandeja | re-reads, same rows (WA01-E7) | auto `a01-inbox.spec.ts` | PASS |
| WA02-E8 | edge: slow network | delay route 800 ms | skeleton rows | auto `a01-inbox.spec.ts` | PASS |
| WA02-E9 | edge: offline | block route | "No pudimos cargar la bandeja" + "Reintentar" → recovers | auto `a01-inbox.spec.ts` | PASS |
| WA02-E10 | edge: expired session | clear cookies → /bandeja | redirect /login | auto `a01-inbox.spec.ts` | PASS |
| WA02-E11 | edge: second user invisible | second user opens /bandeja | only their studies' conversations | manual (second confirmed user needed) | MANUAL (pending) |
| WA02-E12 | edge: time zones / DST | row timestamps | ART rendering (`short` date+time) | auto `a01-inbox.spec.ts` | PASS |
| WA02-E13 | edge: mobile 390 | /bandeja at 390 | list visible, bottom bar, no h-scroll | auto `e2e/mobile.spec.ts` | PASS |
| WA02-E14 | edge: keyboard only | Tab through filters and rows | all reachable, visible focus | auto `a01-inbox.spec.ts` | PASS |
| WA02-E15 | edge: screen-reader labels | axe scan | 0 violations | auto `a01-inbox.spec.ts` | PASS |
| WA02-N1 | negative: error state | route returns 500 (forced via route fulfill) | error panel + Reintentar, never a blank thread | auto `a01-inbox.spec.ts` | PASS |
| WA02-N2 | negative: permission denied | — | covered by WA01-H4 (401) + RLS manual case | auto (WA01-H4) / manual (RLS) | PASS |
| WA02-N3 | negative: deleted record | — | n/a: no delete UI in M1 | n/a | N/A |

## WA03 — Bot rules (local rule-based bot, `lib/data/bot.ts`)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| WA03-H1 | happy (greeting) | signed POST, message "Hola, ¿me pueden ayudar?" from `+5491155550901` → open /bandeja | conversation row with badge "Bot" and snippet = "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?" | auto `w01-whatsapp-api.spec.ts` + `a01-inbox.spec.ts` | PASS |
| WA03-H2 | happy (STOP) | signed POST "STOP" from `+5491155550902` → open /bandeja | conversation badge "Cerrada"; a later message gets no bot reply (silent) | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA03-E1..E15 | edges | — | covered by WA01/WA02 rows (same surfaces) | see WA01/WA02 | SEE-REF |
| WA03-N1 | negative: already closed | message to a "Cerrada" conversation | no reply, status stays Cerrada, message still stored (accepted=1) | auto `w01-whatsapp-api.spec.ts` | PASS |
| WA03-N2 | negative: permission denied | — | n/a (webhook has no user session by design; writes are service-role) | n/a | N/A |
| WA03-N3 | negative: deleted record | message for a phone with no contact yet | contact + conversation created from scratch | auto `w01-whatsapp-api.spec.ts` | PASS |

Bot flows 2–9 of `replica/whatsapp-bot.md` (qualification, case creation, FAQ, appointments, handoff, after-hours, blocked, 24 h window/template picker) → **not-built** (M3 per build-log: "Meta Graph delivery + 24 h window (M3)"; flow 3 case creation is part of the pending M3 intake).

---

## AU01 — Login / logout (S01/S02, session)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| AU01-H1 | happy | /login → "Correo electrónico" = `prueba.abogapp@gmail.com`, "Contraseña" = `demo-estudio-2026` → "Iniciar sesión" | lands on /expedientes with seeded content; sidebar shows study "Estudio Beltrán & Asociados" | auto `e2e/auth.spec.ts` | PASS (re-run: axe scan is the BUG-001 RED/GREEN enforcement) |
| AU01-H2 | happy (logout) | sidebar "Cerrar sesión" | back on /login; /expedientes now redirects to /login; **console stays clean (no `403 on /auth/v1/user` — BUG-002 guard unwaived)** | auto `auth.spec.ts` | PASS (BUG-002 fixed, re-run) |
| AU01-N1 | negative: wrong password | correct email + wrong password | role=alert "El correo y la contraseña no coinciden. Revisalos e intentá otra vez."; stays on /login | auto `auth.spec.ts` | PASS |
| AU01-N2 | negative: empty fields | submit both fields empty | field errors "Ingresá tu correo electrónico." / "Ingresá tu contraseña."; no network call | auto `auth.spec.ts` | PASS |
| AU01-N3 | negative: invalid email | "notanemail" + password | typed credentials error (no format crash), no session | auto `auth.spec.ts` | PASS |
| AU01-E10 | edge: expired session | authenticated → clear cookies → /expedientes | redirect to /login | auto `auth.spec.ts` (also F02-E10) | PASS |
| AU01-E13 | edge: mobile 390 | login form at 390×844 | usable, no h-scroll | auto `e2e/mobile.spec.ts` | PASS |
| AU01-E14 | edge: keyboard only | Tab/Enter-only login (no mouse) | reaches fields and submit by keyboard, Enter submits, success lands on /expedientes | auto `auth.spec.ts` | PASS |
| AU01-E15 | edge: screen-reader labels | axe scan of /login | 0 violations; errors announced via `role="alert"` | auto `auth.spec.ts` | PASS |
| AU01-E1..E9, E11, E12 | edges | — | n/a or covered: form edges (empty/long/emoji) are AU01-N2 + validation; two-tabs/double-submit/back/slow/offline covered by F03 patterns on the same primitives; second-user → manual (F02-E11); TZ → F02-E12 | see referenced cases | SEE-REF |

## AU02 — Sign-up (S02)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| AU02-H1 | happy (attempt ONCE) | /signup → "Nombre completo" + unique `e2e+<ts>@example.test` + 8+ char password → "Crear cuenta" | role=status "Te enviamos un correo para confirmar tu cuenta. Revisá tu bandeja y hacé clic en el enlace." (confirmation pending) — OR, if the project has confirmations off, redirect to /onboarding | auto `e2e/signup.spec.ts` | SKIP (auth rate limit) |
| AU02-N1 | negative: weak password | password "1234567" | "La contraseña necesita al menos 8 caracteres." | auto `signup.spec.ts` | PASS |
| AU02-N2 | negative: invalid email | "no-es-correo" | "Revisá el formato del correo electrónico." | auto `signup.spec.ts` | PASS |
| AU02-N3 | negative: empty name | name blank | "Ingresá tu nombre completo." | auto `signup.spec.ts` | PASS |
| AU02-E1 | edge: rate limit | if GoTrue answers 429 / `over_email_send_rate_limit` | **skip with reason** (not a failure) — signup is attempted once per run only | auto `signup.spec.ts` (skip path) | PASS |
| AU02-E15 | edge: screen-reader labels | axe scan of /signup | 0 violations | auto `signup.spec.ts` | PASS |
| AU02-H2 | happy (email click) | open the confirmation email, click the link | account confirmed → login works | **manual**: email delivery (Resend not wired; Supabase confirm mail only) | MANUAL (pending) |
| AU02-E10 | edge: expired session | — | n/a: sign-up creates the session | n/a | N/A |
| AU02-E11 | edge: second user invisible | new user signs up | sees an empty study (wizard), never study 1's data | manual (needs the confirmation click first, then RLS check) | MANUAL (pending) |

## AU03 — Onboarding wizard (S03, steps 1–3 of 5)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| AU03-H1 | happy | after a confirmed sign-up → wizard: pick jurisdicciones → "Continuar" → profile → "Continuar" → nombre del estudio → create | "Tu estudio está listo" → /expedientes; `studies` + `memberships` (active) + Dueño role rows exist | **manual**: requires clicking the confirmation email first (AU02-H2) — one chained manual pass | MANUAL (pending) |
| AU03-E1 | edge: empty input | finish step 3 with blank study name | "Poné un nombre para tu estudio." | manual (same chained pass) | MANUAL (pending) |
| AU03-E14 | edge: keyboard only | walk steps with keyboard | all controls reachable | manual (same chained pass) | MANUAL (pending) |
| AU03-E15 | edge: screen-reader labels | axe scan of /onboarding | 0 violations | manual: reachable only with a confirmed session (chained with AU02-H2) | MANUAL (pending) |
| AU03-N1 | negative: invalid input | invalid email in profile step | "Revisá el formato del correo electrónico." | manual (chained) | MANUAL (pending) |
| AU03-E2..E13 | edges | — | mostly covered by the chained pass; second-user/timezone cases see F02 rows | see referenced cases | SEE-REF |
| AU03-H2 | happy (steps 4–5) | "Tu información está segura" + invite-teammates steps | wizard completes 5/5 | not-built: steps 4–5 are M2 (build-log S03 missing) | NOT-BUILT |

---

## Step 3 — manual click-through checklist (what cannot be automated)

Run these by hand against the local clone (never against the original product).
Items map to plan cases marked **manual** above.

1. **Email confirmation click (AU02-H2)** — sign up with a real mailbox, open
   the Supabase confirmation email, click the link → must land in the wizard
   with a session. *Why manual:* no mail catcher is wired (Resend not started;
   GoTrue sends its own mail to the address).
2. **Onboarding chained pass (AU03-H1 / E1 / N1 / E14 / E15)** — after item 1:
   step 1 jurisdicciones → step 2 profile → step 3 study name (blank name must
   show "Poné un nombre para tu estudio."), then verify in the Dashboard:
   `studies` + active `memberships` + Dueño role rows exist. Keyboard-only
   walk + axe on `/onboarding`. *Why manual:* needs the confirmed session
   from item 1 (signup alone does not open the wizard when confirmations are on).
3. **Second-user RLS (F02-E11/N2, F03-E11/N2, F06-E11/N2, AU02-E11,
   WA01-E11)** — exact steps:
   1. Supabase Dashboard → Authentication → Users → **Add user** → a real
      mailbox you control (auto-confirm ON), any strong password. Do NOT use
      `ana.beltran@example.com` — GoTrue rejects it, see the "to check" list
      in `replica/bugs.md`.
   2. Sign in as that user in a private window: `/expedientes` must show **no**
      rows of "Estudio Beltrán & Asociados", `/notificaciones` must be empty,
      `/bandeja` must list **no** conversations.
   3. Open `http://localhost:3000/expedientes/c0000000-0000-4000-8000-000000000001`
      directly → must show "No encontramos este expediente…", not the record.
   4. With their session: `GET /api/wa/conversations` must return an empty (or
      own-study-only) array — never study 1's threads.
   5. Sign in again as `prueba.abogapp@gmail.com` and confirm nothing changed.
4. **Real Meta webhook (WA01-H1..H5 in production)** — point a real Meta
   WhatsApp app at a public URL of the clone with real `WHATSAPP_*` secrets.
   *Why manual:* needs deployment + Meta app config (M3 scope); local fixtures
   only prove signature, idempotency and the bot rules.
5. **Visual pass at 1440 / 768 / 390 px** — eyeball every screen for layout
   breaks, overflow, empty chips (the seeded stage-less cases used to render
   an empty Etapa chip — fixed as BUG-005, verify the "Sin etapa" fallback),
   and save screenshots into `replica/clone-screens/` (input for `/replica-diff`).
6. **Full screen-reader pass (beyond axe)** — NVDA or VoiceOver: list row
   counts, loading announcements (the /bandeja loading skeleton is currently
   NOT announced — recorded in bugs.md), bell unread count, form error
   announcements, radiogroup arrow-key selection on Agregar prueba.
7. **Empty inbox state (WA02-E1)** — requires deleting every `wa_conversations`
   row (destructive on the shared dev data): expect "Todavía no hay
   conversaciones de WhatsApp" + share-the-number hint; then re-send one
   webhook fixture to restore a thread.
8. **Missing webhook secrets (WA01-N3)** — stop the dev server, unset
   `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET`, restart → handshake and POST
   must answer 503; restore `.env.local` afterwards. *Why manual:* restarting
   the shared dev server disturbs other sessions.
9. **Real slow/offline networks (E8/E9)** — DevTools "Slow 3G" and offline
   toggles by hand; the automated versions simulate this by delaying/aborting
   the data endpoint only.
10. **Rate-limit observation (AU02-E1)** — if the automated skip fires, confirm
    in Dashboard → Authentication → Logs that the cause was
    `over_email_send_rate_limit` / HTTP 429 and not an app error.
11. **Cross-zone eyeball (E12)** — run a browser with a non-ART system zone and
    check "Última actividad" timestamps and notification times render in the
    viewer's zone (date-only plazos must never shift — already automated).

---

## Summary (re-run 2026-11-17 — after the BUG-001/002/003/005/006 batch)

Final verification run: `npx playwright test` → **58 passed / 0 failed / 1 skipped** (59 tests, 1 worker, retries=1).
Zero failures: **BUG-003 is fixed** — `e2e/f02-expedientes.spec.ts` F02-E3 flipped green with the test unchanged; the skip is AU02-H1 (Supabase Auth email rate limit, per plan). The previous single failure (F02-E3, kept red on purpose) and both known-issue waivers (`WAIVE_SIDEBAR_LOGO` / the AU01-H2 403 guard) are gone.

| flow | pass | fail | skip | manual | not-built | n/a | ref |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 (PJN connect) | 0 | 0 | 0 | 1 | 18 | 0 | 0 |
| F02 (list + detail) | 15 | 0 | 0 | 2 | 1 | 2 | 0 |
| F03 (prueba + plazo) | 16 | 0 | 0 | 2 | 2 | 0 | 0 |
| F04 (tasks) | 0 | 0 | 0 | 1 | 19 | 0 | 0 |
| F05 (AI draft) | 0 | 0 | 0 | 0 | 19 | 0 | 0 |
| F06 (notifications) | 15 | 0 | 0 | 2 | 1 | 2 | 0 |
| WA01 (webhook API) | 19 | 0 | 0 | 2 | 0 | 2 | 0 |
| WA02 (inbox UI) | 13 | 0 | 0 | 2 | 0 | 2 | 0 |
| WA03 (bot rules) | 4 | 0 | 0 | 0 | 0 | 1 | 1 |
| AU01 (login/logout) | 9 | 0 | 0 | 0 | 0 | 0 | 1 |
| AU02 (sign-up) | 5 | 0 | 1 | 2 | 0 | 1 | 0 |
| AU03 (onboarding) | 0 | 0 | 0 | 5 | 1 | 0 | 1 |
| **total** | **96** | **0** | **1** | **19** | **61** | **10** | **3** |

**Cases: 190 numbered rows — 97 automated (96 pass / 0 fail / 1 skip = rate limit), 19 manual, 61 not-built (M2+), 10 n/a, 3 cross-references.**

Notes on the run environment:

- The suite runs against the live local dev server (no `webServer` block), real Supabase project, seeded study.
- Project order `guest → setup → chromium` is mandatory: AU01-H2's global sign-out revokes every demo-user session, so the storageState must be minted AFTER the guest logout tests (documented in `playwright.config.ts`).
- Guards: console errors + uncaught page errors + any 5xx fail a test; axe (wcag2a/2aa/21a/21aa) runs on every main screen with **no waivers** — BUG-001 is fixed and `WAIVE_SIDEBAR_LOGO` (plus the AU01-H2 `403` console guard) was removed, so every violation fails the test.
- Expected 4xx from deliberate negative tests (wrong password, invalid plazo, cleared-session reads) are ignored **only** in those tests, with the reason in the spec.
- Test data: cases/pruebas/notifications created by the suite are cleaned from the DB after the run (seed restored); WhatsApp fixture threads (phones +5491155550901/…902) persist on purpose and accumulate messages/webhook events per run.

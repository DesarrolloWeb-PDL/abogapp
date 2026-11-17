# Parity report — app-abogados (clean-room clone) vs Veredicta

Date: 2026-11-17 · Phase: measure and report only (no application code touched).
Inputs: `replica/features.csv` (clone column refreshed this pass), `replica/recon.md`,
`replica/build-log.md`, `replica/bugs.md`, `replica/screens/` (3 pre-existing originals).
Evidence basis: **119 unit tests green** (15 files, `vitest run`) and **58 e2e tests green +
1 skipped** (full `npx playwright test`, 3.9 min) — both re-run in this session — plus code
inspection of the shipped screens. `python` = Python 3.12.10 (`py -3` identical; `python3`
is the Windows Store alias and fails).

---

## 1. Overall

| Metric | Score |
| --- | --- |
| Feature score (`parity.py`) | **16.9 / 100** — 60 counted rows, must-haves **3 of 16** done |
| Layout score | **26.5 / 100** on **1** comparable pair (low confidence, see §3); 8 captured screens have no original |
| Combined (skill's 80 % features + 20 % layout, `--visual`) | **18.8 / 100** |
| Open S1/S2 bugs | **none** — all 6 bugs fixed (`replica/bugs.md`), verified green this session |
| **Verdict** | **NOT SHIPPABLE** — 13 of 16 must-haves are not done (7 `no`, 6 `partial`). The blocker is feature breadth, not defects. |

The score is honest: the clone ships the M1 vertical slice (auth → wizard 1–3 → manual case →
prueba + plazo → notification → WhatsApp inbox/bot) and nothing of M2/M3 yet. The clone column
of `features.csv` had been stale since M1 T9; every one of the 70 rows was re-walked this pass.

---

## 2. Feature parity

### By area, weakest first (from `parity.py`)

| Area | Score | Features |
| --- | --- | --- |
| judicial-sync | 0.0 | 5 |
| movimientos | 0.0 | 4 |
| tareas | 0.0 | 4 |
| agenda | 0.0 | 4 |
| documentos | 0.0 | 3 |
| asistente-ia | 0.0 | 5 |
| roles | 0.0 | 2 |
| finanzas | 0.0 | 2 |
| biblioteca | 0.0 | 2 |
| editor | 0.0 | 1 |
| config | 0.0 | 5 |
| notificaciones | 16.7 | 4 |
| plazos | 28.1 | 6 |
| auth | 37.5 | 5 |
| expedientes | 40.0 | 6 |
| pruebas | 50.0 | 1 |
| mobile | 100.0 | 1 |

### Must-haves: 3 of 16 done

| # | Must-have | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Email + password sign-up and login | **yes** | AU01/AU02 green (wrong password, empty fields, logout) |
| 2 | Five-step onboarding wizard | **partial** | `onboarding-wizard.tsx`: "Paso {n} de 3" — steps 4–5 = M2 |
| 3 | Manual case creation | **yes** | F03-H1 green: form → DB row |
| 4 | Expedientes list with search + filters | **partial** | search accent/typo-tolerant (BUG-003 fix, F02-E3); Filtros panel/favorites/archive = M2 |
| 5 | Case detail hub with tabs | **partial** | 2 of 10 tabs (`resumen`, `pruebas`) + `?tab=` (F02-E7) |
| 6 | Favorites / archive / soft-delete | **no** | no row menu or bulk bar in `expedientes-view.tsx` |
| 7 | Manual movement log (S09) | **no** | no route, no model usage |
| 8 | Pruebas tracking (six evidence types) | **partial** | create + plazo green (F03-H1); per-type estados/person picker/historial = M2 |
| 9 | Plazos engine (horas/corridos/hábiles) | **yes** | 21 golden tests + F03-H1 DB trigger cross-check |
| 10 | Feriados + feria + días inhábiles calendar | **partial** | engine honours them (F03-H1 calendar cross-check); settings UI + official 2026/27 dates = M2 |
| 11 | Días inhábiles settings (S30) | **no** | settings page not built |
| 12 | Plazo reminder notifications (day-before/day-of) | **no** | no jobs; only the creation-time in-app notification (F03-H1) |
| 13 | Task creation and assignment | **no** | no `/tareas` route |
| 14 | Task states (five defaults) | **no** | — |
| 15 | In-app notification panel and page | **partial** | page + bell + read-on-click deep links + mark-all green (F06-H1); bell dropdown, category filter, pagination = M2 |
| 16 | Daily email digest Mon–Fri 08:00 | **no** | no Resend/jobs yet |

Rows where `original = no` (WhatsApp module — our own scope) are excluded from the score:
inbox **yes**, intake bot **partial** (incoming + webhook green; Graph outbound = M3),
appointment booking **no** (M3). Seven rows are `skip` on purpose (proprietary content,
third-party portals, their legal attestation) and also unscored.

Raw tool output: Appendix A (features only) and Appendix B (`--visual`).

---

## 3. Layout diff (partial and honest)

### Clone captures (`replica/clone-screens/`, this session)

| File | Viewport | Bytes |
| --- | --- | --- |
| `S01-login.png` | 1440×900 | 33 687 |
| `S03-onboarding.png` | 1440×900 | 50 664 |
| `S07-list.png` | 1440×900 | 116 027 |
| `S07-nueva.png` | 1440×900 | 65 971 |
| `S08-detail-resumen.png` | 1440×900 | 119 010 |
| `S12-nueva-prueba.png` | 1440×900 | 79 003 |
| `S21-notificaciones.png` | 1440×900 | 109 841 |
| `A01-bandeja.png` | 1440×900 | 90 270 |
| `S38-expedientes-390.png` | 390×844 | 44 173 |

Captured by `e2e/screenshots.spec.ts` (seeded data, session from `auth.setup.ts` storageState,
falling back to the shared `login()` helper when bounced). State note: the list shows the
seeded cases plus `E2E <timestamp>` rows left by the e2e suite (the suite creates a case per
F03-H1 run and does not delete it) — the capture ran right after the green suite.

### Original → S-ID mapping (only pairs that actually exist)

| Original file (pre-existing) | Content actually shown | Mapped S-ID | Confidence | Clone counterpart |
| --- | --- | --- | --- | --- |
| `asistente-expediente-v1.webp` (converted to `.png`, 2880×1800 = 1440×900 @2x) | Original case detail with the **Actuaciones** tab active and the **Asistente side panel** open | **S08** (case detail family) + S23 panel — *not* the S11 reader: it shows the actuaciones **list**, not a document reader | **medium-low** — same route family and same viewport, but a different tab and an open assistant pane | `S08-detail-resumen.png` (Resumen tab) |
| `asistente-panel-v1.webp` (800×1040) | Asistente panel alone, narrow crop | S22/S23 assistant | medium | none — assistant not built |
| `finanzas.webp` (1920×1080) | Finanzas > Resumen inside a **marketing composite** (chapter "1 de 6" overlay + callout) | S31 | low-medium — marketing render, not a raw capture | none — finanzas not built |

No image was downloaded this session; the three `.png` files next to the `.webp` originals are
format conversions made by `scripts/webp-to-png.mjs` (Chromium decodes the webp, element
screenshot at natural size — no resampling).

### Scores per pair

| Pair | imgdiff (layout mode) | Verdict |
| --- | --- | --- |
| `asistente-expediente-v1.png` vs `S08-detail-resumen.png` | **26.5** | **DIFFERENT** |
| everything else captured | **n/a — no original screenshot (documented gap)** | — |
| `A01-bandeja` | **n/a — original has no WhatsApp module** (own design) | — |

Diff artefact: `replica/diffs/S08-vs-asistente-expediente.{png,json}`. Differences flagged
across the whole frame (original coordinates): the original has the full nav sidebar + 10-tab
strip + assistant pane; the clone has a 3-item sidebar and 2 tabs. Caveats: different tab
active, assistant pane open only in the original, and imgdiff ignores colour (rebrand does not
count), so 26.5 reflects genuine structural divergence, not styling.

---

## 4. Behaviour diff

### Flows — original click counts are the recon's happy-path numbers to beat

| Flow | Original (recon) | Clone (e2e evidence) | Judgment |
| --- | --- | --- | --- |
| **F01** connect a judicial portal | ~7 clicks (Integraciones → PJN → CUIT → Verificar → Listo → Expedientes) | **not built** — no Integrations screen (PJN/MEV/scheduler rows = `no`) | **fix** M2+ — needs real portal credentials; nothing to beat yet |
| **F02** open a case and read its movements | ~5 clicks (list → row → Actuaciones → Leer → ask assistant) | **2 clicks** to the case detail (F02-H1: list → carátula); Actuaciones tab and reader **not built** | **fix** M2 (remaining tabs T6 + reader) — opening ties the original, the reading half is missing |
| **F03** set a procedural deadline | ~6 clicks (list → row → Pruebas → Agregar Prueba → tipo + Continuar → Crear) | **4 clicks** from the list row: row → Pruebas → Agregar prueba → Guardar (F03-H1); the type picker is a field inside the single form, no Continuar step | **keep** — one step fewer than the original, same engine guarantees (DB trigger + feriados/feria) |
| **F04** assign a task | ~3 clicks (Tareas → Nueva tarea → Crear) | **not built** (tareas rows = `no`) | **fix** M2 |
| **F05** draft an escrito with AI | ~7 clicks, gated Pro/Max (trial 5 consultas) | **not built** (asistente-ia rows = `no`) | **fix** M2+ — out of M1 scope |
| **F06** digest & notifications | bell (1) → panel opens → unread item (2) → reading; plus e-mail "Resumen diario" | bell is a direct **link** to the page (1) → notification deep-links to the case `?tab=` (2) — F06-E14; **no panel, no digest** | **keep** the direct link (fewer clicks than bell → panel → item); **fix** M2: bell dropdown panel + daily digest + 07:00 reminder jobs |
| **WA intake** (our own scope) | n/a — Veredicta has no WhatsApp module | inbox list + status filters + states green (WA02); webhook handshake, `X-Hub-Signature-256`, exactly-once storage, local bot green (WA01/WA03) | **keep**; M3: Meta Graph outbound, 24 h window, appointment booking |

### Error behaviour

| Case | Original | Clone | Judgment |
| --- | --- | --- | --- |
| Wrong password | thin evidence (errors documented mainly on sign-up) | typed Spanish `role="alert"` error (AU01-N1) | **keep** |
| Empty / malformed fields | documented on S02 (min 8 chars, valid e-mail) | field errors, no request fired (AU01-N2/N3) | **keep** |
| Expired / revoked session | not documented | bounce to `/login` on every guarded screen (AU01-E10, F02-E10, F06-E10, WA01-E10) | **keep** — stronger than the original's evidence |
| Offline / 5xx | error states documented | typed error + `Reintentar` recovers (F02-E9, F06-E8/E9/N1, WA01-E8/E9/N1) | **keep** — offline handling is extra |
| User with no study (`no_study`) | gate modal "¿Con qué estudio querés trabajar?" when 2+ studies lack an active one | typed copy at the data layer — "Primero terminá la configuración de tu estudio." (`lib/data/errors.ts`, thrown by `lib/data/studies.ts`); **no UI e2e covers the path** | **fix** small: add a test when the guard UI lands (not a bug today) |
| Empty / no-results list | "No encontramos expedientes" + Limpiar filtros | "No encontramos coincidencias con tu búsqueda" + Limpiar búsqueda (F02-E1); notifications empty state; inbox "No hay conversaciones con este filtro" + Ver todas (WA02-H3) | **fix** M2 — wording converges when the Filtros panel arrives |
| Unknown case id | thin evidence | friendly "No encontramos este expediente…" (F02-N3) | **keep** |

### What is remembered between visits

| State | Original (recon) | Clone | Judgment |
| --- | --- | --- | --- |
| Filters | persist per browser, restored by the back arrow | **no filters yet** | **fix** M2 (with the Filtros panel) |
| Case tab | `?tab=` deep link + per-case tab memory | `?tab=` survives refresh (F02-E7); back returns to the list (F02-E6); no cross-visit tab memory | **fix** M2 (T6) |
| Search text | per-screen search state | not persisted across navigation (only live filtering asserted) | **fix** M2 with filters |
| Mobile bar | 5 items: Inicio, Expedientes, Asistente, Avisos, Menú | **3 items**: Expedientes, Bandeja, Avisos (+ header bell) — Inicio/Asistente/Menú absent, Bandeja is ours | **fix** M2/M3 as those screens land; **keep** Bandeja (our module) |

---

## 5. Missing features, in build order (summary)

Full list with priorities and notes: Appendix A (`parity.py` "Missing, in build order").

1. **Must (7 `no`)**: favorites/archive/soft-delete · manual movement log (S09) · daily e-mail
   digest · días inhábiles settings (S30) · plazo reminder jobs · task creation · task states.
2. **Must (6 `partial`)**: onboarding steps 4–5 · case-detail tabs 3–10 (T6) · list Filtros
   panel · notification bell panel/categories/pagination · feriados official 2026/27 dates +
   settings · pruebas per-type estados + person picker + historial.
3. **Should**: portal connectors (F01), actuaciones/reader/novedades, agenda, documentos,
   roles/permissions, Google/2FA/invitations, profile settings, Personas, deadline colours,
   standalone calculator, Kanban.
4. **Could**: AI assistant/drafting/review/MCP, finanzas, biblioteca, editor, dashboard engine,
   activity log, help overlays, web push.

---

## 6. Verdict and top five to build next

**Verdict: NOT SHIPPABLE.** 13 of 16 must-haves are not done (feature score 16.9, far below
the 80 threshold). Bug status is clean — all 6 bugs in `replica/bugs.md` are fixed and the
suites are green (119 unit + 58 e2e) — so the gap is **feature breadth**, exactly what M2
exists to close. The clone cannot yet match the original's core loop beyond the
case → prueba → plazo → alerta slice.

Top five things to build next (maximises must-have completion):

1. **Tasks module (F04)** — creation + the five default states + board/list views: 2 must rows,
   area currently 0.0.
2. **Manual movement log (S09)** — 1 must row, area currently 0.0 (movimientos).
3. **Expedientes completeness** — Filtros panel, favorites, archive, bulk bar, row ⋯ menu:
   2 must rows (list-with-filters, favorites/archive) and it restores filter memory.
4. **Plazos settings** — S30 días inhábiles UI + official 2026/27 feriados + countdown colour
   states: 2 must rows (días inhábiles, feriados partial) plus a should.
5. **Notifications completion** — bell dropdown panel, category filter, pagination, daily
   e-mail digest, 07:00 reminder jobs: 3 must rows (panel partial, digest, reminders).

Remaining must partials not in the top five (fast wins): onboarding steps 4–5, case-detail
tabs (T6), pruebas per-type estados + person picker.

---

## 7. Verification (this session, foreground)

- `python parity.py replica/features.csv` → `Parity: 16.9 / 100`, `features 16.9 (60 counted,
  must-haves 3 of 16 done)`, `Not shippable yet: 13 must-have features are not done.` — full
  output in Appendix A. `--visual` run → `Parity: 18.8 / 100` (Appendix B).
- `python -c` CSV check → `rows: 70 bad: []` (every row parses to exactly 6 columns).
- `git status --short` →

  ```
   M replica/features.csv
  ?? e2e/screenshots.spec.ts
  ?? replica/clone-screens/
  ?? replica/diffs/
  ?? replica/screens/asistente-expediente-v1.png
  ?? replica/screens/asistente-panel-v1.png
  ?? replica/screens/finanzas.png
  ?? scripts/
  ```

  Only the declared surfaces; no application code, no `replica/recon.md`/`build-log.md`/
  `bugs.md`/`architecture.md`/`test-plan.md`/`production-checklist.md`, no config files.
- Screenshot files exist with sizes: listed in §3 (9 files; 8 × 1440×900, 1 × 390×844).
- Suites: `vitest run` → **119 passed (15 files)**; `npx playwright test` → **58 passed,
  1 skipped** (the skip is AU02-H1 "attempt once" by design); capture run → **21 passed,
  1 skipped** including all 9 `screenshots.spec.ts` tests.

---

## Appendix A — raw `parity.py replica/features.csv` output

```
Parity: 16.9 / 100

features 16.9  (60 counted, must-haves 3 of 16 done)

Not shippable yet: 13 must-have features are not done.

By area, weakest first
- judicial-sync                  0.0  (5 features)
- movimientos                    0.0  (4 features)
- tareas                         0.0  (4 features)
- agenda                         0.0  (4 features)
- documentos                     0.0  (3 features)
- asistente-ia                   0.0  (5 features)
- roles                          0.0  (2 features)
- finanzas                       0.0  (2 features)
- biblioteca                     0.0  (2 features)
- editor                         0.0  (1 features)
- config                         0.0  (5 features)
- notificaciones                16.7  (4 features)
- plazos                        28.1  (6 features)
- auth                          37.5  (5 features)
- expedientes                   40.0  (6 features)
- pruebas                       50.0  (1 features)
- mobile                       100.0  (1 features)

Missing, in build order
- [must] expedientes: Favorites / archive / soft-delete cases, no  (S07 row menu and bulk bar; favorites are studio-wide | M2)
- [must] movimientos: Manual movement log per case, no  (S09; hand-entered history distinct from portal actuaciones | M2)
- [must] notificaciones: Daily email digest Mon-Fri 08:00, no  (F06 Resumen diario | M2 (Resend + jobs not in M1))
- [must] plazos: Dias inhabiles settings (system + studio), no  (S30 dias-inhabiles; feeds the deadline engine | M2)
- [must] plazos: Plazo reminder notifications (day-before / day-of), no  (F03 and F06; 07:00 to all members | M2 (Inngest jobs); clone only writes a creation-time in-app notification (F03-H1))
- [must] tareas: Task creation and assignment, no  (F04; three clicks on the happy path | M2)
- [must] tareas: Task states (five defaults + custom), no  (S16; Pendiente / En curso / Para revisar / Completada / Cancelada | M2)
- [must] auth: Five-step onboarding wizard (jurisdictions / profile / studio), partial  (S03; creates the studio right after sign-up | M1: steps 1-3 of 5 (jurisdicciones / perfil / estudio); steps 4-5 arrive in M2)
- [must] expedientes: Case detail hub with tabs, partial  (S08 | Resumen + Pruebas tabs with ?tab= deep link (F02-E7 refresh keeps it); remaining 8 tabs = M2)
- [must] expedientes: Expedientes list with search and filters, partial  (S07 | list + accent/typo-tolerant search shipped (BUG-003 fix; lib/search.ts; F02-E3 green); Filtros panel; favorites; archive = M2)
- [must] notificaciones: In-app notification panel and page, partial  (S21 | page + header bell (link; badge 0-9/9+) read the DB; read-on-click deep links; mark-all; 4 category badges green (F06-H1); bell dropdown panel; category filter; pagination; 6 categories = M2)
- [must] plazos: Feriados + feria + dias inhabiles calendar, partial  (F03; January and July judicial feria; provincial holidays never count | M1: engine honours system + studio days and generates feria; settings UI (S30) and official 2026/27 feriados in M2 (TODO(gap)))
- [must] pruebas: Pruebas tracking (six evidence types), partial  (S12 | create prueba (tipo; titulo; informante; fecha efectiva; plazo) with fecha limite from the engine; F03-H1 green (form -> DB -> badge); per-type estados; person picker; historial = M2)
- [should] agenda: Categories and audiencias / vencimientos overlays, no  (S17; six default categories with 11 colors)
- [should] agenda: Create event from reader shortcuts, no  (S06 and S11 Crear evento shortcut)
- [should] agenda: Shared studio calendar (five views), no  (S17; Dia / Semana / Mes / Año / Lista)
- [should] auth: Email invitations for teammates, no  (S28; invitee landing screen evidenced in configurar-tu-estudio)
- [should] auth: Google sign-in and passkey login, no  (S01 and S26; passkey flow evidenced in security docs)
- [should] auth: Two-factor auth and backup codes, no  (S26 Seguridad page; thin evidence (index lines only))
- [should] config: Personas directory, no  (S30 | M2; prueba informante is a plain text input until the directory lands (nueva-prueba-form))
- [should] config: Profile and security settings, no  (S26; name / photo / password / 2FA / passkeys)
- [should] documentos: File preview and version list, no  (S19; thin evidence)
- [should] documentos: File upload with per-case folders, no  (S18; breadcrumb + storage meter + upload panel)
- [should] documentos: Protected folders and permission padlock, no  (S18; system documents / pruebas / assistant attachments)
- [should] expedientes: Case stages (etapas) settings, no  (S30 settings page | M2; the case form already consumes seeded stages (lib/data/stages; stages.test.ts))
- [should] judicial-sync: Background sync scheduler with status chips, no  (S25; Conectada / Sincronizando / Error; ~30 min cadence)
- [should] judicial-sync: MEV sync via email forwarding, no  (S25; six-step forwarding setup without credentials)
- [should] judicial-sync: PJN connector (CUIT/CUIL credential verify), no  (S25; terms forbid scraping so build our own connector)
- [should] judicial-sync: Sync error handling and rate-limit retry, no  (F01 edges; five attempts then stop then auto-retry 2 min to 6 h)
- [should] movimientos: Actuaciones list with estado chips, no  (S10; synced cases only; 7 estado values)
- [should] movimientos: In-app document reader with citations, no  (S11; J and K navigation; Copiar cita with page)
- [should] movimientos: Novedades judiciales feed (two views), no  (S05 and S06; por expediente / por novedad)
- [should] notificaciones: Notification preferences per category, no  (S21 Preferencias; thin evidence)
- [should] plazos: Deadline countdown color states, no  (S12; green / amber <=48h / red vencido | clone badge is plain text today (case-detail-view); no colour states)
- [should] plazos: Standalone deadline calculator tool, no  (S34 /tool/deadline-calculator; free on every plan)
- [should] roles: Read-only mode after trial ends, no  (S07 and S18 banners; 14-day grace for documents)
- [should] roles: Roles and permissions (9 areas / 28 perms), no  (S27; Dueño role fixed and undeletable; 50 roles per studio)
- [should] tareas: Kanban board and list views, no  (S16; group by estado / responsable / prioridad / expediente)
- [could] agenda: Google Calendar sync, no  (S12 and S17; Google Calendar status row)
- [could] asistente-ia: AI assistant chat with page-level citations, no  (S22; effort selector + skills via / + step log)
- [could] asistente-ia: AI drafting split view (Redactar escritos), no  (F05; draft versions + Guardar en Documentos)
- [could] asistente-ia: AI mass document review (Analisis de documentos), no  (S36; index-only evidence; not in trial)
- [could] asistente-ia: AI quota gating (weekly limits + trial), no  (F05; trial five consultas per member; Pro/Max only)
- [could] asistente-ia: MCP endpoint to connect Claude or ChatGPT, no  (own implementation; Veredicta MCP is per-account Pro/Max)
- [could] biblioteca: Herramientas legales (23 free tools), no  (S34; free on every plan including trial)
- [could] biblioteca: Jurisprudencia full-text search, no  (S35; thin evidence; fetch SAIJ and JUBA corpora directly)
- [could] config: Activity log with CSV export, no  (S30 Actividad; before and after values per row)
- [could] config: Dashboard block engine (20 block types), no  (S04 and S31 shared engine; scope dialog per user/studio)
- [could] config: Per-screen help and tutorial overlays, no  (S37; lifebuoy dialog + guided click panel)
- [could] editor: Word-like collaborative escrito editor, no  (S20; save states + modes + comment threads)
- [could] expedientes: Vista general cross-case matrix, no  (S15; read-only by design; thin evidence)
- [could] finanzas: Finanzas dashboard (KPIs / aging / rentabilidad), no  (S31; reuses the dashboard block engine)
- [could] finanzas: Finanzas movements and categories, no  (S31 and S32; thin evidence (index lines only))
- [could] judicial-sync: Other portal connectors (EJE / IOL / SED / PCJ), no  (S25 catalogue; prioritize after PJN and MEV)
- [could] notificaciones: Web push (desktop + Android), no  (F06; no iOS push so email digest only)
- [could] tareas: AI-created tasks (Procurador IA), no  (S16 filter Creada por; source actuacion + plazo)

Left out on purpose (not scored)
- Veredicta MCP server + AI prompts + proprietary text: their implementation and prompts are proprietary; clean-room forbids reuse
- Modelos de escritos library (750+ models): their content; build a smaller original library
- AI-generated jurisprudence sumarios: their generated content; query public SAIJ and JUBA directly
- Veredicta brand name marketing copy and manual content: brand and copy are theirs; write our own help and rename everything
- Veredicta users network and stored data: their users and stored data cannot be cloned
- Court portals themselves (PJN / MEV and others): third-party public systems; only our own connectors may touch them
- Sworn-lawyer declaration sign-up flow: their legal attestation; validate lawyers our own way

Yours, not in the original (not scored)
- WhatsApp intake bot (Module A)
- WhatsApp conversation inbox
- Appointment booking via WhatsApp
```

## Appendix B — raw `parity.py --visual` header

```
Parity: 18.8 / 100

features 16.9  (60 counted, must-haves 3 of 16 done)
layout   26.5  (1 screens compared)

Not shippable yet: 13 must-have features are not done.
```

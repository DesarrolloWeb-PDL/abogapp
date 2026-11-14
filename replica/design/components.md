# Component specs — clean-room clone (Module B + Module A)

Companion to `tokens.json` / `tokens.css` / `tailwind-theme.css`. One block per
component: the **19 rows of the recon components table**, **4 extra components the
recon evidences but does not tabulate** (added because the brief expects 23 recon
blocks — **TODO(gap):** the recon table itself has 19 rows), and **7 Module A
blocks** (our own design, no Veredicta reference).

## Conventions

- **Tokens only.** Components use roles (`bg-surface`, `text-muted`, `border-input`),
  never raw hex. Contrast: `design/contrast-report.txt` — 30 pairs, 0 AA failures.
- **States in every block:** the ones the recon saw + `focus-visible`, `disabled`,
  `loading`, `error`, `empty`.
- **Design constraints (low technical resistance):** body text ≥ 16px
  (`text-base` / `body-copy`), touch targets ≥ 44px (`touch-target`, `h-11`),
  high contrast (AA floor, verified), plain-language Spanish labels, every
  destructive action confirmed by a dialog.
- **Language:** all user-facing strings are Argentine Spanish (rioplatense voseo,
  neutral-professional register) and are marked `[UI copy]`. They are written
  fresh for this clean-room build — not copied from the reference product.
- **Keyboard/SR:** `keyboard` = expected key handling, `screen reader` = live
  region, roles and announcement behaviour.

---

## Recon components (19 rows)

### 1. Sidebar nav
- **variants** expanded (240px) / collapsed (64px, icon-only) / mobile `<768px` → bottom bar (Inicio, Expedientes, Asistente, Avisos, Menú) + full-screen Menú; permission-gated items hidden by role; collapsible groups (group header toggles, state remembered); Module A adds the **Bandeja** item below Expedientes.
- **sizes** width 240 / 64; item height 44 (`touch-target`); group label `text-xs`, nav item `text-base` (body floor).
- **states** default, hover (bg `accent-tint`), active (bg `accent-tint`, `text accent`, `aria-current="page"`), focus-visible (2px ring `accent`), disabled (permission-gated → hidden, not greyed), collapsed (tooltip shows the label), trial card variant (days left / ended), unread badges (`info` count, `danger` dot).
- **tokens** bg `surface`, border-r `border`, item text `text-muted`, active text `accent`, badge bg `danger` text `on-primary`, count bg `info`.
- **keyboard** `Cmd/Ctrl+B` toggles collapse; `Tab` moves through items in visual order; `Enter`/`Space` activates; `Esc` closes the mobile Menú screen; focus stays inside the mobile drawer (focus trap) and returns to the trigger.
- **screen reader** `<nav aria-label="Navegación principal">`; active item announced as "página actual"; badge counts exposed as text ("3 sin leer"); collapse state via `aria-expanded` on the toggle.
- **a11y** real `<a>`/`<button>` per item; visible focus ring; `aria-current`; group labels are headings, not decorative text.
- **used on** all screens (S01–S38; mobile shell S38).
- **UI copy** `[UI copy]` nav items: "Inicio", "Expedientes", "Vista general", "Tareas", "Agenda", "Documentos", "Bandeja", "Asistente", "Configuraciones"; group labels "BIBLIOTECA", "INTELIGENCIA ARTIFICIAL"; trial card: "Tu prueba termina en 12 días" / "Activá un plan".

### 2. Notifications bell + panel + page
- **variants** panel (anchored, tabs) vs full page `/notifications`; mobile → bottom-bar "Avisos"; per-category icon chips.
- **sizes** bell button 44×44; badge max width shows `9+`; panel 400px wide, page list capped at 20 rows per "Cargar más".
- **states** no unread (plain bell), unread (count badge `info`), panel open, read-on-click, loading (skeleton rows), empty, no-results (with Limpiar filtros), error (+ Reintentar).
- **tokens** badge bg `info` text `on-accent`; unread row dot `info`; unread title `text` weight 600, read title `text-muted`; panel `surface` + `shadow-pop` + `border`.
- **keyboard** `Tab` to bell, `Enter` opens; inside panel arrow keys move rows, `Enter` follows the deep link, `Esc` closes and restores focus to the bell; `End`/`PageDown` on the page loads more.
- **screen reader** bell has `aria-label` with unread count; badge updates announced via polite live region; deep-link destination described before navigation ("Actuación del expediente Gómez, María c/ Transportes del Sur").
- **a11y** 44px target; panel is a `role="dialog"` with accessible name; read state conveyed by weight + `aria-pressed` on "Marcar como leída", not colour alone.
- **used on** global (S21 panel/page, mobile S38 Avisos).
- **UI copy** `[UI copy]` "Notificaciones", "Sin leer", "Marcar todas como leídas", "Cargar más", empty: "No hay notificaciones nuevas", no-results: "No hay resultados con estos filtros".

### 3. Search + filter bar (pattern)
- **variants** search box (accent/typo-tolerant on Expedientes) + filter panel with active-count badge + Limpiar; narrow screens collapse filters into a single **Filtros** button; per-screen instance (no global search).
- **sizes** input height 44 (`touch-target`), `text-base`; filter button 44; active-count badge 20px circle.
- **states** idle, typing, results (live), no-results (empty + Limpiar), filters active (count badge), loading (thin top bar), error (+ Reintentar), read-only (input disabled with reason).
- **tokens** input bg `surface`, border `border-input`, placeholder `text-muted`, focus ring `accent` 2px; badge bg `accent` text `on-accent`; active filter chip bg `accent-tint` text `accent`.
- **keyboard** `/` or `Ctrl/Cmd+K` focuses the search (where the screen documents it); `Esc` clears the query then closes the panel; `Tab` order input → filter chips → Limpiar; arrow keys navigate filter options; results update without stealing focus.
- **screen reader** input has `aria-label` per screen ("Buscar expedientes"); result count announced politely ("12 resultados"); active filter count in the button label; loading uses `aria-busy` on the list, not on the input.
- **a11y** placeholder is never the only label (`<label>` or `aria-label`); 3:1 input border (verified 3.64:1 on surface); chip state exposed via `aria-pressed`.
- **used on** S05, S07, S10, S15, S16, S17, S18, S21, S33, S34.
- **UI copy** `[UI copy]` placeholders: "Buscar por carátula, número o juzgado", "Buscar tareas", "Buscar en las actuaciones"; actions: "Filtros", "Limpiar filtros"; empty: "No hay resultados para tu búsqueda".

### 4. Data table
- **variants** sortable columns (click header), drag header to reorder, drag edge to resize (remembered), multi-select (checkbox / Shift / Ctrl, `Esc` clears), row ⋯ menu + right-click, footer counter, bulk action bar; reduced mobile variant (fewer columns, no multi-select).
- **sizes** row height 44, header `text-xs` uppercase-ish muted, cells `text-base` (body floor), sticky header, 50 rows per page + progressive loading.
- **states** filled, empty ("no data yet"), no-results (filters active), loading (skeleton rows — **TODO(gap):** the reference product documents almost no skeleton states), read-only banner, error (+ Reintentar), selected rows (bulk bar), hover, focus-within row.
- **tokens** header bg `bg`, row bg `surface`, divider `border`, hover bg `accent-tint` (subtle), selected bg `accent-tint`, destructive bulk action `danger`.
- **keyboard** `Tab` through row controls; `Space` toggles the focused checkbox; `Shift+click`/`Shift+Space` extends range; `Esc` clears selection and closes the row menu; `Enter` on a row opens the detail; sortable headers are `<button>` inside `<th>` with `aria-sort`.
- **screen reader** `<table>` with `<caption>` (visually hidden) and `scope="col"`; selection state via `aria-selected` + announced count ("3 filas seleccionadas"); footer counter as live region ("Mostrando 12 de 48").
- **a11y** rows are reachable without mouse; right-click menu always has a keyboard equivalent (⋯ button); status never colour-only (text + icon).
- **used on** S07, S10, S15, S18, S32.
- **UI copy** `[UI copy]` footer: "Mostrando 12 de 48 expedientes"; bulk bar: "3 seleccionados", "Archivar", "Eliminar"; empty: "Todavía no hay expedientes"; no-results: "No encontramos coincidencias".

### 5. Favorites star
- **variants** studio-wide (expedientes), per-account (modelos), per-browser (herramientas), per-member (tareas); filled vs outline.
- **sizes** 44×44 hit area, 20px glyph.
- **states** not favorite (outline), favorite (filled `favorite`), hover (glyph tint), focus-visible ring, loading (optimistic toggle, spinner on failure → revert + toast), disabled (read-only mode).
- **tokens** glyph `favorite`, outline stroke `border-input`, focus ring `accent`.
- **keyboard** reachable by `Tab`; `Enter`/`Space` toggles; state change announced ("Agregado a favoritos" / "Quitado de favoritos"); `aria-pressed` reflects state.
- **screen reader** `role="button"` + `aria-pressed` + accessible name including the row it belongs to ("Favorito: Gómez, María c/ Transportes del Sur").
- **a11y** state is shape + `aria-pressed` + label, never colour alone (the star glyph alone measures 2.0:1 on white — see tokens.json `_notes.favorite`).
- **used on** S07, S16, S33, S34.
- **UI copy** `[UI copy]` labels: "Marcar como favorito" / "Quitar de favoritos"; toast: "Se guardó en favoritos".

### 6. Dialogs / modals
- **variants** form dialog (Nueva tarea, Agregar prueba), picker→form two-step, confirm dialog (destructive), scope dialog ("¿Para quién guardás estos cambios?"), admin modal (categorías, comparar roles), help dialog; sizes: compact / standard / wide (editorial).
- **sizes** max-width 480 / 640 / 960; padding 24; footer buttons 44 high; on mobile `<768px` → full-screen sheet.
- **states** open, validating (inline errors), submitting (loading, button disabled), error (reason + retry), success (closes + toast), nested confirm (destructive), dirty-close confirm.
- **tokens** panel `surface` + `shadow-pop` + `radius-lg`, overlay `rgba(16,24,40,.4)`, primary action bg `primary` text `on-primary`, destructive bg `danger` text `on-primary`, input border `border-input`.
- **keyboard** focus moves to the dialog (or first invalid field) on open; `Tab` cycles inside only (focus trap); `Esc` closes unless a submit is running; `Enter` submits when a single primary action exists; focus returns to the trigger on close.
- **screen reader** `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) and `aria-describedby` (body); validation errors in `role="alert"` bound via `aria-describedby`; submit result announced before close.
- **a11y** every destructive action is confirmed with an explicit verb label; overlay click does not discard typed data without the dirty-confirm; error text is never colour-only.
- **used on** nearly all screens (S04, S07, S12, S16, S17, S24, S27, S31…).
- **UI copy** `[UI copy]` titles: "Nueva tarea", "Agregar prueba"; confirm: "¿Descartás los cambios?"; destructive: "¿Eliminás este expediente? Esta acción no se puede deshacer." buttons "Cancelar" / "Eliminar"; scope: "¿Para quién guardás estos cambios?" options "Solo para mí" / "Para todo el estudio".

### 7. Toasts / aviso bar with Deshacer
- **variants** success toast, undo toast (with action), error toast (persistent + reason), persistent top banner (scheduled deletion, sync paused, read-only mode).
- **sizes** toast 360px max, min-height 44, bottom-right (desktop) / above the bottom bar (mobile); banner full-width, 44 high.
- **states** entering, visible (success 4s, undo 10s), error (stays until dismissed), paused on hover/focus, dismissed, empty (no toasts), stacking (max 3, then queue).
- **tokens** success toast bg `success-tint` text `success`; error bg `danger` text `on-primary`; neutral bg `text` text `on-primary`; banner bg `warning-tint` text `warning` with `border` (read-only banner uses `info-tint`/`info`).
- **keyboard** toast action is a real button reachable by `Tab` before it auto-dismisses; `Esc` dismisses the top toast; banners are focusable when they contain an action.
- **screen reader** toasts `role="status"` (polite); errors `role="alert"`; undo announces the action name and the countdown is not announced.
- **a11y** 10s undo window for reversible bulk actions; never the only feedback for a destructive action (destructive also gets a confirm dialog); contrast verified for every toast pair.
- **used on** global (S04, S07, S16, S18, S24, S25).
- **UI copy** `[UI copy]` success: "Tarea creada", "Se guardaron los cambios"; undo: "Moviste 4 archivos" + "Deshacer"; error: "No se pudieron guardar los cambios. Intentá de nuevo."; banners: "Modo solo lectura", "La sincronización está pausada por falta de espacio".

### 8. Reader layout (document + Assistant)
- **variants** novedades reader, actuación reader, file preview; document pane left + assistant panel right (≥1024px), controls bar below the document when the panel is absent.
- **sizes** panel 400 (`--ds-layout-assistant-panel`), draggable divider (double-click resets), document max 900, toolbar 44.
- **states** filled, no-document placeholder, gated document (plan), storage full, AI-not-readable, multi-file ("Documento 1 de 4"), folded panel (remembered per device), panel absent `<1024px`, loading (previous page stays + thin top bar), error (+ Reintentar).
- **tokens** pane `surface`, document sheet `surface` on `bg`, toolbar border `border`, progress ring `accent`, state chips per `Status chips`.
- **keyboard** `J`/`K` and arrows move previous/next; `Esc` closes and returns to the list with the last-read row highlighted; `+`/`-` zoom; `P` prints/preview; focus returns to the row that opened the reader.
- **screen reader** document title is the page heading; "Documento 2 de 4" announced on change; page position via `aria-live="polite"`; state chips expose their reason text.
- **a11y** text selection toolbar buttons are keyboard reachable; panel fold state persists but does not trap focus; reading order is document → assistant.
- **used on** S06, S11, S19.
- **UI copy** `[UI copy]` "Documento 2 de 4", "Plegar el panel", "Sin documento publicado para esta actuación", "Guardá los archivos con un plan activo", "Copiar cita".

### 9. Assistant chat
- **variants** full screen `/asistente`, 400px side panel (only ≥1024px, expandable), embedded (editor button, "Completar con IA", reader side); mobile → full screen with hidden bottom bar.
- **sizes** message max 64ch, composer min 56, effort selector segmented control 44 high, citation chips `text-sm`.
- **states** empty (welcome + 4 suggestions), working (step log, "Detener la respuesta"), streaming, stopped, limit/gating error, quota exceeded, read-only redirect, mobile full-screen, loading conversation list, error (+ Reintentar).
- **tokens** user bubble bg `accent-tint` text `text`, assistant bubble `surface` + `border`, citations `info`, disclaimer `text-muted` `text-xs`, focus ring `accent`.
- **keyboard** `Cmd/Ctrl+J` opens the panel; `/` opens skills; `Esc` stops generation then closes; `Enter` sends, `Shift+Enter` newline; `↑` edits the last message; focus stays in the composer during streaming (`aria-live` on the tail, not the whole answer).
- **screen reader** answers announced as they settle (polite region, chunked); citations are links with the document name + page; effort selector exposes `aria-pressed` per level; stop button label changes with state.
- **a11y** disclaimer always visible; effort level persisted and explained; no colour-only status (working state has a visible label); 44px controls.
- **used on** S22, S23, S24 + entry points on S06, S08, S11, S20.
- **UI copy** `[UI copy]` placeholder "Escribí tu consulta…", disclaimer "La IA puede cometer errores. Verificá la información.", empty "¿En qué te puedo ayudar?", stop "Detener la respuesta", limit "Llegaste al límite de consultas de IA por ahora".

### 10. Draft card + split editor
- **variants** draft card above the composer; split view (editor left + chat right, draggable divider); multi-draft list.
- **sizes** card 100% × 56; divider min 320/280; version list 280.
- **states** Borrador / Abierto / En Documentos, working ("Trabajando en el borrador…"), updated (+ Deshacer), saved (+ linked doc), save error (with Word fallback), version restored, AI-change highlight, post-save confirmation required, hidden chat.
- **tokens** card bg `accent-tint` border `accent`, status chips per `Status chips`, diff highlights `info-tint`/`info`, save indicator `success`/`warning`/`danger`.
- **keyboard** `Esc` hides the chat; `Tab` cycles editor → chat; version list is a `listbox`; "Restaurar" requires confirm; undo via the card button (focus preserved).
- **screen reader** status announced on change ("Borrador guardado en el expediente"); version count and current version in the card label; diff changes described by the highlight label, not colour alone.
- **a11y** save state is always textual; failure path never blocks downloading the file.
- **used on** S24 (entry S22/S23).
- **UI copy** `[UI copy]` "Borrador de esta conversación · versión 3", "Guardar en Documentos", "Se actualizaron 2 párrafos", "No se pudo guardar" + "Descargar Word".

### 11. Editor
- **variants** menus Archivo/Formato/Insertar/Revisión/Ayuda; modes Edición / Sugerencias / Lectura; comment threads (comment, reply, resolve).
- **sizes** page sheet 820px, toolbar 44, mode segmented control 44, comment rail 280.
- **states** saved, saving, offline (changes kept), local-only fallback, blocked exit ("Todavía estamos guardando"), read-only (old document), no permission (error), AI-change highlights, padlock without plan, loading.
- **tokens** toolbar `surface` + `border`, active menu item `accent-tint`/`accent`, save states: `success` / `warning` / `danger`, comment anchor `warning`.
- **keyboard** standard shortcuts (`Ctrl+S` save, `Ctrl+Z` undo, `Ctrl+B/I/U`), `Esc` closes menus, menu bar is arrow-key navigable (`role="menubar"`), comments reachable by `Tab` and by a comment list.
- **screen reader** mode changes announced ("Modo lectura"); save state as `role="status"`; comments exposed with author + resolved state; table/heading structure preserved for screen readers.
- **a11y** mode is never colour-only; permission errors are text with a next action; 44px toolbar targets.
- **used on** S20, S24.
- **UI copy** `[UI copy]` menus "Archivo", "Formato", "Insertar", "Revisión", "Ayuda"; modes "Edición", "Sugerencias", "Lectura"; save states "Guardado", "Sin conexión", "Todavía estamos guardando".

### 12. Kanban board + list (Tareas)
- **variants** Tablero / Lista; group columns by Estado, Responsable, Prioridad, Expediente; group rows; manual ordering; task overlay vs full page.
- **sizes** card min 240 wide, min-height 88; column header 44; list row 44.
- **states** filled (5 default states, customisable), drag-over, dragging, overdue (red date + label), cancelled column collapsed, empty (video + Nueva tarea), read-only padlock, loading, error (+ Reintentar), bulk bar.
- **tokens** column bg `bg`, card `surface` + `shadow-card` + `border`, overdue `danger`, priority labels per `Status chips`, favorite star `favorite`.
- **keyboard** `B`/`L` switch views, `C` new task, `/` search; drag alternative: `Space` picks up a card, arrows move it, `Space` drops, `Esc` cancels (announced); cards are links/buttons, not divs.
- **screen reader** column headings are group labels; card announces title, state, responsable, due date; move announced ("Tarea movida a Completada"); counts per column as live text.
- **a11y** no drag-only interaction; overdue conveyed by text label + colour; empty state has a primary action.
- **used on** S16 + expediente tab Tareas.
- **UI copy** `[UI copy]` states "Pendiente", "En curso", "Para revisar", "Completada", "Cancelada"; actions "Nueva tarea", "Ver todas"; empty: "Todavía no hay tareas" + "Crear la primera tarea"; overdue "Vencida hace 2 días".

### 13. Dashboard block engine (20 blocks)
- **variants** Inicio (9 default blocks, 5 groups) and Finanzas widgets (15 in 4 categories); edit mode (drag handle, resize corner, remove cross) + gallery with previews.
- **sizes** grid 12-col desktop, blocks min 300×160, stacked single column `<768px` (edit mode hidden on mobile).
- **states** first-run welcome, filled, no active plan (read-only notice), permission block, edit mode, save-scope dialog, discard-confirm, saving, error (block-level + retry), loading, mobile stacked.
- **tokens** block `surface` + `border` + `radius-lg`, edit outline `accent` dashed, drag handle `text-muted`, KPI values: `success`/`danger`/`text`.
- **keyboard** edit mode: `Tab` to handle, arrows move the block (announced), `Enter` opens the gallery, `Esc` exits edit; resize with arrows + shift for larger steps; save dialog traps focus.
- **screen reader** blocks are a labelled list ("Bloque: Próximos vencimientos"); gallery options expose "En tu Inicio" state; permission block announces the reason.
- **a11y** drag has a keyboard path; personalisation scope choice is a radiogroup; every block has a heading.
- **used on** S04, S31.
- **UI copy** `[UI copy]` "Personalizar", "Agregar bloque", "Guardá los cambios", "Tu rol no incluye este bloque", "¿Para quién guardás estos cambios?".

### 14. Onboarding checklist card
- **variants** with / without a syncable jurisdiction; sequential steps vs "Opcional" group.
- **sizes** card in the Inicio grid, progress ring 56, step row 44.
- **states** 0/5 start, in-progress (ring), step locked (candado), step auto-checked (+ green tick + toast), all done (card hides), hidden via ⋯ (with error state), trial/plan end (disappears), loading.
- **tokens** ring track `border`, ring value `success`, tick `success`, locked icon `text-muted`, card `surface`.
- **keyboard** each step is a link/button; `Esc` closes the card menu; hide action confirms; focus moves to the next unlocked step after completion.
- **screen reader** progress as "2 de 5 pasos completados"; locked steps announced as "pendiente"; auto-check announced politely.
- **a11y** lock state has text, not only an icon; card is dismissible without losing completed state.
- **used on** S04.
- **UI copy** `[UI copy]` "Primeros pasos", "2 de 5 listos", "Siguiente paso", "Opcional", "Ocultar esta tarjeta", error "No pudimos ocultar los primeros pasos".

### 15. Calendar / Agenda views
- **variants** Día / Semana / Mes / Año / Lista; mini-month + category checkboxes; event detail popover; category admin modal; Google Calendar status row.
- **sizes** toolbar 44, mini-month 220, left panel 260 (hidden behind an icon when narrow), event block min 28 high, popover 320.
- **states** filled, free-slot drag-create, now-line, inhábil/feria labels, "+N más" overflow, labels Vence hoy / Vencido / Se superpose, empty-with-filter-chips, error (+ Reintentar), loading (previous period stays + thin bar), mobile Lista/Día only, read-only for system events.
- **tokens** category colours from the 11 agenda palette (**TODO(gap): unmeasured** — only "Google-Calendar-like, 11 colours" is evidenced; derived steps must pass 3:1 against `surface` before use), now-line `danger`, inhábil hatch `border`, weekend toggle `text-muted`.
- **keyboard** `H` hoy, `D/S/M/A/L` views, `C` crear evento, arrows move the selected day, `Enter` opens the day/event, `Esc` closes popover; keyboard "create" path: select slot → `Enter` → form (drag is optional).
- **screen reader** day cells are gridcells with full date labels ("lunes 12 de noviembre, 2 eventos"); view changes announced; category checkboxes expose checked state and counts.
- **a11y** event colour always paired with a text label; hatched non-working days have a legend + text; empty state offers "Limpiar filtros".
- **used on** S17 + expediente tab Agenda.
- **UI copy** `[UI copy]` "Nuevo evento", "Hoy", "Próximos 30 días", "Vence hoy", "Vencido", "No hay eventos con estos filtros" + "Limpiar filtros", error "No pudimos cargar la agenda".

### 16. Date & plazo pickers
- **variants** date calendar (single / range / period presets in filters), "Vence" date field, Plazo group (Horas / Días corridos / Días hábiles + cantidad → live fecha límite), standalone deadline calculator result.
- **sizes** calendar day cell 44, plazo quantity input 96, live result row 44.
- **states** empty, picking, range selected, live recalculation, countdown chip green / amber (≤48h) / red (vencido), hatched non-working days, validation error, calculator loading, calculator error, copy success.
- **tokens** countdown: `success` / `warning` / `danger` with matching tints, hatched days `bg`+`border`, input `border-input`, focus `accent`, result text `text` weight 600.
- **keyboard** calendar: arrows move days, `PageUp/Down` months, `Enter` selects, `Esc` closes; plazo unit selector is a radiogroup; `Ctrl/Cmd+C` copies the result when the copy button is focused.
- **screen reader** selected date announced in full; live fecha límite in a polite live region; countdown chip includes the exact remaining time as text ("vence en 31 horas" / "vencido hace 2 días").
- **a11y** countdown never colour-only (text + icon); 44px cells; unit labels are explicit.
- **used on** S12, S16, S17, S34.
- **UI copy** `[UI copy]` "Fecha límite", "Calcular plazo", "Días hábiles", "Copiar todo", chip text "Vence en 48 hs", "Vencido hace 2 días".

### 17. Status chips
- **variants** connection (Conectada / Sincronizando / Error), document estado set (7 values), prueba states, task states, role colour labels, trial/plan chips, case header chips (Judicial / etapa / sistema).
- **sizes** height 24 (display) but any chip that is clickable is wrapped in a 44px target; `text-xs` weight 500; optional leading dot 8px.
- **states** default, hover, clickable, focus-visible, disabled, loading (synchronising pulse), unknown/other, with tooltip reason.
- **tokens** neutral: bg `bg` text `text-muted`; success: `success-tint`/`success`; warning: `warning-tint`/`warning`; danger: `danger-tint`/`danger`; info: `info-tint`/`info`; accent: `accent-tint`/`accent` — all pairs verified AA.
- **keyboard** static chips are not focusable; clickable chips are `<button>` with visible focus; tooltip content also available on focus (not hover-only).
- **screen reader** chip text is the accessible name; state changes announced when live ("Sincronizando" → "Conectada"); reasons exposed via `aria-describedby`.
- **a11y** colour is always paired with a word; tints clear 4.5:1 with their text (verified); pulse animation respects reduced motion.
- **used on** S10, S12, S16, S25, S27 (+ case header S08).
- **UI copy** `[UI copy]` "Conectada", "Sincronizando", "Con error", "Disponible", "Solo en el portal", "Pendiente de plan", "Vencido".

### 18. File list + preview + upload panel
- **variants** grid / list, breadcrumb, storage meter, protected folders, multi-select bar, upload panel (bottom-right, survives navigation), preview (metadata rail, versions, activity).
- **sizes** grid cell 200, list row 44, storage meter 8 high, upload panel 360, preview rail 280.
- **states** filled, empty folder, protected (padlock + reason), permission denied, read-only, upload progress, per-file failure (+ reason + Reintentar), antivirus pending/clean/blocked, ZIP preparing, undo window (10s), loading, error (+ Reintentar).
- **tokens** meter fill `accent` (warning tint at 80%+, `danger` at 100%), padlock `warning`, failure row `danger-tint`/`danger`, panel `surface` + `shadow-pop`.
- **keyboard** `?` shortcuts, `/` search, `F2` rename, `Del` delete (confirm), `Ctrl+Z` undo, `N` new folder, `U` upload; preview `←`/`→` navigate; focus returns to the row after a preview closes.
- **screen reader** breadcrumb as navigation; storage as text ("112 MB de 512 MB"); upload progress as a live region per file; antivirus state announced; protected folder reason in the accessible name.
- **a11y** dropzone has a keyboard-equivalent button; failures are text with a retry; destructive delete always confirmed.
- **used on** S18, S19.
- **UI copy** `[UI copy]` "Subir archivos", "Nueva carpeta", "Papelera", "Sin permiso para subir archivos", "112 MB de 512 MB", "Preparando el ZIP", "Sin amenazas".

### 19. Step-guide / Tutorial overlay
- **variants** per-screen Tutorial button, guided panel (side on desktop / bottom strip on mobile) with camera highlight on each click, Inicio checklist, help dialog entry.
- **sizes** highlight ring 4px `accent`, panel 360, mobile strip 72, close button 44.
- **states** idle (button), open (guide exists), stepping, no guide for this screen ("Entendido"), close confirm, resume, error hiding first-steps card, mobile variant.
- **tokens** highlight ring `accent`, panel `surface` + `shadow-pop`, step counter `text-muted`, primary action bg `primary`.
- **keyboard** `Esc` triggers the close confirm; arrows move between steps; focus follows the highlighted element; confirm buttons are reachable without a mouse.
- **screen reader** step announced ("Paso 2 de 5: Elegí tus jurisdicciones"); highlighted element described by its label; panel is a `role="dialog"` with the step text.
- **a11y** highlight never traps pointer use outside the guide; reduced-motion removes the pulse; close confirm has explicit verbs.
- **used on** S37, all screens.
- **UI copy** `[UI copy]` "Tutorial", "Cómo hacerlo, paso a paso", "¿Qué es esta pantalla?", "Paso 2 de 5", "¿Cerrás el tutorial?" + "Seguir" / "Cerrar", "Entendido".

---

## Recon-evidenced components (4 — bridge to the brief's 23 recon blocks)

> **TODO(gap):** the recon's components table lists 19 rows; the brief says 23.
> These 4 are evidenced in `recon.md` (navigation model + screens) but not
> tabulated. If the brief meant different components, swap them here.

### 20. Trial / plan card (sidebar bottom)
- **variants** days left / "prueba terminó" / active plan; owner vs team member (read-only).
- **sizes** sidebar-width card, min-height 88, CTA button 44.
- **states** trial running, trial ending (warning), trial ended (read-only notice), plan active (hidden), loading, error.
- **tokens** bg `warning-tint`, text `warning` (countdown) / `text`, CTA bg `primary` text `on-primary`, border `border`.
- **keyboard** card CTA is a link in the tab order; `Enter` opens plans; focus returns on back.
- **screen reader** remaining days as text in the label; state change announced when it flips to ended.
- **a11y** never colour-only countdown (number + word); plan state also in the account menu.
- **used on** S04 (sidebar), S07, S29.
- **UI copy** `[UI copy]` "Prueba gratuita: quedan 12 días", "Tu prueba terminó", "Ver planes", "Activá un plan".

### 21. Account menu (user name, bottom-left)
- **variants** avatar + name + chevron; opens upward; mobile inside Menú.
- **sizes** trigger 44 high, menu 240 wide, item 44.
- **states** closed, open, hover item, focus item, disabled item (permission), loading (sign-out), error (session expired).
- **tokens** trigger `surface`, menu `surface` + `shadow-pop` + `border`, item hover `accent-tint`, destructive item `danger`.
- **keyboard** `Enter`/`Space`/`ArrowUp` opens (focus first item), arrows navigate, `Home`/`End`, `Esc` closes + restores focus, `Tab` closes and moves on.
- **screen reader** trigger exposes `aria-haspopup="menu"` + `aria-expanded`; items are `role="menuitem"`; study switcher announces the current study.
- **a11y** 44px items; sign-out separated and labelled; no hover-only affordances.
- **used on** all screens (S01, S26, S29 entry points).
- **UI copy** `[UI copy]` "Cambiar de estudio", "Tu plan", "Perfil", "Configuraciones", "Cerrar sesión".

### 22. Ambient persistent banners
- **variants** scheduled deletion (countdown + Cancelar / Ver detalles), sync paused (storage), read-only mode; sit above everything including the sidebar.
- **sizes** full width, min-height 44, dismiss only where safe, action buttons 44.
- **states** visible, warning level, error level, dismissed (safe only), loading (details), error (dismiss failed).
- **tokens** bg `warning-tint` text `warning` (warning), `danger-tint`/`danger` (error), `info-tint`/`info` (informational), border-b `border`.
- **keyboard** banner actions are in the tab order before page content; `Esc` dismisses only non-critical banners; focus is not trapped.
- **screen reader** `role="status"` for informational, `role="alert"` for critical; countdown announced as text once, not on every tick.
- **a11y** content shifts down (no overlap); critical banners cannot be dismissed; text + icon + colour.
- **used on** S07, S18, S04 (global).
- **UI copy** `[UI copy]` "Eliminación programada en 6 días" + "Cancelar", "La sincronización está pausada por falta de espacio" + "Ampliar almacenamiento", "Modo solo lectura".

### 23. Permission padlock (gated create actions)
- **variants** inline button (padlock + label), menu-item, block-level (dashboard), tooltip/flyout with the reason.
- **sizes** same as the control it replaces (44 min), lock icon 16.
- **states** locked (no permission), locked (trial/plan), unlocked, hover/focus flyout, loading (plans page), error.
- **tokens** icon `warning`, flyout `surface` + `shadow-pop` + `border`, text `text`, action link `accent`.
- **keyboard** control stays focusable when locked; `Enter` opens the plans/permission screen; flyout shows on focus, dismisses with `Esc`.
- **screen reader** accessible name states the reason ("Nuevo expediente: requiere un plan activo"); lock icon `aria-hidden` when the text carries the meaning.
- **a11y** lock never the only signal (text reason present); contrast verified; disabled controls that must explain themselves are buttons, not `disabled` inputs.
- **used on** S07, S12, S16, S18.
- **UI copy** `[UI copy]` "Requiere un plan activo", "Tu rol no incluye esta acción", "Ver planes".

---

## Module A blocks (own design — no Veredicta reference)

> All Module A elements are assumptions pending the MetaJurídico/Whaticket recon
> (`architecture.md` §WhatsApp). Screen IDs are `A01…`, distinct from S-IDs.

### 24. WhatsApp conversation list
- **variants** list rows (avatar, contact, snippet, time, badges) + filter tabs (Todas / Bot activo / Esperando / Escaladas / Cerradas); desktop panel (sidebar-adjacent, 360) and mobile full-screen.
- **sizes** row min-height 72, avatar 40, snippet `text-sm` one line, unread badge 20 circle, tab bar 44.
- **states** filled, unread (count + `info` dot + bold name), bot-active, waiting-for-human, escalated, window-expired, failed send, empty ("Ninguna conversación todavía"), no-results (with Limpiar filtros), loading (skeleton rows), error (+ Reintentar), read-only.
- **tokens** row `surface`, selected row `accent-tint`, divider `border`, unread badge `info`/`on-accent`, failed send icon `danger`, waiting icon `warning`, snippet `text-muted`, name `text`.
- **keyboard** `↑`/`↓` move the selection, `Enter` opens the thread, `/` focuses a local search, `Esc` clears the filter; selection follows `aria-activedescendant` in a `listbox`.
- **screen reader** each option announces "María López, 3 mensajes sin leer, ventana activa"; filter tabs are `role="tab"` with counts in the label; new inbound message announced politely without stealing focus.
- **a11y** 72px rows (≫44), unread conveyed by count + bold + dot (never colour alone), status always has a word, empty state has a primary action.
- **used on** A01 Bandeja WhatsApp.
- **UI copy** `[UI copy]` tabs "Todas", "Bot activo", "Esperando", "Escaladas", "Cerradas"; empty: "Todavía no hay conversaciones de WhatsApp"; no-results: "No hay conversaciones con estos filtros"; row meta "Ventana activa", "Ventana vencida", "Último mensaje hace 2 h".

### 25. WhatsApp chat thread view
- **variants** two-pane (list + thread) desktop, full-screen thread with back arrow on mobile; message bubbles inbound/outbound/system; composer modes: human reply (in window), template picker (out of window), internal note.
- **sizes** bubble max 72% width, message `text-base` (body floor), composer min 56 with 44px send, timestamp `text-xs`.
- **states** bot-active, human-reply (window open), window-expired (composer locked to templates), waiting (queued), escalated, sending, sent, delivered/read ticks, failed send (+ reason + Reintentar), empty thread, loading older messages, error banner, offline.
- **tokens** inbound bubble `surface` + `border`, outbound `accent-tint`, system messages `text-muted` centered, failed `danger-tint`/`danger`, ticks `success`, window chip per `24h-window countdown chip`, internal note `warning-tint`.
- **keyboard** `Esc` returns to the list, `Enter` sends, `Shift+Enter` newline, `Ctrl/Cmd+↑` edits (human), `PgUp` loads older messages; focus stays in the composer; failed message retry is focusable.
- **screen reader** messages in an ordered list with sender + time; delivery state announced politely ("Entregado", "Leído"); new messages via `aria-live="polite"`; window expiry announced when it flips.
- **a11y** bubbles are text-first (colour secondary), timestamps always visible, 44px send, failed state has text + retry (never icon-only).
- **used on** A01 (thread pane).
- **UI copy** `[UI copy]` composer placeholder "Escribí una respuesta…", system: "Te está respondiendo una persona del estudio", "La ventana de 24 h venció: solo podés enviar mensajes de plantilla aprobada", failed "No se pudo enviar. Reintentar", internal note "Nota interna (no se envía al cliente)".

### 26. Bot/human badge
- **variants** inline pill: `Bot`, `Humano`, `En espera`, `Cerrado`; optional avatar overlay (bot glyph vs member initials).
- **sizes** height 24, `text-xs` weight 500, dot 8; any clickable variant wrapped in a 44px target.
- **states** bot, human (assigned member name), waiting-queue, escalated, closed, loading (assignment resolving), unknown/other, hover/focus (if clickable).
- **tokens** bot: `accent-tint`/`accent`; human: `success-tint`/`success`; waiting: `warning-tint`/`warning`; closed: `bg`/`text-muted`; all pairs verified AA.
- **keyboard** static badge not focusable; clicking the badge (to reassign) is a `button` with `aria-haspopup="menu"`, arrows navigate members, `Esc` closes.
- **screen reader** accessible name includes the state and the assignee ("Atendida por Juan Pérez"); state changes announced politely when the thread is open.
- **a11y** word + colour (never colour alone); 24px visual inside a 44px target when interactive.
- **used on** A01 (list rows + thread header).
- **UI copy** `[UI copy]` "Bot", "Humano", "En espera", "Cerrado", "Atendida por Juan Pérez".

### 27. Quick reply chips
- **variants** bot-suggested chips under the last message (single-choice), multi-select option chips, free-text fallback hint.
- **sizes** chip height 44 (`touch-target`), `text-base`, horizontal scroll row with visible overflow affordance, gap 8.
- **states** default, hover, selected, focus-visible, disabled (answered/timeout), loading (reply in flight), error (retry), empty (no suggestions → free text only), expired (window closed).
- **tokens** bg `surface` + `border-input`, text `text`, hover `accent-tint`, selected bg `accent` text `on-accent`, focus ring `accent`, disabled `bg`/`text-muted`.
- **keyboard** chips are a `radiogroup` (single choice) or `group` of toggles: arrows move, `Enter`/`Space` selects, `Esc` dismisses the row, `Tab` leaves to the composer.
- **screen reader** group label "Opciones"; each chip announces its option and pressed state; selecting one announces "Opción elegida: Turno mañana" and disables the row.
- **a11y** 44px targets, text wraps to two lines max, selection shown by fill + border + `aria-pressed`, never colour alone.
- **used on** A01 (thread pane, bot flows).
- **UI copy** `[UI copy]` example chips: "Sí, es para mí", "Quiero agendar un turno", "Prefiero que me atienda una persona", "Consulta de honorarios", "No, es para otra persona"; hint "También podés escribir tu consulta".

### 28. Handoff banner
- **variants** thread-level banner (bot → human) + queue-level banner on A01; auto-handoff (rule fired) vs manual (agent requested).
- **sizes** full thread width, min-height 44, action buttons 44, `text-base`.
- **states** queued (position), assigned (member name), accepted, declined/reassigned, timeout (nobody picked it up), error (assignment failed), hidden (thread closed), loading.
- **tokens** queued `warning-tint`/`warning`, assigned `success-tint`/`success`, error `danger-tint`/`danger`, border `border`, action link `accent`.
- **keyboard** banner buttons in the natural tab order; `Esc` does not dismiss a critical banner; accept/reassign are `button`s with visible focus.
- **screen reader** `role="status"` (polite) for queue updates, `role="alert"` for failures; queue position announced as text ("1 persona en espera" / "Te toca a vos").
- **a11y** state conveyed by word + colour; acceptance is explicit (no hover-to-accept); SLA/timeout explained in text.
- **used on** A01 (thread pane + list row state).
- **UI copy** `[UI copy]` "Se va a atender una persona del estudio", "En cola: 1 conversación antes que esta", "Te toca atender esta conversación", "Aceptá la conversación", "Nadie la tomó en 10 minutos. Volvió al bot."

### 29. 24h-window countdown chip
- **variants** in the thread header and as a filter badge: active window (countdown), expired window (template-only), reopened (client messaged again).
- **sizes** height 24 (display), `text-xs` weight 500, clock icon 14, wrapped in 44px target when it opens the explanation popover.
- **states** active (>6h left), soon (≤6h → warning), expired (template-only), reopened, loading, unknown (no inbound message yet), error (window timestamp missing).
- **tokens** active `success-tint`/`success`, soon `warning-tint`/`warning`, expired `danger-tint`/`danger`, unknown `bg`/`text-muted` — all pairs verified AA.
- **keyboard** focusable to reveal the popover (`aria-describedby`); `Esc` closes it; not focusable when purely static.
- **screen reader** full text value, not just colour: "Ventana activa: vence en 5 h 20 min" / "Ventana vencida: solo mensajes de plantilla"; updated at most once per minute (polite, throttled).
- **a11y** exact expiry available as text and via the API (`window_expires_at`, `wa-window-watch` job); countdown never animated per-second (reduced motion + no screen-reader spam).
- **used on** A01 (thread header, list rows, filter badge).
- **UI copy** `[UI copy]` "Ventana activa · 5 h 20 min", "Vence en 6 h", "Ventana vencida", "Solo plantillas aprobadas".

### 30. Message template picker
- **variants** modal picker (approved Meta templates by category) + inline picker in the composer when the window is expired; preview pane with variable fields.
- **sizes** modal 720 (list 280 + preview), list rows 44, variable inputs 44, primary button 44.
- **states** loading templates, empty (none approved), template selected, variables missing (validation error), sending, sent, send error (quality/permission reason), window still open (picker optional), read-only (no send permission).
- **tokens** list selected `accent-tint`/`accent`, preview bubble `surface` + `border`, variable placeholder `text-muted`, primary bg `primary` text `on-primary`, error `danger`.
- **keyboard** list is a `listbox`: arrows + `Enter` selects, `Tab` moves to variables, `Esc` closes and returns focus to the composer; `Ctrl/Cmd+Enter` sends.
- **screen reader** template name and category announced; variable fields labelled ("Nombre del cliente"); send result announced before close; empty state explained.
- **a11y** preview is real text (not an image); missing variables block send with a text error; every send shows a status (never silent).
- **used on** A01 (composer, window-expired state).
- **UI copy** `[UI copy]` "Elegir plantilla", "Plantillas aprobadas", "Sin plantillas aprobadas todavía", variables "Nombre del cliente", "Asunto", actions "Vista previa", "Enviar", error "Meta no aprobó esta plantilla. Pedí una nueva plantilla."

---

## Coverage

| Source | Blocks |
| --- | --- |
| recon.md components table (19 rows) | 1–19 |
| recon-evidenced, not tabulated (bridge to the brief's 23) | 20–23 |
| Module A (own design) | 24–30 |
| **Total** | **30** |

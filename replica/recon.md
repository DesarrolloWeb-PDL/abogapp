# Recon map: Veredicta (web)

Scope: the core loop for our own product — Module B: critical cases + procedural deadlines + alerts; Module A: WhatsApp client intake (no Veredicta reference; MetaJurídico/Whaticket recon pending). We study Veredicta as the reference for Module B.
For: small/medium Argentine law firms with low technical resistance.
Date: 2026-11-12
Identification: veredicta.com.ar (app: app.veredicta.com.ar), operated by ZEST LABS LLC (US-registered) but self-described as Argentine; Spanish rioplatense; web-only Next.js SPA, no native app, no public API (MCP only, Pro/Max).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center / manual | https://docs.veredicta.com.ar | 110 pages, .md variants, primary evidence |
| 2 | docs index | https://docs.veredicta.com.ar/llms.txt | one line per manual page |
| 3 | product spec index | https://veredicta.com.ar/llms.txt | 500+ lines: features, portals, pricing, AI/MCP |
| 4 | pricing | https://veredicta.com.ar/pricing.md | Pro 35.999 ARS / Max 89.999 / Max6x 179.999 per member/mo; trial 14 days |
| 5 | changelog | https://veredicta.com.ar/lo-nuevo | weekly releases with video + screenshots |
| 6 | demo video | https://www.youtube.com/watch?v=6CpuSNlY8_8 | 5-min product demo |
| 7 | video channel | https://www.youtube.com/@veredicta_ar | module walkthroughs (screenshots source) |
| 8 | solutions pages | https://veredicta.com.ar/soluciones | expedientes, agenda, IA, finanzas pages |
| 9 | judicial systems list | https://veredicta.com.ar/sistemas-judiciales | portals supported |
| 10 | about | https://veredicta.com.ar/about | company description |
| 11 | terms | https://veredicta.com.ar/legal/terms | §12.2 forbids reverse engineering + scraping: clean-room mandatory |
| 12 | competitor comparison | https://www.arguslegal.ai/argus-vs-veredicta | third-party feature table (interested party) |
| 13 | blog | https://veredicta.com.ar/blog | self-authored SEO guides |
| 14 | instagram | https://www.instagram.com/veredicta.com.ar/ | product clips |
| 15 | API docs | — | none public (MCP only, per-account) |
| 16 | app stores | — | none (docs: "Veredicta no tiene una app") |
| 17 | review sites | — | no G2/Capterra/Trustpilot found |

## Core loop

One sentence: connect a judicial portal once and the firm's cases, court publications and deadlines land in one place, with an AI assistant that answers about them with citations.

## Navigation model

**App shell** — "Todas las pantallas de Veredicta comparten la misma base: el menú a la izquierda y el contenido a la derecha, sin un encabezado arriba." Collapsible sidebar (`Cmd/Ctrl+B`), content area to the right. Evidence: `docs.veredicta.com.ar/primeros-pasos/moverte-por-veredicta`.

**Sidebar order (top → bottom)** — evidence: `primeros-pasos/moverte-por-veredicta` (nav table), `sistemas-judiciales/novedades-judiciales` (Novedades sits "debajo de **Inicio**"):

| Group | Items | Routes (as printed in docs) |
|---|---|---|
| Top | Logo **Veredicta** (→ Inicio) + **Notificaciones** bell | — |
| Main | **Inicio**, **Expedientes**, **Vista general**, **Tareas**, **Agenda**, **Documentos** | `/home`, `/expedientes`, `/expedientes/vista-general`, `/tareas`, `/agenda`, `/documentos` |
| Main (below Inicio) | **Novedades judiciales** (with unread count) | `/novedades-judiciales` |
| **Finanzas** (requires permission *Ver movimientos*) | Resumen, Movimientos, Recurrentes, Categorías | `/finanzas`, `/finanzas/movimientos`, `/finanzas/recurrentes`, `/finanzas/categorias` |
| **Inteligencia artificial** | Asistente, Análisis de documentos | `/asistente`, `/ai-review` |
| **Biblioteca** | Jurisprudencia, Modelos de escritos, Herramientas | `/jurisprudence`, `/document-template`, `/tools` |
| **Configuraciones** (collapsed by default) | Perfil de usuario, Integraciones, Estudio jurídico, Actividad (perm. *Ver la actividad*), Facturación, Personas, Etapas, Días inhábiles | `/settings/profile/general`, `/settings/profile/integrations`, `/settings/workspace/general`, `/settings/actividad`, `/settings/billing`, `/settings/personas`, `/settings/expedientes/etapas`, `/settings/dias-inhabiles` |
| Bottom | Trial card ("Prueba gratuita" / "Tu prueba terminó"), **Lo nuevo de Veredicta**, **Ayuda y sugerencias**, user name → account menu | — |

**Account menu** (user name, bottom-left): Cambiar de estudio (max 5 studies), Tu plan, Perfil de usuario, Estudio jurídico, Facturación, Cerrar sesión. Evidence: `moverte-por-veredicta`.

**Per-screen chrome**: each screen has a **Tutorial** button top-right ("Cómo hacerlo, paso a paso" / "¿Qué es esta pantalla?"); the lifebuoy opens "¿En qué te podemos ayudar?" (Manual de uso, Pedir una mejora, Pedir ayuda). Evidence: `moverte-por-veredicta`.

**Assistant entry**: edge-tab on the right border or `Cmd/Ctrl+J` opens a side panel **only ≥1024 px**; full screen at `/asistente`; on mobile it only opens full screen. Evidence: `moverte-por-veredicta`, `asistente/conoce-el-asistente`, `primeros-pasos/veredicta-en-el-celular`.

**Search**: "No hay un buscador general." Each screen has its own searcher (Expedientes, Jurisprudencia, Notificaciones, Agenda, Documentos…). No account-wide shortcut. Evidence: `moverte-por-veredicta`.

**Mobile (<768 px)**: bottom bar with **Inicio, Expedientes, Asistente, Avisos, Menú**; the "Menú" screen holds everything else; bell replaced by **Avisos**; `Actualizar`/`Tutorial` collapse into a "⋯" button on Inicio. No native app (browser + add-to-homescreen). Evidence: `primeros-pasos/veredicta-en-el-celular`.

**Login → case path**: `/auth/login` ("Ingresar") → `/home` (Inicio) → sidebar **Expedientes** (`/expedientes`) → click a row → case detail (`/expedientes…` with `?tab=` per tab; docs state the address includes `?tab=` but never print the values — treat values as unknown). Evidence: `cuenta/iniciar-sesion` (index line), `primeros-pasos/crear-tu-cuenta` (links `app.veredicta.com.ar/auth/login`, `/auth/sign-up`), `expedientes/detalle`.

**Ambient overlays**: two banners can sit above everything incl. the sidebar — "Eliminación programada" (N days + Cancelar/Ver detalles) and "Sincronización en pausa" (out of storage). Also a gate modal when 2+ studies have no active study: "¿Con qué estudio querés trabajar?". Evidence: `moverte-por-veredicta`.

## Screens

| ID | Screen | Route / entry | Purpose | Key components | States seen |
|---|---|---|---|---|---|
| S01 | **Ingresar (login)** | `app.veredicta.com.ar/auth/login` — public landing; link "Crear una cuenta" below the form | Sign in with email/password, Google, passkey | Form, "Iniciar sesión" button, sign-up link, ?-help top-right | filled → error. Errors documented only on the sign-up side ("Hiciste demasiados intentos…", "No pudimos conectarnos con el servidor…"). States: thin evidence for the login form itself |
| S02 | **Crear una cuenta (sign-up)** | `app.veredicta.com.ar/auth/sign-up` — from S01 link | Create personal account (no card required) | Fields: Nombre completo, Correo, Contraseña (+strength meter), "Registrarse con Google", "Continuar", Términos/Privacidad links | loading ("Creando cuenta..."); errors: "Ya existe una cuenta con ese correo…", "Tu contraseña debe tener al menos 8 caracteres", "Ingresa un correo electrónico válido", rate-limit message, network error. Verified: no confirmation email sent |
| S03 | **Configuración inicial (5-step wizard)** | opens automatically after sign-up ("Empezar"); not re-openable from menu | 1 Elegí tus jurisdicciones → 2 Veredicta procura por vos → 3 Configurá tu perfil → 4 Tu información está segura → 5 Los datos de tu estudio → "Crear estudio" → Inicio | Step screens, jurisdiction search, Continuar/Atrás, "Saltar paso y hacerlo más tarde", logo/photo upload | resume-where-you-left-off after closing; skip steps; skipped last step → auto-name "Estudio de {nombre}"; invitee path shows "¡Bienvenido a {estudio}" + "Acceder a Veredicta" instead; errors: "No pudimos preparar tu estudio…", "Faltó guardar algo…", "No pudimos terminar de crear tu estudio…", "Creando tu estudio" → "Tu estudio está listo" |
| S04 | **Inicio (dashboard)** | `/home`; logo or sidebar **Inicio** | Personal control panel: what courts published + what's due today | Block grid (20 possible blocks, 9 by default), **Personalizar** mode (drag handles, resize corner, remove cross, "Agregar bloque" gallery), "Tutorial: primeros pasos" checklist card (ring 0/5, locked steps, Opcional group), **Actualizar**, quick actions | **3 evidenced states**: no active plan (read-only notice + plans for owner, or read-only screen for team) · first time w/o cases (welcome "Te damos la bienvenida", tutorial card, quick actions: connect system, create case, search jurisprudence, open model) · filled panel. Plus: Personalizar mode; save dialog "¿Para quién guardás estos cambios?" (Solo para mí / Para todo el estudio); permission-denied block "Tu rol no incluye este bloque"; discard-confirm "¿Descartar los cambios?"; mobile/narrow: blocks stack, **Personalizar does not appear**; trial card states (days left / "Tu prueba terminó") |
| S05 | **Novedades judiciales (list)** | `/novedades-judiciales`, sidebar below Inicio; also Inicio block "Ver todas" | One list of every new court publication across all cases/systems | Two views: **Por expediente** (default, one row per case) / **Por novedad** (Fecha, Responsable, Tipo, Archivos), search, Sistema/Período/Estado filters + filter button (Archivos, Responsable, Expediente), **Revisar** button, multi-select bar, row ⋯ menu, unread count badge in sidebar | filled; unread = bold + blue dot; empty "Sin novedades"; no-results "Sin resultados" + Limpiar filtros; no-connection "Conectá un sistema judicial" + Conectar; narrow window: extra filters collapse into filter button; states: loading not documented (thin) |
| S06 | **Novedades reader** | click a row in S05, or **Revisar** | Read the court document with the Assistant beside it | Document pane (left) + Asistente panel (right); header (case + novedad text, doc controls, "Documento 1 de 4" for multi-file); shortcuts **Crear tarea / Crear evento / Agregar nota** + ⋯; **Anterior/Siguiente**, `J`/`K`; progress ring; **Plegar el panel**; X to close | filled; read state (row leaves bold); **Archivos column states**: "N archivo(s)", "Sincronizando", "Por sincronizar", "Pendiente de plan", "Sin espacio", "Solo en el portal", "Con error"; narrow/mobile: no side panel → controls bar below document; folded-panel state persists per device |
| S07 | **Expedientes (list)** | `/expedientes` sidebar | All studio cases (manual + synced), shared by all members | Search ("Buscar por carátula, número o juzgado…", typo/tolerance), Filtros panel (Favoritos, Tipo, Fuero, Etapa procesal, Responsable, Jurisdicción, Sistema de sincronización, Archivados) with active-count badge, star favorites (studio-wide), sortable/resizable/reorderable columns, row ⋯ + right-click menu (Ver detalle, Abrir en nueva pestaña, Editar, Agregar tarea, Agregar vencimiento, Favoritos, Descargar, Imprimir, Archivar, Preguntar al Asistente IA, Eliminar, Pausar/Activar sincronización), bulk bar (Archivar/Desarchivar/Eliminar), footer "Mostrando 2 de 2 expedientes" | filled; ordered by Última actividad; **empty/error**: "No encontramos expedientes" + Limpiar filtros; **read-only mode**: banner "Modo solo lectura", **Nuevo expediente** shows padlock → opens plans; narrow screens: Responsable filter + star move into Filtros; **mobile**: no multi-select, no Responsable column, no favorite-star shortcut; loading: docs only say 50-per-page progressive loading (no skeleton documented) |
| S08 | **Expediente detail** | click row in S07 (or carátula in S15) | Case hub with header + tabs | Header: carátula, tipo, etapa, ☆, **Preguntar al Asistente IA**, **Editar**, ⋯ (Archivar/Desarchivar, Pausar/Activar sincronización PJN/MEV, Eliminar), back arrow "Volver a expedientes" (restores list filters). Tabs: Resumen, Movimientos, Actuaciones*, Tareas, Pruebas, Audiencias, Agenda, Partes, Documentos, Finanzas (*only if synced). Resumen cards: Información del Expediente, Tareas Pendientes (max 5 + Agregar Tarea + Ver todas), Último Movimiento, Notas Internas ("Escribe una nota…" + Enter) | filled; tab-filter memory per case; `?tab=` deep-link (values unknown); Actuaciones tab absent for manual cases; read-only banners inherited; open-in-new-tab on any tab; states: thin evidence for per-tab error states |
| S09 | **Expediente > Movimientos** | S08 tab **Movimientos** | The study's hand-entered movement history (distinct from portal's Actuaciones); pin most important, filter by type/date range | list + filter by tipo/rango de fechas, "fijar el más importante" | states: thin evidence — page `expedientes/movimientos` not fetched (index line only) |
| S10 | **Expediente > Actuaciones (list)** | S08 tab **Actuaciones** (synced cases only) | All court publications for the case | Columns Fecha, Detalle, Tipo, Fojas, Estado (portal-specific names for EJE/IOL/MEV), date calendar filter (day/range/period "Este año"), search, **Leer** button, row ⋯/right-click (Abrir documento, Descargar, Ver en el portal oficial, Preguntar al Asistente IA), footer count | filled; **Estado values**: Disponible, Por sincronizar, Sincronizando, Solo en el portal, Con error, Pendiente de plan, Sin espacio; empty "Sin actuaciones"; no-results "Sin resultados" + Limpiar; mobile: Fecha inside **Filtros** |
| S11 | **Actuación reader** | click row / **Leer** in S10; also reached from S05, notifications, Vista general | Read one actuation in-app with the Assistant | Document left + Asistente right; header with page controls, zoom, **Descargar archivo**; shortcuts **Crear tarea / Crear evento / Agregar nota** + ⋯ (Descargar, Ver en el portal oficial); **Anterior/Siguiente** (`J`/`K`/arrows); text-selection toolbar (**Preguntar**, **Copiar cita** + page for PDFs); clickable citations jump to page; **Plegar**; X closes → returns to list with last-read row highlighted; per-actuation conversation persistence | filled; no-document actuation ("El sistema judicial no publicó un documento para esta actuación."); gated doc ("Guardá los archivos con un plan" → Ver en el portal / Ver planes); "Sin espacio de almacenamiento" + Ampliar almacenamiento; AI-not-readable error ("La actuación no tiene texto ni documento todavía."); narrow/mobile: no side panel → bar below doc, only **Copiar cita** on selection; suggestion chips change when the act is a sentencia |
| S12 | **Expediente > Pruebas** | S08 tab **Pruebas** | Track evidence by type, with auto-computed deadlines | 6 sections (Documental, Informativa, Confesional, Testimonial, Pericial, Otras) with counts; **Agregar Prueba** dialog (type → Continuar); type-specific form (Título, Informante/persona picker with "Crear nueva persona", Parte, Estado, Fecha efectiva, **Plazo (opcional)**: Horas / Días corridos / Días hábiles → live **Fecha limite**), **Completar con IA** button; Historial de Estados; per-row ⋯ (Cambiar estado, Agregar documentos, Google Calendar event); search + multi-select bulk bar (Cambiar estado/responsable/Eliminar) | filled; deadline color states green → amber (≤48 h) → red ("Vencido hace 2 días"); per-type status sets (e.g. Informativa: Ofrecida/Proveída/Diligenciado/Reiterado/Contestado/Producida/Desistida); validation error "Selecciona un informante"; no-results "Sin resultados"; upload sub-states (queued, failed row with reason + Ver detalle + Reintentar, "Revisá antes de subir", undo toasts); read-only: needs plan/trial |
| S13 | **Expediente > Audiencias** | S08 tab **Audiencias** | Hearings + people summoned (citados), notification status, copy citation for client; hearings created online or in person | list + creation dialog; from Prueba Confesional/Testimonial/Pericial the flow branches "Agregar Absolvente/Testigo/Perito" or "crear la audiencia" | states: thin evidence — `expedientes/audiencias` not fetched (index + cross-references only) |
| S14 | **Expediente > Partes** | S08 tab **Partes** | Parties from the studio directory: parte representada, contraparte, otros intervinientes + their lawyers | party picker from Personas directory | states: thin evidence — `expedientes/partes` not fetched (index only) |
| S15 | **Vista general** | `/expedientes/vista-general` | Read-only cross-case matrix: pruebas, novedades, movimientos, tareas, finanzas | Same search/filters as S07 (shared), own **Columnas** panel (5 column groups), expand/collapse rows, sortable columns, carátula click → S08 | filled; read-only by design ("Es de solo lectura"); shares filters with S07; at least one column must stay visible; states: thin evidence for empty (no dedicated empty message documented) |
| S16 | **Tareas (board/list) + task view** | `/tareas`; `C` or **Nueva tarea**; expediente tab **Tareas** = same screen scoped | Studio-wide work board | **Configuración de vista**: Lista/Tablero (`B`/`L`), Agrupar columnas por Estado/Responsable/Prioridad/Expediente, Agrupar filas por (Responsable rows), Ordenar por, Personalizar columns, Mostrar tareas terminadas (Todas/último día/semana/mes/Ninguna), visible fields; search (`/`) + filters (Estado, Responsable, Expediente, Vencimiento, Prioridad, Creada por [incl. "El Procurador IA"], Favoritas); drag card between columns; manual ordering; task opens **over the board** (Propiedades right, Actividad/comments below, attachments ≤25 MB, favorite star, "Abrir como página"); **Nueva tarea** dialog (Del estudio ↔ case picker, título 255 chars, descripción, Estado, Prioridad Alta/Normal/Baja/Sin prioridad, Responsable, Vence, "Crear otra"); bulk bar (Estado/Responsable/Prioridad/Vencimiento/Eliminar) | filled board; default states Pendiente/En curso/Para revisar/Completada/Cancelada (customizable, each = column); Cancelled collapsed into narrow right column; overdue date in red; **empty**: no tasks → "video «Cómo funciona» + Nueva tarea"; **read-only**: Nueva tarea padlock → plans; overlay vs full-page view; toasts "Tarea creada"; states: loading not documented (thin) |
| S17 | **Agenda** | `/agenda`; expediente tab **Agenda** = scoped version (opens in Lista) | Shared studio calendar | Top bar: **Hoy** (`H`), ‹ ›, period title (+ "Semana 43" label), **Expediente** filter, view selector **Día/Semana/Mes/Año/Lista** (`D/S/M/A/L`), toggles Fines de semana / Días inhábiles, shortcuts, **Nuevo evento** (`C`); left panel: search (`Ctrl+K`), mini-month calendar with color dots + hatched inhábiles, category checkboxes (6 default categories, 11 colors) + Audiencias/Vencimientos/Fines de semana, Google Calendar status, **Administrar categorías** modal; event detail popover (category tag, time, location + Abrir en el mapa, expediente link, notes, Editar/Cambiar color/Duplicar/Eliminar, read-only for audiencias/vencimientos/días inhábiles with "Ver audiencia/Ver vencimiento/Ver la fuente oficial", ⋯: Copiar enlace, Abrir en Google Calendar, Ver el expediente, Preguntar al Asistente IA) | 5 views documented incl. Day free-slot drag-create "Libre de… · arrastrá para crear", Week red now-line + "Inhábil" labels, Month "+N más" overflow, Year heat dots, Lista "Próximos 30 días" with labels Vence hoy/Vencido/Se superpone; **empty**: "No hay eventos con estos filtros" + active-filter chips + Limpiar filtros + "Ir al próximo"; **error**: "No pudimos cargar la agenda" + Reintentar; narrow: left panel hidden behind icon; **mobile**: Lista or Día only (no Año), swipe weeks; loading: previous period stays visible with a thin top bar while next loads |
| S18 | **Documentos (gestor)** | `/documentos` → Todos los documentos / Recientes / Destacados / Papelera; expediente tab **Documentos** = same folder | Cloud files: one folder per case + studio folders | Breadcrumb path, storage meter ("112 MB de 512 MB" + ⓘ breakdown), search (full-text incl. scans), filters Tipo/Expediente/Subido por/Modificado + filter-count button, grid/list toggle, per-file ⋯/right-click (Vista previa, Descargar, Copiar, Destacar, Renombrar, Mover, Papelera), multi-select + bottom action bar (Descargar, Mover, Copiar, Destacar, Papelera), drag-to-move with "Moviste…" + Deshacer, upload menu (Subir archivos, Subir una carpeta, Nueva carpeta, Nuevo escrito), ZIP download, keyboard map (`?`, `/`, F2, Del, Ctrl+Z, N, U) | filled; **protected folders** with padlock + reason ("Documentos del sistema judicial", "Pruebas", "Adjuntos del Asistente"); **permission denied**: Subir padlock "No tenés permiso para subir archivos"; read-only: "Tu estudio está en modo lectura"; upload progress panel (per-file failure reason, Cancelar todo, undo 10 s); antivirus status "Sin amenazas" / virus blocked; empty-folder state: thin evidence |
| S19 | **File preview / visor** | click a file in S18 (or ⋯ → Vista previa) | View files without downloading | Document pane, side metadata panel (expediente, who uploaded, when, size), `←`/`→` previous/next document, version list, activity ("quién hizo qué") | filled; read-only viewer for old documents; uploaded Word opens in a separate browser tab (not the editor); version states (versions list, Restaurar); states: thin evidence for error |
| S20 | **Editor de escritos (collaborative)** | S18 arrow next to Subir → **Nuevo escrito**; or use a model; or a Veredicta escrito → "Abrir en el editor" | Native Word-like collaborative editor | Menus **Archivo** (Descargar Word/PDF, Imprimir, Hacer una copia, Renombrar, Mover, Mover a la papelera), **Formato**, **Insertar** (imagen, tabla, enlace, saltos, índice), **Revisión** (Aceptar/Rechazar todos los cambios), **Ayuda**; save-status indicator top-right; mode selector **Edición / Sugerencias / Lectura**; **Asistente** button top-right; comment threads (comentar, responder, resolver) | saving states: **Guardado** ("Todos los cambios se guardaron recién"), **Sin conexión** (changes saved on reconnect), **Guardado local** (cloud save unavailable → download copy), **Todavía estamos guardando** (exit blocked); multi-user simultaneous editing (auto-merge) — presence/avatars not documented; read-only for old documents; padlock if no plan/trial for Subir/Nuevo escrito; AI-change highlight states ("N cambios del Asistente", Deshacer este cambio, "Listo, ya los vi"); error "No se pudo guardar" when role lacks document permissions |
| S21 | **Notificaciones (panel + page)** | bell top-left next to logo → panel; "Ver todas las notificaciones" → `/notifications`; mobile **Avisos** | Personal notification inbox | Bell badge (0–9, "9+"); panel tabs **Todas / No leídas**, **Marcar todas como leídas**, **Preferencias**; page: search, **Todos los estados**, **Todas las categorías** (Sistemas judiciales, Tareas, Causas, Equipo, Facturación, Novedades y consejos), Limpiar, **Cargar más** (20 at a time) | unread = blue dot; click = mark read + deep link (actuations/tasks → case; audiencia/vencimiento → Expedientes; tips → section; billing/team → no navigation); filters remembered per browser; empty/no-results states: thin evidence (not explicitly documented) |
| S22 | **Asistente (full screen)** | `/asistente`; sidebar IA > Asistente; also Herramientas card "Asistente IA" | Main AI chat | Conversation list (left), input box, **4 suggested queries** on empty state, skills via `/` or wand button (groups: Consultas ~20 skills incl. Jurisprudencia SAIJ/JUBA, Redacción 4, Cómo se hace 10), `+` context picker ("Un expediente", documents, local files), mic (**Dictar por voz**), effort selector **Bajo/Medio/Alto** + "?" explanation, live step log ("Pensé por…" → Actividad del asistente), **Detener la respuesta**, citations under answers (click → open doc at page), hover actions Copiar/Leer en voz alta/Regenerar, message hover: Editar mensaje / Bifurcar desde este mensaje, "La IA puede cometer errores…" disclaimer | empty (welcome demo "Te presento a tu asistente legal" + **Probar**); working (step list); gating errors: "Llegaste al límite de uso de IA por ahora", "Usaste las consultas de tu prueba gratis", "Tu plan no incluye IA"; read-only study → opens plan-improvement window; mobile: bottom bar hides inside a conversation, back arrow → start, **Historial** top-right |
| S23 | **Asistente (side panel)** | right-edge tab or `Cmd/Ctrl+J`, **≥1024 px only** | Assistant beside any screen | 400 px panel, draggable left border (double-click resets), expand button → S22; context-aware entry points: **Preguntar al Asistente IA** (case header), reading views (S06/S11), **Completar con IA** (forms), editor **Asistente** button | absent below 1024 px and on mobile (full screen instead); restores previous conversation when a reader closes; states: same gating as S22 (thin evidence for panel-specific errors) |
| S24 | **Asistente draft split view (Redactar escritos)** | S22/S23 → skill group **Redacción** (Carta documento, Borrador de demanda, Contestación de demanda, Oficio judicial) | Draft a legal writing side-by-side with chat | Draft card above input ("Borrador de esta conversación · versión N", states **Borrador / Abierto / En Documentos**, "Ver los otros N borradores", × to hide); split view: editor left (same editor as S20) + chat right, **Ocultar el chat**, draggable divider; change highlights (violet = new, "Se sacó un párrafo"), version history + **Restaurar**, save dialog **Guardar en Documentos** (case folder / studio documents / **Cambiar** → any case or folder), **Descargar Word** | working ("Trabajando en el borrador...", "Redactando el escrito"); "Borrador actualizado" + **Deshacer**; saved → "Guardado en el expediente" + "Abrir en Documentos" + linked-doc icon; save error "No se pudo guardar" (role without document permission) with Descargar Word fallback; post-save AI edits require confirmation ("Hice N cambios en…"); uploaded Word → parallel "(versión 2)" leaving original untouched |
| S25 | **Configuraciones > Integraciones (+ system page & connect form)** | sidebar Configuraciones > Integraciones; also Inicio → Primeros pasos → Conectar; empty-state button "Conectar un sistema judicial" in Inicio/Expedientes/Vista general | Connect/manage judicial portals | Integrations catalogue (PJN, EJE, IOL, SED, PCJ, MEV); system page `…/integrations/{pjn\|eje\|iol\|iol-salta\|iol-catamarca}`: status chip, **Conectar mi cuenta**, connect form (CUIT/CUIL + Contraseña → **Verificar y conectar**), progress ("Cuenta conectada" → **Listo**), **Expedientes** count box, **Expedientes sincronizados** table with per-case Sincronización column, **Expedientes eliminados** + "Volver a sincronizar", Cambiar estudio destino, **Desconectar**, admin actions (Administrar una conexión) | states: **Conectada**, **Sincronizando**, **Error**/"Tus expedientes están al día"; background continue "Cerrar y continuar en segundo plano"; long first sync "avanza en tandas"; **errors** (documented list): "Escribí tu CUIT o CUIL, no tu correo", "Un CUIT o CUIL tiene 11 números", "El portal no aceptó ese usuario o esa contraseña" (+ Corregir contraseña / Recuperar contraseña / WhatsApp), "El portal te pide un paso antes de entrar", "No se pudo guardar la conexión", "Hay una sincronización en curso", "El portal no dio una respuesta" (5 attempts then stop), "No pudimos verificar tus credenciales", "El sistema oficial nos limitó el acceso" (auto-retry 2 min–6 h), "El sistema oficial tardó demasiado", "Primera sincronización en pausa"; read-only after trial → documents "Pendiente de plan"; MEV variant = email-forwarding setup (6 steps, no credentials) |
| S26 | **Configuraciones > Perfil de usuario / Seguridad** | `/settings/profile/general`, account menu > Perfil de usuario | Name, photo, password; 2FA, backup codes, passkeys; also `/settings/ai-usage` (Uso de IA) | profile tabs, security toggles, AI usage panel ("Consultas incluidas en tu prueba: 5") | states: thin evidence — `cuenta/tu-perfil`, `cuenta/seguridad` not fetched (index lines only) |
| S27 | **Configuraciones > Estudio jurídico > Roles y permisos** | `/settings/workspace/roles` (tabs General, Miembros, Roles y permisos) | Define what each role can do | Role cards (name + color label, description, area icons colored/grey, members count, "9 de 28 permisos"), filters **Buscar rol…**, **Puede usar** (area), **Miembros** (Con/Sin miembros), **Nuevo rol**, **Comparar roles** modal (permission rows × role columns, tilde/dash) | filled; default roles Dueño (fixed, all permissions, undeletable) / Administrador / Miembro; example roles Procurador, Socio, Pasante; permission model: 9 areas, 28 permissions, dependency locks ("candado until you enable the required one"), Sensitive areas (Finanzas, Equipo, Facturación); **permission-denied behaviors**: areas absent from the sidebar, Inicio block "Tu rol no incluye este bloque", Finanzas hidden without *Ver movimientos*, Actividad hidden without *Ver la actividad*; limits: 50 roles/studio; changes apply on next page load |
| S28 | **Miembros / invitaciones** | `/settings/workspace` tabs + email invite link | Invite teammates (role + plan per invite, license cost preview), accept invitation, change roles/plans, remove members | members table, invitation status | states: thin evidence — `estudio/miembros`, `estudio/invitar-a-tu-equipo`, `estudio/aceptar-una-invitacion` not fetched (index lines only); invitee landing "¡Bienvenido a {estudio}" + **Acceder a Veredicta** evidenced in `configurar-tu-estudio` |
| S29 | **Facturación / Planes** | `/settings/billing` (also account menu > Facturación; "Ver planes" from trial card; locked create-buttons) | Plan comparison, activation, card, receipts, cancel/resume, AI limits | plan cards Pro/Max (ARS/USD, monthly/annual), payment form, receipts list, next-charge, AI usage meter | trial → read-only → active plan ("Al activar un plan, todo vuelve a funcionar en el momento"); notifications Prueba por vencer / Acceso finalizado / Error de pago etc. (owner-only); read-only screens for non-owners; states: thin evidence — pages not fetched (index lines only) |
| S30 | **Configuraciones: Personas, Etapas, Días inhábiles, Actividad** | `/settings/personas`, `/settings/expedientes/etapas`, `/settings/dias-inhabiles`, `/settings/actividad` | Studio directories & setup: people, case stages (which count as active on Inicio), custom non-working days (added to feriados + feria when computing deadlines), audit activity log with before/after values + Excel export | tables + creation forms; Días inhábiles rows show **Origen**: Del sistema / De tu estudio | states: thin evidence — pages not fetched (index lines only; Días inhábiles evidenced also in `agenda/plazos-procesales` and `agenda/usar-la-agenda`) |
| S31 | **Finanzas > Resumen** | `/finanzas` (sidebar, requires *Ver movimientos*); Inicio block Cobranza → "Ir a finanzas" | Money in/out dashboard | **Período**, **Incluye**, **Moneda** filters; 4 KPI cards (Ingresos, Egresos, Resultado neto, Promedio mensual 12 m) + 12-month bar chart; **Por cobrar** aging (0-30/31-60/61-90/+90) + Ver todos; Gastos por categoría, Rentabilidad por expediente, Próximos vencimientos; **Personalizar tablero** (same engine as Inicio: Agregar widget library in 4 categories / Restablecer / Cancelar / Guardar + scope dialog) | filled; pending/Vencido movements excluded from KPIs; multi-currency ≈ approximations (BCRA/BNA rates + ⓘ); "Para revisar" AI receipts not counted until confirmed; **permission denied**: Finanzas not in menu; read-only mode applies; empty/no-data state: thin evidence |
| S32 | **Finanzas > Movimientos / Recurrentes / Categorías / comprobantes IA / export** | sidebar under Finanzas | Load income/expenses, recurring entries, categories with monthly budgets, AI receipt reading, CSV/Excel export | forms, activity feed per movement | states: thin evidence — pages not fetched (index lines only) |
| S33 | **Biblioteca > Modelos de escritos** | `/document-template`; empty Inicio → "Explorá la plataforma" | 750+ ready legal templates | search (title/content/tag with highlight), filters Materia/Origen/Tipo/Etiquetas (+counts), star favorites (per account), list count header, row ⋯ (Usar en un expediente, Descargar Word, Descargar Markdown, Copiar el texto, Ver modelo), detail view (full preview + Crear documento en expediente / Descargar / Copiar / favorite) | filled; no-results "No encontramos modelos" + Limpiar filtros; load error "No pudimos cargar los modelos" + Reintentar; small screens: filters collapse into filter button; requires plan/trial |
| S34 | **Biblioteca > Herramientas (+ tool screens)** | `/tools`; each tool opens its own screen with breadcrumb back; deadline calc = `/tool/deadline-calculator` | 23 free legal tools (+ 2 AI cards on top) | category selector (Novedades/Más usadas/Favoritos/Todas), search, card/list toggle, star favorites (per browser), "Usar herramienta"; tool screens: Calculadora de plazos procesales (Fecha de notificación, Tipo de plazo, Cantidad, **Calcular plazo**, result + Copiar todo) | filled; empty: "No encontramos herramientas" / "Todavía no tenés favoritos"; PDF/text tools run locally in browser; tools free on every plan incl. trial |
| S35 | **Biblioteca > Jurisprudencia** | `/jurisprudence` | Full-text jurisprudence search with AI-generated sumarios | filters (tribunal, jurisdicción, materia, provincia) — always visible on desktop, behind a **Filtros** button on mobile | states: thin evidence — `biblioteca/jurisprudence` not fetched (claims from `veredicta.com.ar` home + `veredicta-en-el-celular`) |
| S36 | **Análisis de documentos (AI review)** | `/ai-review` (sidebar IA) | Mass document review: question grid with typed answers + verifiable citations | analysis list, column builder (AI suggestions, answer types), templates, answer review beside document (highlighted passage, confidence, correction), CSV export, pause/reprocess | states: thin evidence — all 5 `analisis-de-documentos/*` pages not fetched (index lines only); excluded from trial ("Análisis de documentos" not in trial includes) |
| S37 | **Ayuda dialog + in-context guides** | lifebuoy "Ayuda y sugerencias" (bottom-left) → "¿En qué te podemos ayudar?"; every screen's **?** → Tutorial; Primeros-pasos panel highlights | Help entry + step-by-step overlays | dialog with Manual de uso / Pedir una mejora / Pedir ayuda; per-screen Tutorial ("Cómo hacerlo, paso a paso" / "¿Qué es esta pantalla?"); guided-tutorial side panel that marks each click with a camera highlight (bottom strip on mobile); close confirm "¿Cerrás el tutorial?" (Seguir/Cerrar) | open/closed; error "No pudimos ocultar los primeros pasos" (Primeros pasos card ⋯ → Ocultar) |
| S38 | **Mobile shell** | `<768 px` any route | Mobile adaptation of every screen | bottom bar (Inicio, Expedientes, Asistente, Avisos, Menú), hamburger menu top-left on some screens, add-to-homescreen instructions | documented deltas: no sidebar, bell → Avisos, Assistant full-screen only, no multi-select in Expedientes, no Responsable column/star filter, no Agenda **Año** view, Jurisprudencia filters behind button, Inicio actions in "⋯", no iOS push (email digest only); Inicio blocks stack and **Personalizar** disappears |

## Flows

> Click counts are happy-path estimates from the documented steps; they become the number to beat. Counts exclude typing/clicks inside form fields.

```
F01 Lawyer connects a judicial portal and imports cases            [~7 clicks]
    S04 Inicio -> S25 Configuraciones (1) -> Integraciones (2) -> PJN (3)
        -> Conectar mi cuenta (4) -> CUIT/CUIL + clave -> Verificar y conectar (5)
        -> "Cuenta conectada" -> Listo (6) -> S07 Expedientes (7)
    alt entry: S04 -> Primeros pasos card "Conectá tu sistema judicial"
        -> "Cómo funciona" -> "Empezar la guia" -> portal picker (~5 clicks)
    backend: first sync pulls full history "en tandas"; re-checks every ~30 min
        (IOL: ~30 min near midnight on business days, every 4 h otherwise);
        no manual refresh button; notices 08:00-20:55 to all members
    edge: portal rejects password (do NOT retry blindly; 5 attempts then stop),
        portal demands an on-site step first, rate-limiting (auto-retry 2 min-6 h),
        "No se pudo guardar la conexion", sync-in-progress, first sync paused,
        MEV instead = 6-step email-forwarding setup (no credentials),
        read-only after trial -> docs go "Pendiente de plan" (14-day grace),
        one case instance per studio, trial = unlimited cases (docs contradict
        a "50-case trial limit": 50 is the LIST PAGE SIZE)
```

```
F02 Lawyer opens a case and reads its movements/actuaciones        [~5 clicks]
    S07 Expedientes (1) -> click row (2) -> S08 detail (Resumen)
        -> tab Actuaciones (3) -> click row or "Leer" (4) -> S11 reader
        -> click suggestion e.g. "Corre algun plazo para mi?" (5)
    edge: Actuaciones tab only exists for synced cases (Movimientos = manual log),
        doc states (Pendiente de plan / Sin espacio / Con error / Solo en el portal),
        actuation without document, no side panel <1024 px (controls bar below doc),
        AI only consumes quota when you ask - opening is free,
        "La IA puede cometer errores" - verify plazos in the calculator
```

```
F03 Lawyer sets a procedural deadline (plazo) with feriados/feria  [~6 clicks]
    S07 (1) -> row (2) -> S08 tab Pruebas (3) -> Agregar Prueba (4)
        -> pick type -> Continuar (5) -> form: Titulo, Informante, Estado,
        Fecha efectiva -> Plazo (opcional): Dias habilos + cantidad
        -> live "Fecha limite" -> Crear Prueba (6)
    alt standalone: S34 Herramientas (1) -> Calculadora de plazos procesales (2)
        -> Calcular plazo (3)
    rules: dias habilos skip weekends, national holidays, judicial feria
        (January & July) and the studio's Dias inhabiles; provincial holidays
        NEVER counted; count starts the day AFTER Fecha efectiva;
        Dias corridos: no roll-over if last day is inhabil; Horas: includes nights
    edge: notificacion "Vencimiento de plazo de prueba" to ALL members day-before
        and day-of from 07:00; appears in Agenda as Vencimiento (red + "Vencido");
        task due dates are typed manually (NOT computed);
        Assistant does NOT compute plazos; new prueba starts in "Proveida";
        status change restarts the plazo from the new state
```

```
F04 Lawyer assigns a task                                            [~3 clicks]
    S16 Tareas (1) -> Nueva tarea or key C (2) -> case picker (optional),
        titulo, Estado, Prioridad, Responsable, Vence -> Crear tarea / Enter (3)
    fast alt from a reading view: S06/S11 shortcut "Crear tarea" (1)
        -> expediente + responsable pre-filled -> Crear Tarea (2)
    edge: assignee gets "Tarea asignada"; overdue date shows red +
        "Tarea vencida"; no responsable = no alerts; comments do NOT notify;
        read-only trial -> Nueva tarea padlocked; bulk changes skip
        "Tarea completada" notification; AI ("Procurador IA") tasks show their
        source actuacion + plazo (filter Creada por = El Procurador IA)
```

```
F05 Lawyer drafts an escrito with AI (gated)                         [~7 clicks]
    S22 Asistente (1) -> + -> "Un expediente" -> pick case (2)
        -> wand or "/" -> Redaccion -> e.g. "Oficio judicial" (3)
        -> fill [brackets] -> Enter (4) -> draft card -> Abrir (5)
        -> S24 split view: ask changes (applied directly, "Borrador actualizado"
        + Deshacer; highlight diffs) -> Guardar en Documentos (6)
        -> choose folder (expediente default) -> Guardar (7)
    gating: AI plans = Pro/Max; trial = 5 consultas per member
        (tutorial report does not consume them); weekly AI limit with renewal
        notice; errors: "Usaste las consultas de tu prueba gratis",
        "Tu plan no incluye IA", "Llegaste al limite de uso de IA por ahora";
        read-only study -> plan-improvement window;
        role without document-create permission -> "No se pudo guardar"
        (Descargar Word still available); skills are templates with [placeholders]
```

```
F06 Daily usage: digest & notifications                               [~2-3 clicks]
    email "Resumen diario" Mon-Fri 08:00 -> open -> lands on the case/actuation
    in-app: bell (1) -> unread "Nuevas actuaciones" (2) -> S11/S06 reading
        -> Siguiente (K) through the queue, or S05 Novedades -> "Revisar" (2)
        -> from reader: Crear tarea / Crear evento / Agregar nota
    cadence: new-actuation notices every 5 min 08:00-20:55 (night batch at
        first hour); task/plazo reminders 07:00 day-before + day-of;
        hearing reminder the hour before; push = desktop browser + Android
        (NOT iPhone/iPad -> email digest only); sound if browser avisos active;
        first sync history generates NO notifications (nor batches of >=25 acts
        that are >=80% of the case); read/unread is per member
```

## Components

| Component | Variants | States | Used on |
|---|---|---|---|
| **Sidebar nav** | expanded / collapsed (icon-only, bell under logo) / mobile → bottom bar + "Menú" screen; permission-gated items (Finanzas, Actividad); collapsible groups (Configuraciones starts closed, remembered) | trial card (days left / "Tu prueba terminó" / "Activá un plan"), unread badges (bell 9+, Novedades count) | all screens |
| **Notifications bell + panel + page** | panel (Todas/No leídas) vs full page `/notifications` | badge 0–9/"9+", blue unread dot, read-on-click, Cargar más (20/page), sound when avisos active | global (top of sidebar; mobile = Avisos) |
| **Search + filter bar** (pattern) | search box (accent/typo tolerant on Expedientes) + filter panel with **active-count badge** + **Limpiar**; filters persist per browser, live-applied | no-results ("No encontramos…" + Limpiar filtros), narrow screen → filters collapse into **Filtros** button | S05, S07, S10, S15, S16, S17, S18, S21, S33, S34 |
| **Data table** | sortable (click header), drag column header to reorder, drag edge to resize (remembered), multi-select (checkbox / Shift+click / Ctrl+click, `Esc` clears), row ⋯ menu + right-click, footer counter "Mostrando X de Y", 50-row progressive loading, bulk action bar | empty/no-results, read-only banner, mobile: reduced columns & no multi-select | S07, S10, S15, S18, S32 |
| **Favorites star** | studio-wide (cases) vs per-account (templates) vs per-browser (tools) vs per-member (tasks) | yellow filled / outline | S07, S33, S34, S16 |
| **Dialogs / modals** | Nueva tarea, Agregar Prueba (type picker → form), Cambiar estado, Mover a…, Renombrar, "¿Para quién guardás estos cambios?", "¿Descartar los cambios?", Categorías de la agenda, Comparar roles, Crear evento en Google Calendar, Ayuda "¿En qué te podemos ayudar?" | validation errors inline ("Selecciona un informante", "Falta el título") | nearly all |
| **Toasts / aviso bar with Deshacer** | success ("Tarea creada", "Inicio guardado", "Cuenta conectada", "Cita copiada", "Modelo copiado…", "Hicimos una copia"), undo ("Moviste…" + Deshacer, "Cancelaste la subida de 5 archivos" 10 s, upload undo), persistent top banners (Eliminación programada, Sincronización en pausa, "Modo solo lectura") | transient / persistent / error-with-reason | global |
| **Reader layout** (document + Assistant) | Novedades reader, Actuación reader, document preview | folded panel (remembered per device), no-panel <1024 px, doc states (Disponible/Sincronizando/Pendiente de plan/…), no-document placeholder, multi-file "Documento 1 de N" | S06, S11, S19 |
| **Assistant chat** | full screen / 400 px side panel (resizable, expand to full) / embedded (editor button, form "Completar con IA", reader side) | empty + 4 suggestions, welcome demo, step log working state, stop button, effort Bajo/Medio/Alto (persisted), context chips (+ expediente/docs, × to remove), citations, hover actions, limit/gating errors, mobile full-screen with hidden bar | S22–S24, plus entry points on S08/S06/S11/S20 |
| **Draft card + split editor** | states: Borrador / Abierto / En Documentos; multi-draft list "2 de 3" | version history + Restaurar, diff highlights, Deshacer, save-failure fallback | S24 |
| **Editor** | menus Archivo/Formato/Insertar/Revisión/Ayuda; modes Edición/Sugerencias/Lectura; comment threads | save indicator (Guardado / Sin conexión / Guardado local / Todavía estamos guardando), read-only for old docs, AI-change highlights, padlock without plan | S20, S24 |
| **Kanban board + list (Tareas)** | Tablero/Lista; group columns by Estado/Responsable/Prioridad/Expediente; group rows by Responsable/Prioridad/Expediente; manual order; default states (Pendiente…Cancelada) renamable/recolorable, each = column | overlay task view vs "Abrir como página", cancelled column collapsed, overdue red, empty (video + Nueva tarea), padlock read-only, bulk bar | S16 + case tab |
| **Dashboard block engine (20 blocks)** | Inicio: 9 default blocks in 5 groups, "Agregar bloque" gallery with previews + "En tu Inicio" ticks; Finanzas reuses it with 15 widgets in 4 categories ("Agregar widget") | edit mode (drag handle, resize corner min/max, remove cross), save scope dialog, Restablecer, permission block "Tu rol no incluye este bloque", 3 Inicio states, mobile: stacked, no Personalizar | S04, S31 |
| **Onboarding checklist card** | "Tutorial: primeros pasos", ring "N/5", sequential lock (Siguiente paso vs candado), Opcional group, two task lists (with/without syncable jurisdiction) | auto-check with green tick + toast, hide via ⋯ ("No pudimos ocultar los primeros pasos" error), disappears after trial ends / plan + system connected | S04 |
| **Calendar / Agenda views** | Día/Semana/Mes/Año/Lista + mini-month calendar + category checkboxes + event detail popover + "Categorías de la agenda" admin modal + Google Calendar status row | free-slot drag create, now-line, "Inhábil"/"Feria" labels, "+N más", labels Vence hoy/Vencido/Se superpone, empty-with-filter-chips, error + Reintentar, previous period stays during load, mobile Lista/Día only | S17 + case tab |
| **Date & plazo pickers** | date calendar (single/range/period presets, used in filters), "Vence" date field, **Plazo group** (Horas/Días corridos/Días hábiles + quantity → live Fecha limite), deadline calculator result with Copiar/Copiar todo | live recalculation, countdown chip colors (green/amber ≤48 h/red "Vencido hace N días"), hatched non-working days | S12, S16, S17, S34 |
| **Status chips** | connection status (Conectada/Sincronizando/Error), doc status set, prueba states, task states, role color labels, trial/plan chips | per-cell tooltips explaining reason | S25, S10, S12, S16, S27 |
| **File list + preview + upload panel** | grid/list, breadcrumb, storage meter, protected folders (padlock + reason), multi-select bar, upload progress panel (bottom-right, survives navigation) | per-file antivirus status, per-file failure reason + Reintentar, undo toasts, ZIP "Preparando el ZIP", permission padlock, read-only message | S18, S19 |
| **Step-guide / Tutorial overlay** | per-screen Tutorial button; guided panel that highlights each click (side panel on desktop, bottom strip on mobile); Inicio checklist | close confirm, resume, "Entendido" when no guide exists | S37, all |

## Inferred data model

```
Study        id, name, logo, plan_id, storage_used, trial_ends_at, read_only
             evidence: S03 wizard, S27 workspace, S29 billing, max 5 studies/user
             confidence: high
User         id, email, name, photo, password_hash, google_id, passkey, 2fa
             evidence: S01, S02, S26
             confidence: high
Membership   user_id, study_id, role_id, status (invited|active)
             evidence: S28 invitations
             confidence: high
Role         id, study_id, name, color, permissions[28 across 9 areas], fixed (Dueno)
             evidence: S27 roles/permisos
             confidence: high
Case         id, study_id, caratula, numero, fuero, tipo, etapa, jurisdiccion,
             sistema_sincronizacion, manual|synced, favorito, archivado, sync_paused
             evidence: S07 filters/columns, S08 header, S25 integration
             confidence: high
Movement     id, case_id, fecha, tipo, detalle, pinned, created_by   (manual log)
             evidence: S09, S08 Resumen
             confidence: medium (fields thin)
Actuacion    id, case_id, portal_ref, fecha, detalle, tipo, fojas,
             estado (Disponible|Por sincronizar|Sincronizando|Solo en el portal|Con error|Pendiente de plan|Sin espacio)
             evidence: S10, S11
             confidence: high
Document     id, study_id, case_id?, folder_path, name, size, uploaded_by,
             version, protected, virus_status, deleted_at
             evidence: S18, S19
             confidence: high
Task         id, study_id, case_id?, title, description,
             estado (Pendiente|En curso|Para revisar|Completada|Cancelada, custom),
             prioridad, responsable_id, vence_at, created_by (incl. Procurador IA), favorite
             evidence: S16, F04
             confidence: high
Event        id, study_id, case_id?, category (6 default), start_at, end_at,
             location, notes, source (manual|audiencia|vencimiento|dia_inhabil)
             evidence: S17, F03, F06
             confidence: high
Hearing      id, case_id, fecha, tipo (online|presencial), citados[], notification_status
             evidence: S13
             confidence: medium (thin)
Prueba       id, case_id, type (Documental|Informativa|Confesional|Testimonial|Pericial|Otras),
             titulo, informante_person_id, parte, estado (per-type sets),
             fecha_efectiva, plazo {unit: horas|corridos|habiles, qty} -> fecha_limite (computed), historial
             evidence: S12, F03
             confidence: high
DeadlineRule feriados nacionales, feria judicial (enero/julio), dias_inhabiles del estudio,
             count starts day AFTER fecha_efectiva; corridos: no roll-over on inhabil day
             evidence: F03 (docs agenda/plazos-procesales)
             confidence: high
DiaInhabil   date, origen (sistema|estudio), study_id?
             evidence: S30 dias-inhabiles
             confidence: high
Person       id, study_id, nombre, contactos   (directory for partes + informantes)
             evidence: S12 picker, S14
             confidence: medium
Parte        case_id, person_id, tipo (representada|contraparte|otro), abogados[]
             evidence: S14
             confidence: medium
Novedad      id, case_id, actuacion_id?, fecha, tipo, archivos[{status}], read_by[]
             evidence: S05, S06
             confidence: high
Notification id, user_id, category (6), payload, read_at, channel (email|push|in_app)
             evidence: S21, F06
             confidence: high
Integration  id, study_id, portal (pjn|mev|eje|iol|sed|pcj), creds_encrypted,
             status (Conectada|Sincronizando|Error), last_sync_at, email_forwarding (MEV)
             evidence: S25, F01
             confidence: high
Plan         plan (pro|max|max6x), currency, cycle, seats, ai_quota_weekly, receipts, trial state
             evidence: S29, pricing.md
             confidence: high
Conversation id, user_id, case_id?, messages[], effort (bajo|medio|alto), forked_from, citations[]
             evidence: S22
             confidence: high
Draft        id, conversation_id, case_id?, version, status (borrador|abierto|en_documentos), doc_id
             evidence: S24
             confidence: high
AIReview     id, study_id, questions[], rows[], exports      (mass document review)
             evidence: S36 (index only)
             confidence: low
FinMovement  id, case_id?, tipo (ingreso|egreso), monto, moneda, categoria_id, fecha,
             comprobante, recurrence, ai_read_status
             evidence: S31, S32
             confidence: medium
Categoria    id, study_id, nombre, presupuesto_mensual
             evidence: S32
             confidence: medium
ActivityLog  id, study_id, user_id, entity, action, before, after, at (CSV export)
             evidence: S30 Actividad
             confidence: high
BlockConfig  scope (user|study), blocks[20 types], layout, owner_id
             evidence: S04, S31 (shared engine)
             confidence: high
Template     id, title, materia, origen, tipo, tags, content, favorite   (750+ models)
             evidence: S33
             confidence: high
```

Relationships: Study 1-n Membership, Case, Role, Integration, Notification-preferences; User n-1 Role via Membership; Case 1-n Movement, Actuacion, Task, Event, Prueba, Parte, Document, Novedad; Person 1-n Parte; User 1-n Task (responsable), Conversation; Integration 1-n Case (sync); Conversation 1-n Draft; Draft n-1 Document; Case n-1 Template via "Usar en un expediente".

## Feature matrix

See features.csv. Must: 19, should: 26, could: 18, skip: 7.

## Out of scope (cannot or should not be cloned)

- Veredicta's brand, name, marketing copy, and 110-page manual content.
- Their 750+ modelos de escritos library and AI-generated jurisprudence sumarios (their content; build our own smaller library; query public SAIJ/JUBA directly instead).
- Their AI prompts, MCP server implementation, and any proprietary text.
- Their users, network, and stored data.
- Court portals themselves (PJN, MEV, etc. are third-party public systems; we build our own connectors — or start with manual entry — never reuse theirs).
- Their account/sign-up flows that require declaring under oath to be a lawyer: our product must validate its own way.
- WhatsApp client-intake module (Module A) has NO Veredicta reference — original=no in the matrix; MetaJurídico/Whaticket recon still pending.

## Size

Screens 38, flows 6, entities ~26. Hard parts: (1) resilient judicial-portal connectors and sync, (2) plazos engine (habiles/feria/feriados/dias inhabiles), (3) collaborative Word-like editor + file storage, (4) AI assistant with page-level citations, (5) real-time collaboration. Size: XL for a full Veredicta clone; L for our Module A+B MVP slice (manual case entry first, deadlines engine, alerts, tasks, WhatsApp intake).

## Evidence gaps

1. **Visual design (colors, type, spacing, iconography)** — the manual's screenshots are inside `<dialog>` elements; only captions/alt text are machine-readable. No color tokens, fonts, or layout grids are stated anywhere (except incidental colors: yellow star, blue unread dot, red overdue, 11 agenda colors matching Google Calendar).
2. **All tutorial videos** (30+ embedded, e.g. "Moverte por Veredicta" 0:44, "Novedades judiciales" 2:44, "Roles" 2:08, "Finanzas" 2:41, "Tareas" 2:50, "Documentos renovado" 2:13) — only their text summaries are available. **Video URLs were not extracted** (embedded players; would need the docs HTML or YouTube channel lookup) — this is the primary input for later screenshot capture.
3. **Screens I only know from the index line** (not fetched): Movimientos, Audiencias, Partes, Editar/Archivar/Descargar expediente, Finanzas Movimientos/Recurrentes/Categorías/comprobantes/export, Personas/Etapas/Días inhábiles/Actividad, Miembros/Invitaciones/Aceptar invitación, Perfil/Seguridad/Eliminar cuenta, Planes (comparar/activar/pagos/cancelar/límites de IA), Notificaciones preferencias/correos/avisos, Análisis de documentos (5 pages), Jurisprudencia, Usar un modelo, Valores judiciales, comentarios-y-sugerencias, versiones, papelera, análisis pages, MCP "Conectar Claude o ChatGPT". Their **states** are unverified beyond index summaries.
4. **Exact tab query values** in case-detail URLs: docs say the address contains `?tab=` and can be shared, but never print a value (e.g. `?tab=actuaciones` is my inference — unverified). Same for notification deep-link routes.
5. **Loading/skeleton/progressive states**: almost never documented (exceptions: agenda keeps old period with thin bar; connect form up-to-1-minute verification with background continue; upload panel). Spinner/skeleton designs unknown.
6. **Collaborative presence**: real-time multi-user editing is stated ("Varias personas pueden editar el mismo documento a la vez"), but no evidence of avatars, cursors, or conflict UI.
7. **Login/2FA/passkey screens**: S01 is under-documented (I did not fetch `cuenta/iniciar-sesion`, `recuperar-tu-contrasena`); the 6-digit verification-code screen and passkey flows are index-only.
8. **Gated/blocked screens**: billing/payment forms, plan-locked screens (what the padlock click actually renders beyond "opens the plans screen"), and the read-only team view are described but not pictured.
9. **Marketing-side pages not fetched**: `/pricing`, `/sistemas-judiciales`, `/ia-para-abogados`, `/about`, blog — may hold extra UI claims/screenshots.
10. **Trial limit clarification**: your brief mentioned "case limit (50 in trial)"; public docs state the trial has **causas ilimitadas** and that 50 is the expedientes-list page size. No case-count limit is evidenced — do not build a flow edge around one without new evidence.
11. **Search**: no global search exists (explicit) — any later artifact asking for a "búsqueda global" screen would be inventing; per-screen searchers are the reality.
12. **Análisis de documentos, Jurisprudencia, MCP connect, Google Calendar OAuth**: functional claims exist (marketing home + index), but their screens/states are unverified — flag for screenshot capture.

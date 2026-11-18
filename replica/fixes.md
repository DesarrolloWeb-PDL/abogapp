# Fix plan and positioning — clean-room clone vs Veredicta

Date: 2026-11-18 · Skill: replica-entrepreneur · Mode: research only, no application code touched.
Inputs: `replica/reviews.csv` (34 verbatim quotes), `replica/feedback.md` (theme ranking), `replica/recon.md`, `replica/parity.md` (score 16.9, M2 in flight, WhatsApp phase shipped).

## Sample size (read this first)

- **34 quotes, all with URLs, 0 fabricated.** 27 from Reddit (5 threads, 12 distinct users, Feb 2025 – Sep 2026), 7 from three competitor pages marked **interested party** (Argus, RivoLegal, Civilia).
- **0 star ratings anywhere** — no review site lists this product (see empty sources below). Ratings are blank in the CSV because the sources have no stars, not because they were hidden.
- This is **far below the skill's 100+ target.** The tool's own threshold is 30 reviews; we have 34 rows but only **27 are user quotes, all from one platform** (Reddit). That supports a *direction*, not a ranking. Treat the ordering below as evidence-weighted direction, and the thin labels as real.
- Reddit was read through the PullPush public archive API after reddit.com returned 403 to anonymous fetches; every quote below is verbatim from that archive and links to the canonical reddit.com permalink.

---

## 1. What they hate

Ranked by evidence × breadth. "Users" = distinct people, "threads" = distinct discussions.

### H1. Handover of credentials and case data to a private startup — 4 quotes, 4 users, 3 threads (thin: single platform)

The strongest and most repeated fear, and it is about *trust*, not features. It blocks purchase before price is even discussed.

- "A mi sinceramente lo que me da mas tirria es confiarle mi user y pass del PJN y la MEV, asi como mis escritos a un sistema de guardado de contraseñas y nube de una empresa privada que hoy está y mañana quiebra y no está, pero la data en sus servidores no se cuan segura estaría. La verdad que eso me genera mucho cagazo." — [r/DerechoGenial, 2025-08-24](https://www.reddit.com/r/DerechoGenial/comments/1myhqrn/herramientas_y_calculadoras_jurídicas/naft1do/)
- "Dicen que se toman muy en serio la privacidad y seguridad de la información pero no hay ni una política de privacidad." — [r/NegociosArgentina, 2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/maubmuf/) *(the vendor account posted in this same thread the same day promising the privacy-policy link — see §4)*
- "Se que Veredicta tiene sus términos de privacidad y demás, pero otros acá comentaron que ni así serviría porque compartir datos personales a terceros es todo un tema." — [r/DerechoGenial, 2026-09-19](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/pau9so0/)
- Counter-voice (keep it honest): "A mí me da un poco igual lo de la \"privacidad\" porque los expedientes son todos públicos." — [r/DerechoGenial, 2026-09-19](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/pauldmi/)

### H2. AI does the wrong tasks, and its drafting cannot be trusted — 5 quotes, 2 users, 3 threads (thin: single platform, but repeated across 12 months)

- "Hay un error en la mayoría de las IA que existen para abogados. En vez de solucionar las tareas aburridas y repetitivas, hacen las tareas que te hacen ser abogado." — [r/DerechoGenial, 2026-09-18](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/panvsz8/)
- "No podés confiar en nada que sea redacción de escritos. Tenés que armar vos los escritos y pedirles que simplemente lo revisen o tener mucho cuidado y revisar con detenimiento lo que te armen." — [r/DerechoGenial, 2026-09-19](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/pas0w76/)
- "No he probado las cosas que decís, sinceramente, no le confiaría la procuración a una IA por el momento." — [r/DerechoGenial, 2025-08-24](https://www.reddit.com/r/DerechoGenial/comments/1myhqrn/herramientas_y_calculadoras_jurídicas/nacg5ul/)
- "Nadie en su sano juicio usaría una IA para buscar jurisprudencia." / "Hay millones de IAs que promete funcionar con el derecho argentino y ninguna está cerca aún. Yo creo que se enfocan en el aspecto equivocado." — [r/DerechoGenial, 2026-08-19](https://www.reddit.com/r/DerechoGenial/comments/1vsfjou/cómo_usan_realmente_ia_los_abogados_argentinos/p4l3vto/)

### H3. Browser bugs at first contact — 3 quotes, 2 users, 1 thread (thin: single thread; vendor confirmed and fixed it)

- "En mozilla firefox falla apenas abro el link" — [r/NegociosArgentina, 2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mawn9bg/)
- "en incognito me anda bien 🤔" — [same thread](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mb07gcw/)
- Counter-data: "Che que raro que te salga eso, yo con mozilla me carga todo, tendras el navegador actualizado?" — [same thread](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/max24rw/)

### H4. Per-seat dollar pricing and price confusion — 3 quotes, 3 sources (only theme with 2+ sources; 2 of 3 are interested parties)

- "Se cobra por miembro: cada abogado del estudio suma un plan." — [Argus vs Veredicta, 2026-10-31](https://www.arguslegal.ai/argus-vs-veredicta) *(interested party)*
- "USD 10 / 50 / 100 por usuario/mes" — [RivoLegal vs Veredicta, 2026-09-27](https://rivolegal.com/blog/veredicta-vs-rivolegal-comparativa-2026.html) *(interested party)*
- "Después había una que se llamaba veredicta o algo así, que era gratuita." — [r/DerechoGenial, 2026-03-20](https://www.reddit.com/r/DerechoGenial/comments/1rz9m68/alternativas_a_lex_doctor_recomendaciones_de/obkhavm/) *(user misremembers both the name and the model — see H6)*

Pricing/billing rows route to `/replica-launch` per the skill; they are recorded here for completeness.

### H5. Trial caps — 2 quotes, 2 sources (both interested parties, thin)

- "14 días, sin tarjeta (hasta 50 causas)" — [RivoLegal, 2026-09-27](https://rivolegal.com/blog/veredicta-vs-rivolegal-comparativa-2026.html) *(interested party)*
- "14 días sin tarjeta, con acceso completo (hasta 50 causas y 512 MB)" — [Civilia, 2026-10-23](https://civilia.com.ar/blog/mejores-ia-para-abogados-argentina-2026) *(interested party)*

Note: `recon.md` F01 already records that the 50 figure is contested — docs say the trial is unlimited and 50 is the list page size. Competitors repeat "50 causas" anyway; whether true or not, it is what the market says.

### H6. Weak brand awareness — 1 quote, 1 user (thin; the theme's second match was a false positive)

- "Después había una que se llamaba veredicta o algo así, que era gratuita." — [r/DerechoGenial, 2026-03-20](https://www.reddit.com/r/DerechoGenial/comments/1rz9m68/alternativas_a_lex_doctor_recomendaciones_de/obkhavm/)
- Same user, one year earlier, had not tried it either: "No he probado las cosas que decís…" — [2025-08-24](https://www.reddit.com/r/DerechoGenial/comments/1myhqrn/herramientas_y_calculadoras_jurídicas/nacg5ul/)
- Honest note: `feedback.md` counts 2 rows for this theme, but the second is a false positive — "Lena Riccio o algo asi" ([2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mave3b6/)) is about a YouTuber's name, not Veredicta's.

### H7. Perceived as beta / unfinished — 1 quote (thin, single thread)

- "La app Veredicta en teoría ofrecerá procuración inteligente y vinculación con PJN, pero está en beta." — [r/DerechoGenial, 2025-08-24](https://www.reddit.com/r/DerechoGenial/comments/1myhqrn/herramientas_y_calculadoras_jurídicas/nacl17w/)

### H8. Incumbent UX is bad enough that lawyers build their own stack — 1 quote (thin; market context, not about Veredicta)

- "En algún momento usé Litis que me pareció la mejorcita entre todos esos programas de gestión, pero tampoco es tan buena la experiencia de usuario y la dejé." — [r/DerechoGenial, 2025-08-24](https://www.reddit.com/r/DerechoGenial/comments/1myhqrn/herramientas_y_calculadoras_jurídicas/nacl17w/)

---

## 2. What is missing (asked for by name)

### M1. Answer the client's WhatsApp — "¿cómo va mi caso?" — 1 user, 1 thread (thin)

- "La IA tendría que contestar el WhatsApp al cliente que pregunta cómo va su caso, y explicar lo que sigue." — [r/DerechoGenial, 2026-08-19](https://www.reddit.com/r/DerechoGenial/comments/1vsfjou/cómo_usan_realmente_ia_los_abogados_argentinos/p4l3vto/)
- Adjacent: "Recordatorios automáticos a clientes , lectura e informe de mails y hasta posibles respuestas para que después un humano valide y envíe." — [same thread, different user](https://www.reddit.com/r/DerechoGenial/comments/1vsfjou/cómo_usan_realmente_ia_los_abogados_argentinos/p4le38n/)

**Veredicta cannot do this**: web-only product, no app, no WhatsApp module (recon §Sources row 16). This is a structural gap, not a missing checkbox.

### M2. Detect a hearing from the notification, schedule it, remind on WhatsApp 48h before — 2 users, 1 thread (thin)

- "Una IA que (por ejemplo) detecte en la notificación que se fijó audiencia, lo agende y se lo recuerde al whatsapp 48 hs antes, podría ser útil." — [r/DerechoGenial, 2026-08-19](https://www.reddit.com/r/DerechoGenial/comments/1vsfjou/cómo_usan_realmente_ia_los_abogados_argentinos/p4lwgl3/)
- "Tendría que llevar el calendario con vencimientos y audiencias con avisos según el tiempo y complejidad de las tareas o el caso" — [same thread](https://www.reddit.com/r/DerechoGenial/comments/1vsfjou/cómo_usan_realmente_ia_los_abogados_argentinos/p4l3vto/)

### M3. Jurisprudence cited and verified inside the draft — 1 interested party

- "No publica que sus borradores citen jurisprudencia verificada." — [Argus vs Veredicta, 2026-10-31](https://www.arguslegal.ai/argus-vs-veredicta) *(interested party — Argus sells exactly this)*

### M4. AFIP/ARCA invoicing and ARS-only billing — 1 interested party

- Row "Facturación AFIP/ARCA" in Veredicta's column: "No la destaca en su sitio" — [RivoLegal, 2026-09-27](https://rivolegal.com/blog/veredicta-vs-rivolegal-comparativa-2026.html) *(interested party — RivoLegal sells exactly this)*

### M5. More provincial portals — 1 interested party

- "No sincroniza SAC Córdoba, SISFE ni Jujuy, y no lista la SRT." — [Argus, 2026-10-31](https://www.arguslegal.ai/argus-vs-veredicta) *(interested party; Argus lists those portals itself)*

---

## 3. What is unsolved (whole jobs nobody serves) — this becomes positioning

### U1. The boring, repetitive, low-status work — "make the drudgery go away" is what lawyers ask for; the category keeps selling "AI that thinks like a lawyer"

Two users, two threads, 12 months apart, same verdict:

- "En vez de solucionar las tareas aburridas y repetitivas, hacen las tareas que te hacen ser abogado." — [2026-09-18](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/panvsz8/)
- "Mis amigos colegas, no han contratado ninguna por eso, porque no hacen lo aburrido y si lo interesante." — [2026-09-18](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/panymni/)

Nobody in the market owns "we do the boring half": procuración, reminders, status updates, filing prep. Veredicta's own marketing leads with the assistant and the drafting.

### U2. The client-communication job

"Contestar el WhatsApp al cliente que pregunta cómo va su caso" (M1) is a real daily job, described by a working lawyer, and **no product in this research solves it**. Veredicta: web-only, no WhatsApp. Our Module A (WhatsApp intake, Graph outbound, LLM fallback — just shipped) is aimed at exactly this job from the intake side; the case-status answer is the natural next step.

### U3. Trust for the 2–10-lawyer studio with no IT person

H1 is not a feature gap; it is an adoption cliff. The buyer is a lawyer who is afraid of losing a portal account, afraid of a startup dying ("hoy está y mañana quiebra"), and afraid of the professional-risk optics (H2, U1). Nobody sells *boring reliability* to this buyer.

### U4. Institutional/public-sector segment (explicitly out of our reach, noted for honesty)

- "al estar en un juzgado no podemos usar IA externa por protección de datos personales" — [2026-09-18](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/panymni/). Court employees are a blocked segment for every cloud tool, including ours. Do not target them.

---

## 4. Praise (what the original gets right — do not break these)

- **A real paying user, daily use, sees clear ROI**: "Pago ambas, Claude y Veredicta. Vale la pena porque Veredicta me salva de tener que pagarle a alguien por hacer la procuración" — [r/DerechoGenial, 2026-09-19](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/pas0w76/)
- **Same user, on what it does**: "Veredicta hace todo eso que podría hacer un secretario o un junior, revisa todos los expedientes, te arma un resumen de novedades, e incluso te dice qué falta hacer en el expediente." — [2026-09-19](https://www.reddit.com/r/DerechoGenial/comments/1wk478d/abogados_del_sub_cómo_usan_la_ia_hoy_en_sus/pauldmi/)
- **It responds to public bug reports in-thread, fast**: "Ufff no sabíamos. Gracias por el feedback y encontrar el error!" — vendor account, [r/NegociosArgentina, 2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mawpv87/) (same comment continues: "Hoy lo tratamos de solucionar y publicar un fix.")
- **And it promised the missing privacy-policy link the next day** (reply text verified; exact nesting under the complaint above not verified): "Tenés toda la razón, mañana le metemos a eso y agregamos el link a la política de privacidad." — vendor account, [same thread, 2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/maue5mr/)
- **Warm reception at launch**: "Mucha suerte con el proyecto, lo probaré" — [2025-02-18](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mdia23u/); a QA tester volunteered the same week — [2025-02-04](https://www.reddit.com/r/NegociosArgentina/comments/1ih3d9m/creamos_una_app_que_reemplaza_al_poder_judicial/mavf5q4/)

The original also ships weekly with video changelog (`veredicta.com.ar/lo-nuevo`) and a 110-page manual with per-screen tutorials (recon S37). Support is WhatsApp-first (`+54 9 11 2611-5660`). Match that responsiveness or lose to it.

---

## 5. Fix plan mapped to our current state

Status key: **already avoid** (we don't have this problem today) · **M2 gap** (already planned work) · **opportunity** (we can beat the original here) · **open decision**.

| # | Fix | Size | Owner / skill | Evidence | Our status |
| --- | --- | --- | --- | --- | --- |
| F1 | Ship privacy policy + plain-language "how we handle your credentials" page **before** first launch; keep read-only-sync promise visible on the page | S | `/replica-launch` (legal pages gate) | H1 (4 quotes); vendor promised a privacy-policy link in-thread the day it was raised | **open decision → do at launch.** We avoid it only because we are not launched; the launch gate must fail without it |
| F2 | Add Firefox to the e2e run (Playwright projects: chromium + firefox) before any public beta | S | `/go-testing` (repo config; **no code in this pass**) | H3: "En mozilla firefox falla apenas abro el link" | **gap** — suite is Chromium-only today (119 unit + 58 e2e, `parity.md` §7) |
| F3 | WhatsApp case-status answer: "¿cómo va mi caso?" → status + next steps from the case record, human-approved copy | M | `/replica-backend` (Module A; Graph outbound + LLM fallback already shipped) | M1 (2 users) | **opportunity** — Veredicta has no WhatsApp at all; we have the channel wired |
| F4 | WhatsApp reminder channel for the M2 plazo/audiencia jobs (day-before + day-of 07:00, plus the requested 48h-before-hearing) | M | M2 notifications work + WhatsApp channel | M2 (2 users) | **M2 gap + opportunity** — reminders are already must-have rows; WhatsApp delivery would surpass the original's email/browser-only push (no iOS push per recon F06) |
| F5 | Client-facing automatic reminders ("recordatorios automáticos a clientes") on the same WhatsApp thread | M | `/replica-backend` Module A follow-up | M1 (1 user) | **opportunity** — beyond both the original and our current intake bot scope |
| F6 | When AI drafting lands (M2+): citations-first, "you approve, we never file" copy, human-in-the-loop as the default UX | L (feature) + S (copy) | `/replica-backend` + `/replica-launch` (hero copy) | H2 (5 quotes) | **already avoid today** (no AI shipped, `asistente-ia` 0.0) — build it right the first time; do not copy the original's assistant-first marketing |
| F7 | Pricing decision: flat per-studio or low flat seat cap, published in ARS, no "50 causas" ambiguity in the trial | S decision | `/replica-launch` (pricing) | H4 (3 sources), H5 (2 interested parties), H6 | **open decision** — no pricing exists yet; route to `/replica-launch` per skill |
| F8 | Connector trust posture when PJN sync lands (M2+): credentials never used to file, portal access read-only, third-party audit page, export-your-data | M | `/replica-backend` (connectors) + `/replica-launch` (trust page) | H1 | **M2 gap** — connectors are `should`-level in `parity.md`; ship the trust copy *with* them, not after |

### What we already avoid (keep it that way)

- **AI-drafting distrust**: we ship no AI drafting yet — zero exposure today. F6 governs how we enter.
- **Credential fear**: no portal sync built yet — zero exposure today. F8 governs how we enter.
- **Per-seat pricing confusion**: no pricing published — F7 is a clean-slate decision.
- **Firefox-class bugs**: not verifiable as fixed (suite is Chromium-only) — that is exactly F2.
- **On the demand side we are already on par**: our plazos engine (21 golden tests + DB trigger cross-check) plus the planned M2 reminder jobs answer the "reminders" requests; WhatsApp delivery (F4) is the step above.

### Not doing (explicitly)

- Court/employee segment (U4): blocked by data protection for everyone; out of scope.
- Portal coverage breadth (M5): connectors are `should`/`could` in parity; chasing 30 provincial portals now would burn the M2 must-haves (tasks, movement log, filters, plazos settings, notifications).
- Invoicing (M4): finance module is `could`; route any AFIP/ARCA decision to `/replica-launch`.

### Proposed `features.csv` rows (NOT written — this pass is read-only on existing files)

Per the hard rules of this task, `replica/features.csv` was **not** edited. Rows to add later, `original = no`:

1. `whatsapp,WhatsApp case-status answer (client asks "cómo va mi caso"),no,M1; M2+ (needs case data API),opportunity vs original (no WhatsApp)`
2. `whatsapp,WhatsApp delivery for plazo/audiencia reminders (48h/1 day/07:00),no,M2+F4; pairs with must-have reminder jobs,opportunity vs original (no iOS push, email only)`
3. `whatsapp,Client-facing automatic reminders,no,M3+,opportunity — nobody in market does this`
4. `config,Privacy policy + credential-handling trust page,no,launch gate F1,avoided today; required before launch`
5. `qa,Firefox in e2e matrix,no,F2 before any public beta,Chromium-only today`

---

## 6. Positioning angle (three options; one recommended)

Tied to `recon.md`: **"For: small/medium Argentine law firms with low technical resistance."**

```
Option A — trust-first
For small Argentine law firms who don't trust a startup with their PJN
credentials or their clients' data, <app> gives you court alerts and deadline
control with read-only access, plain pricing in pesos, and no AI drafting
behind your back.
Evidence: trust/credential fear, 4 quotes across 3 threads (H1),
price confusion, 3 sources (H4).
```

```
Option B — WhatsApp-first (RECOMMENDED)
For small Argentine law firms whose lawyers and clients already live in
WhatsApp, <app> answers "¿cómo va mi caso?" and sends hearing and deadline
reminders to WhatsApp — the web-only original can't.
Evidence: WhatsApp case-status + hearing-reminder requests, 2 users in
r/DerechoGenial (M1, M2, thin) + structural fact: original has no app and
no WhatsApp (recon §Sources row 16).
```

```
Option C — boring-work-first
For Argentine lawyers tired of AI tools that write like a lawyer instead of
doing the paperwork, <app> runs the repetitive half — procuración, reminders,
status updates — and lets you approve everything.
Evidence: "no hacen lo aburrido y si lo interesante", 2 users, 2 threads
(U1), 12 months apart.
```

**Recommendation: Option B, with C as the product story and A as the objection-handler.** Reasons:

1. It is the only option whose claim the original **structurally cannot copy** without becoming a different product (recon: web-only, no native app, no public API, no WhatsApp).
2. It matches what we already shipped (WhatsApp bot admin, Graph outbound, LLM fallback) and what M2 is building (reminders, digest) — the plan and the pitch are the same work.
3. It speaks to the "For:" line: low-technical-resistance small studios don't want another dashboard; they want the answer where they already are.
4. Caveat, stated plainly: the direct request evidence is **thin** (2 users, 1 thread). Validate with 5–10 interviews of estudios chicos before locking the hero copy; the structural gap (no WhatsApp in the original) is solid regardless.

Per the skill: do **not** put Veredicta's name in our name, ads or store listing; a factual comparison page is a legal question for a lawyer in Argentina.

---

## 7. Sources checked with nothing found (honesty list)

| Source | Result |
| --- | --- |
| App Store / Google Play | **No app exists** (recon row 16: "Veredicta no tiene una app"). Nothing to review. |
| G2, Capterra, Trustpilot, GetApp, SoftwareSuggest | **No listing found** for Veredicta/ZEST LABS in any; searches returned only unrelated products (Pre/Dicta, Verdict, etc.). Recon row 17 said the same. |
| Hacker News (Algolia API, `query=veredicta`) | **0 hits.** |
| YouTube — 11 videos on @veredicta_ar (incl. the 5-min demo `6CpuSNlY8_8`) | **0 comments on every video checked** (innertube API: demo, Tareas, Finanzas, Primeros pasos all report "0 comentarios"); channel videos have 1–7 views each. |
| Product Hunt | Not found. |
| Instagram (@veredicta.com.ar) | Posts surfaced in search show "0 comments"; no complaint threads accessible without login (not attempted — no accounts used). |
| X/Twitter | No complaints or reviews found via search. |
| Argentine legal forums (portaldeabogados.com and similar) | phpBB search is **login-gated** for guests; site: search returned **no Veredicta threads**. |
| Independent press with user opinions | **None found.** Only directory/competitor mentions (Tracxn, Stanford TechIndex, competitor blogs). |
| Vendor's own feature-request board | **No public board** (no Canny/roadmap). Requests go through WhatsApp/email per docs (`docs.veredicta.com.ar/ayuda/pedir-ayuda`). |
| Vendor testimonials ("Lo que dicen nuestros usuarios") | Section headers exist on `/soluciones/*` pages (e.g. https://veredicta.com.ar/soluciones/herramientas-ia), but **individual testimonial texts are not present in the served HTML** — not extractable verbatim, so **not used**. No quote was invented to fill the gap. |
| r/AskArgentina launch thread | 1 comment, **[removed]** — no usable content. |
| r/NegociosArgentina launch thread | 22 unique comment records retrieved: 7 vendor replies, 13 live user comments, 2 **[removed]** by automoderator (Reddit's own counter showed 20). Used here: 6 user quotes + 2 vendor replies. |

## 8. Verification of this pass

- Quotes: 34 rows in `replica/reviews.csv`, every row has an `https://` URL; `reviews.py` dropped 0 rows; 0 duplicate rows.
- `replica/feedback.md` generated with `reviews.py --themes <custom Spanish themes> --today 2026-11-18`.
- `git status --short` after writing shows my three new files (`replica/reviews.csv`, `replica/feedback.md`, `replica/fixes.md`) **plus** concurrent M2 tasks-module changes (`lib/data/tasks.ts`, `lib/supabase/tasks.ts`, `lib/data/tasks.test.ts`, `app/(app)/tareas/`, edits to `lib/data/index.ts` and `components/shell/main-nav.tsx`) that belong to the parallel build session — not to this pass. I wrote only the three `replica/` files: no existing file was edited by me, no application code, no npm/playwright run, no commits.
- Sample size stated in §1; thin themes labeled throughout; interested-party sources marked on every quote.

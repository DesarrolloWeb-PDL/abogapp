# Production checklist — Meta WhatsApp (Module A)

Deferido por decisión del usuario (2026-11-15): hacerlo **al ir a producción**,
no antes. Guardado para retomarlo cuando replica-deploy arranque.

## Estado actual (desarrollo local)

- `.env.local` lleva **fixtures dev** autoinventados:
  `WHATSAPP_VERIFY_TOKEN=abogapp-dev-verify-2026`,
  `WHATSAPP_APP_SECRET=abogapp-dev-appsecret-2026`.
  **Reemplazar ambos** con los valores reales de Meta al configurar.
- El circuito entrante ya está verificado localmente: handshake `GET` 200,
  firma `X-Hub-Signature-256` (HMAC-SHA256) validada, ingest idempotente,
  bot de reglas respondiendo en la Bandeja.
- `replica/whatsapp-bot.md` = spec completa de flujos, mensajes y pantalla A01.

## Pasos cuando toque producción

1. `developers.facebook.com` → *Mis apps → Crear app* (tipo Empresa) →
   agregar producto **WhatsApp**.
2. *Configuración de la app → Básica* → **App Secret** →
   `.env.local` como `WHATSAPP_APP_SECRET` (reemplaza el fixture).
3. Inventar cadena de handshake propia → `WHATSAPP_VERIFY_TOKEN`
   (reemplaza el fixture).
4. *WhatsApp → Configuración → Webhook*: URL pública + el mismo verify
   token, suscripto al campo `messages`.
5. **URL pública**: Meta no alcanza `localhost` → túnel
   (cloudflared o ngrok) o deploy directo según replica-deploy.
6. Verificar handshake en vivo + mensaje entrante desde el número de prueba
   → la respuesta del bot aparece en la Bandeja.

## Dependencias pendientes (M3)

- **Respuestas salientes al celular del cliente** → Graph API con token
  permanente (hoy la respuesta del bot vive solo en la Bandeja).
- Ventana de 24 h + plantillas de re-engagement (fuera de M1/M2).
- Cuenta y claves **las crea siempre el usuario** — nunca el agente.

## Higiene (opcional, al pasar a producción)

- Borrar los usuarios legacy de Supabase (`ana.beltran@example.com`,
  `outsider@example.com`) — el dataset ya fue re-apuntado con
  `attach-demo-user.sql`.
- Encender de nuevo *Confirm email* en Auth → Sign In / Providers → Email
  (quedó apagado para crear el usuario de prueba).

## Deploy en Vercel (estado 2026-11-15)

- **`abogapp-six.vercel.app` = NUESTRO deploy** (automático desde `master`
  del repo `DesarrolloWeb-PDL/abogapp`).
- Hoy corre **sin env vars de Supabase** → cae en modo demo (el login
  muestra la cuenta falsa `ana@estudiobeltran.com.ar` / `estudiobeltran`
  y no hay base real detrás).
- **Para que esa URL sea la demo real:** Vercel → proyecto →
  *Settings → Environment Variables* → agregar las 3 de `.env.local`
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`) → **Redeploy** → entra con
  `prueba.abogapp@gmail.com` / `demo-estudio-2026` (misma base que local).
- **`abogapp.vercel.app` NO es nuestro**: es otro proyecto (UI "AbogApp",
  tema oscuro, ruta `/ingresar`, otra base) — no confundir.
- La migración `form_gaps` debe estar aplicada en la base ANTES de probar
  el formulario ampliado desde cualquier entorno (local o Vercel).

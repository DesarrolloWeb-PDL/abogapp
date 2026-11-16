-- ============================================================================
-- seed.sql — realistic FAKE data for the M1 flows (no real people: names are
-- invented, emails use example.com, the phone is the +5491155550xx test
-- range). Idempotent: fixed UUIDs + on-conflict guards, safe to re-run.
-- Plain SQL only (no psql variables): runs in the dashboard SQL Editor and
-- through `npx supabase db push` alike.
--
-- RUN ORDER (fresh database):
--   1. Create the users — Supabase dashboard → Authentication → Users (or
--      sign up through the app): the MAIN user must be
--      prueba.abogapp@gmail.com (any password, email confirmed); the
--      optional second user is outsider@example.com. NEVER insert into
--      auth.users / auth.identities by hand: GoTrue rejects password
--      sign-in for hand-written rows (unexpected_failure) and the dataset
--      ends up unreachable behind RLS.
--   2. Run migrations/20261114120000_init.sql.
--   3. Run this file.
--
-- Covers:
--   * sign-in as the demo owner (the account you created in step 1);
--   * the wizard result: a study with the owner's active membership
--     (init_study_defaults → Dueño role + default task statuses);
--   * case list / case detail / pruebas with a trigger-computed plazo;
--   * an unread in-app notification (the bell);
--   * the WhatsApp inbox: contact + conversation + in/out messages;
--   * an optional second user with NO membership, for the RLS
--     second-user test (skipped with a notice when it does not exist).
--
-- The MAIN user is REQUIRED: when it is missing, this file raises an
-- exception before any data row is written, so the dataset is never
-- orphaned. The outsider is OPTIONAL: when absent, the script notices and
-- runs to completion — create that user later and re-run to enable the
-- RLS second-user test.
--
-- Database where the OLD seed already ran (it wrote its own auth rows and
-- GoTrue rejects their passwords)? Do not re-run this file: use
-- supabase/attach-demo-user.sql to re-point that dataset onto a working
-- user. See replica/backend.md.
-- ============================================================================

do $$
declare
  -- The demo users are RESOLVED from auth.users (created in run-order
  -- step 1). The old hard-coded owner uuids are gone on purpose: hand-
  -- written auth rows cannot log in, so the seed never creates them again.
  v_email_a constant text := 'prueba.abogapp@gmail.com'; -- main owner (required)
  v_email_b constant text := 'outsider@example.com';     -- outsider (optional)
  v_user_a uuid; -- resolved id of the main demo owner
  v_user_b uuid; -- resolved id of the outsider (null when not created)
  v_study  uuid := 'b0000000-0000-4000-8000-000000000001'; -- fixed; shared with attach-demo-user.sql
begin
  -- 1. MAIN user — required. Every seeded row hangs off it (studies.created_by,
  --    the Dueño membership, cases/persons/pruebas/plazos created_by and
  --    notifications.user_id), and RLS only shows the study to its members —
  --    without this user the whole dataset would be invisible. Notice with
  --    the fix, then abort BEFORE any insert so nothing runs orphaned.
  select id into v_user_a
    from auth.users
   where lower(email) = lower(v_email_a);
  if v_user_a is null then
    raise notice 'seed.sql: main demo user % not found. Create it first: Supabase dashboard → Authentication → Users (email %, any password, email confirmed) or sign up through the app — then run seed.sql again.', v_email_a, v_email_a;
    raise exception 'seed.sql: main demo user % does not exist in auth.users — create it (run order step 1) before seeding; no data was written', v_email_a;
  end if;

  -- 2. OUTSIDER — optional: it owns no seeded row, it exists only for the
  --    RLS second-user test (it must read zero rows of the study). Missing
  --    -> notice and keep going; the script stays runnable end-to-end with
  --    just the main user, and every insert below is conflict-guarded, so
  --    creating the outsider later and re-running fills in cleanly.
  select id into v_user_b
    from auth.users
   where lower(email) = lower(v_email_b);
  if v_user_b is null then
    raise notice 'seed.sql: optional user % not found — skipped (RLS second-user test deferred). Create it later via Supabase dashboard → Authentication → Users and re-run seed.sql.', v_email_b;
  end if;

  -- 3. Profiles: the on_auth_user_created trigger only exists AFTER step 2,
  --    and the users are created in step 1 — backfill both profile rows
  --    idempotently so every FK below (studies.created_by, the membership
  --    user_id, notifications.user_id) resolves. Rows the trigger already
  --    made are kept (on conflict do nothing).
  insert into public.profiles (id, email, full_name)
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
    from auth.users u
   where u.id = v_user_a
      or (v_user_b is not null and u.id = v_user_b)
  on conflict (id) do nothing;

  insert into studies (id, name, plan_key, created_by, created_at, updated_at)
  values (v_study, 'Estudio Beltrán & Asociados', 'trial', v_user_a,
          now() - interval '30 days', now() - interval '30 days')
  on conflict (id) do nothing;

  -- Study + the wizard's membership path: init_study_defaults creates the
  -- fixed Dueño role, the owner's ACTIVE membership and the five default
  -- task statuses. Guarded: its roles insert has no conflict clause, so it
  -- may only run against a study that does not exist yet. When the study is
  -- already there but the main user is not a member, the dataset belongs to
  -- another (unreachable) owner — point at attach-demo-user.sql instead of
  -- re-seeding, so the Dueño role insert cannot collide.
  if not exists (
    select 1 from memberships
    where study_id = v_study and user_id = v_user_a
  ) then
    if exists (
      select 1 from roles where study_id = v_study and name = 'Dueño'
    ) then
      raise notice 'seed.sql: study % already exists but % is not a member — run supabase/attach-demo-user.sql to attach it; seed data left untouched', v_study, v_email_a;
    else
      perform public.init_study_defaults(v_study, v_user_a);
    end if;
  end if;

  -- Cases (S07): two expedientes, one already carrying pruebas.
  insert into cases (id, study_id, caratula, numero, juzgado, fuero, tipo,
                     jurisdiccion, source, created_by, created_at, updated_at,
                     last_activity_at)
  values
    (
      'c0000000-0000-4000-8000-000000000001', v_study,
      'Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos',
      '90.111/2026', 'Juzgado Civil y Comercial N° 4', 'Civil y Comercial', 'Judicial',
      'Ciudad Autónoma de Buenos Aires', 'manual', v_user_a,
      now() - interval '10 days', now() - interval '2 days', now() - interval '2 days'
    ),
    (
      'c0000000-0000-4000-8000-000000000002', v_study,
      'Pérez, Juan c/ Constructora del Sur SRL s/ despido',
      '91.222/2026', 'Juzgado de Trabajo N° 2', 'Laboral', 'Judicial',
      'Provincia de Buenos Aires', 'manual', v_user_a,
      now() - interval '5 days', now() - interval '1 day', now() - interval '1 day'
    )
  on conflict (id) do nothing;

  -- Directory person feeding the prueba's informante picker (S12).
  insert into persons (id, study_id, nombre, tipo, contactos, created_by,
                       created_at, updated_at)
  values (
    'd0000000-0000-4000-8000-000000000001', v_study,
    'Estudio Contable Rivadavia', 'juridica',
    '{"email": "contabilidad@example.com"}'::jsonb, v_user_a,
    now() - interval '9 days', now() - interval '9 days'
  )
  on conflict (id) do nothing;

  -- Pruebas + plazos (S12 / F03): the plazos trigger computes fecha_limite —
  -- seed rows NEVER write it by hand (the DB owns the computation).
  insert into pruebas (id, study_id, case_id, type, titulo, informante_person_id,
                       estado, fecha_efectiva, created_by, created_at, updated_at)
  values
    (
      'e0000000-0000-4000-8000-000000000001', v_study,
      'c0000000-0000-4000-8000-000000000001',
      'informativa', 'Informe contable del demandado',
      'd0000000-0000-4000-8000-000000000001',
      'proveida', date '2026-11-02', v_user_a,
      now() - interval '10 days', now() - interval '10 days'
    ),
    (
      'e0000000-0000-4000-8000-000000000002', v_study,
      'c0000000-0000-4000-8000-000000000002',
      'testimonial', 'Testigo del contrato de locación',
      null, 'proveida', date '2026-11-16', v_user_a,
      now() - interval '3 days', now() - interval '3 days'
    )
  on conflict (id) do nothing;

  insert into plazos (id, study_id, case_id, prueba_id, concepto, tipo, cantidad,
                      fecha_efectiva, estado_cycle, source, created_by,
                      created_at, updated_at)
  values
    (
      'f0000000-0000-4000-8000-000000000001', v_study,
      'c0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001',
      'Contestar el informe pericial', 'habiles', 10,
      date '2026-11-02', 1, 'prueba', v_user_a,
      now() - interval '10 days', now() - interval '10 days'
    ),
    (
      'f0000000-0000-4000-8000-000000000002', v_study,
      'c0000000-0000-4000-8000-000000000002',
      'e0000000-0000-4000-8000-000000000002',
      'Notificar al testigo', 'corridos', 5,
      date '2026-11-16', 1, 'prueba', v_user_a,
      now() - interval '3 days', now() - interval '3 days'
    )
  on conflict (id) do nothing;

  -- Unread in-app notification for the bell (S21). dedupe_key keeps the
  -- reminder jobs idempotent; this seed row uses the same discipline.
  insert into notifications (id, study_id, user_id, category, title, body,
                             deep_link, payload, channel, dedupe_key,
                             created_at, updated_at)
  values (
    '10000000-0000-4000-8000-000000000001', v_study, v_user_a,
    'sistemas_judiciales',
    'Vence en 3 días: Contestar el informe pericial',
    'El plazo de Gómez, Rosa c/ Empresa de Luz S.A. vence el 2026-11-16.',
    '/expedientes/c0000000-0000-4000-8000-000000000001?tab=pruebas',
    '{}'::jsonb, 'in_app', 'seed:plazo:f0000000-0000-4000-8000-000000000001:day_before',
    now() - interval '1 day', now() - interval '1 day'
  )
  on conflict (id) do nothing;

  -- WhatsApp inbox (Module A, M1): one open conversation with the bot's
  -- reply. provider_message_id is the Meta idempotency key
  -- (uq_wa_messages_provider_id).
  insert into wa_contacts (id, study_id, phone_e164, display_name, opt_in,
                           opt_in_at, created_at, updated_at)
  values (
    '11000000-0000-4000-8000-000000000001', v_study,
    '+5491155550101', 'Marina Duarte', true,
    now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'
  )
  on conflict (id) do nothing;

  insert into wa_conversations (id, study_id, contact_id, status,
                                last_inbound_at, window_expires_at,
                                unread_from_client, last_message_preview,
                                created_at, updated_at)
  values (
    '12000000-0000-4000-8000-000000000001', v_study,
    '11000000-0000-4000-8000-000000000001', 'bot',
    now() - interval '1 hour', now() + interval '23 hours',
    1, 'Hola, ¿me pueden ayudar con una consulta?',
    now() - interval '4 days', now() - interval '1 hour'
  )
  on conflict (id) do nothing;

  insert into wa_messages (id, study_id, conversation_id, direction, provider,
                           provider_message_id, message_type, body, status,
                           created_at, updated_at)
  values
    (
      '13000000-0000-4000-8000-000000000001', v_study,
      '12000000-0000-4000-8000-000000000001', 'in', 'whatsapp_cloud_api',
      'wamid.SEED-INBOUND-1', 'text',
      'Hola, ¿me pueden ayudar con una consulta?', 'received',
      now() - interval '1 hour', now() - interval '1 hour'
    ),
    (
      '13000000-0000-4000-8000-000000000002', v_study,
      '12000000-0000-4000-8000-000000000001', 'out', 'whatsapp_cloud_api',
      null, 'text',
      '¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?', 'sent',
      now() - interval '1 hour', now() - interval '1 hour'
    )
  on conflict (id) do nothing;

  raise notice 'seed.sql applied: study % attached to % — sign in with that account to walk the M1 flow', v_study, v_email_a;
end $$;

-- Done: sign in as the MAIN demo account (prueba.abogapp@gmail.com, the
-- password you chose in run-order step 1) to walk the M1 flow (case list →
-- detail → pruebas → bell → bandeja). If you also created the optional
-- outsider (outsider@example.com), it belongs to NO study — use it for the
-- RLS second-user test (it must read zero rows of study 1).

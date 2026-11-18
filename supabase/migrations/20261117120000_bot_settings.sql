-- ============================================================================
-- Migration: bot_settings — study-level WhatsApp bot configuration (Unit 1
-- of the WhatsApp phase: the "admin de mensajes" gap).
--
-- Why this exists: Module A's bot copy was hardcoded (lib/data/bot.ts had the
-- greeting; the off-hours and handoff strings had no home at all). The admin
-- screen /configuracion/bot lets members edit the three message strings and
-- switch the bot on/off — this table stores those values per study.
--
-- Target     : Supabase (PostgreSQL 15+). Runs AFTER the already-applied
--              20261114120000_init.sql and 20261115120000_form_gaps.sql —
--              additive only; those files are never edited retroactively.
-- Idempotent : safe to re-run — create table if not exists, drop trigger if
--              exists, drop policy if exists, on conflict do nothing,
--              create or replace function, add column if not exists.
-- Seed       : supabase/seed.sql needs no change. The seeded study already
--              exists when this runs, so the backfill below gives it a row;
--              NEW studies get one from init_study_defaults(), upgraded in
--              this same file and mirrored in replica/schema.sql.
-- Encoding   : UTF-8, no BOM
-- Naming     : identifiers and comments in English; status values use the
--              Spanish domain vocabulary (single-language product, es-AR).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. bot_settings — ONE row per study (study_id IS the primary key).
--
-- The three text defaults are byte-identical to DEFAULT_BOT_SETTINGS in
-- lib/data/bot.ts — keep them in sync:
--   * greeting  = the GREETING_REPLY the bot has always answered with (the
--                  e2e baseline asserts that exact string);
--   * off_hours / handoff = the fresh [UI copy] of WA-009 / WA-013 in
--                  replica/whatsapp-bot.md. M1 has no after-hours or handoff
--                  RULE yet (flows 7 and 6 arrive with Unit 2); the strings
--                  ship stored and editable now so that unit needs no second
--                  migration.
-- The length checks mirror the data layer's validation (updateBotSettings,
-- BOT_MESSAGE_MAX = 500) as defence in depth.
-- ----------------------------------------------------------------------------
create table if not exists bot_settings (
  study_id uuid primary key references studies (id) on delete cascade,
  enabled boolean not null default true,
  greeting text not null
    default '¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?'
    check (char_length(greeting) between 1 and 500),
  off_hours text not null
    default 'Estamos fuera de horario: de lunes a viernes de 9 a 18 respondemos las consultas de una persona. El asistente sigue tomando tus datos a cualquier hora y el próximo día hábil te respondemos.'
    check (char_length(off_hours) between 1 and 500),
  handoff text not null
    default 'Te paso con una persona del estudio. En horario hábil te responden el mismo día; si es fuera de horario, el próximo día hábil.'
    check (char_length(handoff) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at maintenance: the init migration's DO loop only covered the
-- tables that existed WHEN IT RAN, so a table created later must attach the
-- trigger explicitly (on a fresh build replica/schema.sql's end-of-file loop
-- covers it — see the comment next to that loop).
drop trigger if exists set_updated_at on bot_settings;
create trigger set_updated_at before update on bot_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. RLS — the uniform tenant rule, split by verb (the schema.sql policy
-- group is one combined policy; here the three verbs are written out so the
-- app's upsert-on-missing INSERT is covered explicitly and DELETE is NOT
-- granted a policy on purpose — nothing deletes settings rows, and a member
-- who somehow removed one would simply get the defaults re-created).
--
-- Seed rows (the backfill below and init_study_defaults) are written by the
-- migration/definer role, which bypasses RLS; members read and edit through
-- these policies. Any member may edit — M1 has no finer role gate (see
-- whatsapp-bot.md §7).
-- ----------------------------------------------------------------------------
alter table bot_settings enable row level security;

drop policy if exists bot_settings_select on bot_settings;
create policy bot_settings_select on bot_settings
  for select using (is_member(study_id));

drop policy if exists bot_settings_update on bot_settings;
create policy bot_settings_update on bot_settings
  for update using (is_member(study_id)) with check (is_member(study_id));

drop policy if exists bot_settings_insert on bot_settings;
create policy bot_settings_insert on bot_settings
  for insert with check (is_member(study_id));

-- Grants (Supabase-specific, same reasoning as the init migration's GRANTS
-- section): the API roles need table privileges BEFORE RLS can filter rows —
-- a GRANT plus RLS answers an empty set, no GRANT answers permission denied.
grant select, insert, update
  on bot_settings to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Backfill — every study that already exists gets the default row (the
-- live database has one seeded study). Idempotent: study_id is the primary
-- key, so a re-run inserts nothing.
-- ----------------------------------------------------------------------------
insert into bot_settings (study_id)
select id from studies
on conflict (study_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. init_study_defaults — the SAME bootstrap the previous migrations define
-- (signature, security context and the roles / membership / task_statuses /
-- case_stages statements are byte-compatible), extended to seed the default
-- bot_settings row so NEW studies answer with the default copy from day one.
-- `create or replace` upgrades the function in place for both paths: the
-- wizard RPC and the seed.sql call. `on conflict do nothing` keeps a study's
-- edits when the function re-runs.
-- ----------------------------------------------------------------------------
create or replace function public.init_study_defaults(
  p_study_id uuid,
  p_owner_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_role uuid;
begin
  insert into roles (study_id, name, is_fixed, permissions)
  values (p_study_id, 'Dueño', true, '[]')   -- TODO(gap): permission keys
  returning id into v_role;

  insert into memberships (study_id, user_id, role_id, status, accepted_at)
  values (p_study_id, p_owner_id, v_role, 'active', now());

  -- The five evidenced default states (S16); names editable per study.
  insert into task_statuses (study_id, key, name, position, is_default)
  values
    (p_study_id, 'pendiente',      'Pendiente',      1, true),
    (p_study_id, 'en_curso',       'En curso',       2, true),
    (p_study_id, 'para_revisar',   'Para revisar',   3, true),
    (p_study_id, 'completada',     'Completada',     4, true),
    (p_study_id, 'cancelada',      'Cancelada',      5, true)
  on conflict (study_id, key) do nothing;

  -- Default case stages (Etapas) — same ASSUMPTION and same names as the
  -- backfill above: no stage names are evidenced in the recon, so this
  -- five-step set is our own default. Idempotent: a study that already has
  -- them (or a renamed one) is left untouched.
  insert into case_stages (study_id, name, position)
  values
    (p_study_id, 'Inicial',      1),
    (p_study_id, 'Trámite',      2),
    (p_study_id, 'Prueba',       3),
    (p_study_id, 'Sentencia',    4),
    (p_study_id, 'Ejecución',    5)
  on conflict (study_id, name) do nothing;

  -- WhatsApp bot settings (Unit 1): one row per study so the admin screen
  -- (/configuracion/bot) and the webhook always find values; the COLUMN
  -- DEFAULTS above supply the copy, so this insert stays in step with them
  -- automatically. Idempotent: a study that already has the row keeps it.
  insert into bot_settings (study_id)
  values (p_study_id)
  on conflict (study_id) do nothing;

  -- TODO(gap): default event categories (6 names / 11 colors) are not
  -- evidenced; seed here once replica-design confirms them.
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. UNIT-2 PREP (Meta's 24-hour customer-service window): the window is
-- computed from the LAST inbound client message, and lib/supabase/
-- meta-webhook.ts already writes `last_inbound_at` on every delivery. The
-- column has existed since the init migration (20261114120000_init.sql) and
-- in replica/schema.sql — this idempotent guard keeps any database created
-- before that column landed in step, so Unit 2 never needs its own
-- migration for it.
-- ----------------------------------------------------------------------------
alter table wa_conversations
  add column if not exists last_inbound_at timestamptz;

-- ============================================================================
-- schema.sql — clean-room rebuild: Module B (critical cases + procedural
-- deadlines + alerts) and Module A (WhatsApp client intake).
-- Reference for Module B: Veredicta (see recon.md). Clean-room: no code,
-- prompts, copy or data from the original product.
--
-- Target     : PostgreSQL 15+ on Supabase
-- Encoding   : UTF-8, no BOM
-- Time       : timestamptz stored in UTC. Pure calendar dates use `date` and
--              are interpreted in America/Argentina/Buenos_Aires (UTC-3, no
--              DST since 2009 — feriados/feria are date-based, not tz-based).
-- Money      : integer cents + currency (char(3)).
-- Access     : Supabase Row Level Security (RLS). Policies at the bottom of
--              this file. Service role (jobs, webhooks) bypasses RLS.
-- Naming     : identifiers and comments in English; status keys use Spanish
--              domain vocabulary (single-language product, es-AR). Tables
--              mirroring an upstream system (Stripe, Meta) keep that
--              system's vocabulary.
--
-- Marked TODO(gap) : not decidable from the recon inputs — must be resolved
--                    during build, never invented silently.
-- Marked phase 2   : built now (schema stability) but NOT part of the MVP.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ----------------------------------------------------------------------------
-- Generic helpers
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Immutable wrapper so unaccent() can be used in generated columns / indexes.
create or replace function public.f_unaccent(p_text text) returns text
  language sql immutable parallel safe strict as $$
  select unaccent('unaccent', p_text);
$$;

-- ----------------------------------------------------------------------------
-- plans (reference data). Quota columns are enforced in the MVP; prices and
-- Stripe linkage are phase 2 billing (see subscriptions).
-- ----------------------------------------------------------------------------
create table plans (
  key text primary key
    check (key in ('trial', 'pro', 'max', 'max6x')),
  name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'ARS' check (char_length(currency) = 3),
  seats integer not null default 1 check (seats >= 1),
  -- TODO(gap): weekly AI quota per paid plan is not in the recon (only the
  -- trial "5 consultas" figure is evidenced). null = unlimited.
  ai_quota_weekly integer check (ai_quota_weekly is null or ai_quota_weekly >= 0),
  -- TODO(gap): which plan owns the evidenced "112 MB de 512 MB" meter is not
  -- stated; 512 MB is used as the trial default pending confirmation.
  storage_quota_bytes bigint not null default 536870912
    check (storage_quota_bytes > 0),
  is_trial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- profiles — one row per auth.users row (Supabase Auth).
-- ----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  photo_url text,
  locale text not null default 'es-AR',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  ai_effort text not null default 'medio'
    check (ai_effort in ('bajo', 'medio', 'alto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_profiles_email on profiles (email);

-- ----------------------------------------------------------------------------
-- studies — the organisation / tenant ("estudio jurídico").
-- ----------------------------------------------------------------------------
create table studies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  logo_url text,
  plan_key text not null default 'trial' references plans (key) on delete restrict,
  storage_used_bytes bigint not null default 0 check (storage_used_bytes >= 0),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  -- read-only mode after trial ends (enforced in the data layer, not RLS:
  -- the owner must still be able to reach billing to reactivate).
  read_only boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_studies_plan on studies (plan_key);
create index idx_studies_trial_ends on studies (trial_ends_at) where read_only = false;

-- ----------------------------------------------------------------------------
-- roles — 9 areas / 28 permissions (S27); Dueño is fixed and undeletable.
-- ----------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#3b82f6',
  is_fixed boolean not null default false,
  -- TODO(gap): the canonical 28 permission keys are not enumerated in the
  -- recon; only the count (28) and area count (9) are evidenced. Keys are
  -- validated as an array of <= 28 strings until the list is designed.
  permissions jsonb not null default '[]'
    check (jsonb_typeof(permissions) = 'array' and jsonb_array_length(permissions) <= 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_roles_study_name unique (study_id, name)
);
create index idx_roles_study on roles (study_id);

-- Limit: 50 roles per studio (S27). security definer so the count is not
-- filtered by the caller's RLS visibility.
create or replace function public.chk_role_limit() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  select count(*) into v_count from roles where study_id = new.study_id;
  if v_count >= 50 then
    raise exception 'role limit reached: max 50 roles per study';
  end if;
  return new;
end;
$$;
create trigger trg_role_limit before insert on roles
  for each row execute function public.chk_role_limit();

-- ----------------------------------------------------------------------------
-- memberships — user x study, with email invitations (S28).
-- ----------------------------------------------------------------------------
create table memberships (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  role_id uuid references roles (id) on delete set null,
  status text not null default 'invited'
    check (status in ('invited', 'active')),
  invite_email text,
  invite_token uuid not null default gen_random_uuid(),
  invite_expires_at timestamptz,
  invited_by uuid references profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_memberships_study on memberships (study_id);
create index idx_memberships_user on memberships (user_id);
create index idx_memberships_invite_email on memberships (invite_email);
create unique index uq_memberships_invite_token on memberships (invite_token);
create unique index uq_memberships_study_user
  on memberships (study_id, user_id) where user_id is not null;

-- Limit: a user can belong to at most 5 studies (account menu, recon nav).
-- security definer: the invoker's RLS view of `memberships` would undercount
-- the invitee's studies in other tenants.
create or replace function public.chk_membership_study_limit() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.user_id is null then
    return new;
  end if;
  select count(distinct study_id) into v_count
    from memberships where user_id = new.user_id;
  if v_count >= 5 then
    raise exception 'study limit reached: max 5 studies per user';
  end if;
  return new;
end;
$$;
create trigger trg_membership_study_limit
  before insert or update of user_id on memberships
  for each row execute function public.chk_membership_study_limit();

-- RLS helpers (security definer so they can read memberships under RLS).
create or replace function public.is_member(p_study_id uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.study_id = p_study_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_permission(p_study_id uuid, p_permission text) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from memberships m
      join roles r on r.id = m.role_id
     where m.study_id = p_study_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and (r.is_fixed or jsonb_exists(r.permissions, p_permission))
  );
$$;

-- ----------------------------------------------------------------------------
-- case_stages — "Etapas" settings; counts_as_active drives Inicio (S30).
-- ----------------------------------------------------------------------------
create table case_stages (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  counts_as_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_case_stages_study_name unique (study_id, name)
);
create index idx_case_stages_study on case_stages (study_id, position);

-- ----------------------------------------------------------------------------
-- integrations — judicial portal connections (S25, F01).
-- One ACTIVE integration per (study, portal) — partial unique index below.
-- Credentials are encrypted by the app (AES-GCM, key in Supabase Vault /
-- platform KMS) before insert; never stored or logged in plaintext.
-- ----------------------------------------------------------------------------
create table integrations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  portal text not null
    check (portal in ('pjn', 'mev', 'eje', 'iol', 'sed', 'pcj')),
  credentials_encrypted text,
  status text not null default 'conectada'
    check (status in ('conectada', 'sincronizando', 'error', 'desconectada')),
  last_sync_at timestamptz,
  next_retry_at timestamptz,
  -- F01: five failed attempts, then stop (auto-retry window 2 min - 6 h).
  consecutive_failures integer not null default 0
    check (consecutive_failures between 0 and 5),
  last_error text,
  -- MEV variant = email-forwarding setup, no credentials (6 steps).
  email_forwarding jsonb,
  config jsonb not null default '{}',
  connected_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MEV has no portal credentials; every other portal requires them.
  constraint chk_integration_creds
    check (portal = 'mev' or credentials_encrypted is not null)
);
create index idx_integrations_study on integrations (study_id);
create index idx_integrations_status on integrations (status)
  where status <> 'desconectada';
-- HARD CONSTRAINT: one active Integration per (study, portal).
create unique index uq_integrations_active
  on integrations (study_id, portal) where status <> 'desconectada';

-- ----------------------------------------------------------------------------
-- sync_runs — one row per sync attempt (status chips + retry bookkeeping).
-- ----------------------------------------------------------------------------
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  integration_id uuid not null references integrations (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'ok', 'error', 'rate_limited', 'stopped')),
  attempt integer not null default 1 check (attempt >= 1),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pulled integer not null default 0 check (pulled >= 0),
  error text,
  backoff_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sync_runs_integration on sync_runs (integration_id, started_at desc);
create index idx_sync_runs_study on sync_runs (study_id, started_at desc);
create unique index uq_sync_runs_active
  on sync_runs (integration_id) where status = 'running';

-- ----------------------------------------------------------------------------
-- cases — manual + synced expedientes (S07/S08).
-- HARD CONSTRAINT: one carátula per study (soft-deleted rows excluded).
-- ----------------------------------------------------------------------------
create table cases (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  caratula text not null check (char_length(caratula) between 1 and 500),
  -- accent/typo tolerant search (S07) — generated, indexed below.
  caratula_search text generated always as (lower(f_unaccent(caratula))) stored,
  numero text,
  juzgado text,
  fuero text,
  tipo text,
  etapa_id uuid references case_stages (id) on delete set null,
  jurisdiccion text,
  source text not null default 'manual'
    check (source in ('manual', 'portal')),
  integration_id uuid references integrations (id) on delete set null,
  favorito boolean not null default false,
  archivado boolean not null default false,
  sync_paused boolean not null default false,
  last_activity_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_case_source
    check ((source = 'manual' and integration_id is null) or source = 'portal')
);
-- Composite key used by child composite foreign keys (a UNIQUE CONSTRAINT is
-- required as an FK target; a bare unique index is not portable for that).
alter table cases add constraint uq_cases_id_study unique (id, study_id);
create unique index uq_cases_study_caratula
  on cases (study_id, caratula) where deleted_at is null;
create index idx_cases_study_activity on cases (study_id, last_activity_at desc);
create index idx_cases_study_archived on cases (study_id, archivado)
  where deleted_at is null;
create index idx_cases_study_etapa on cases (study_id, etapa_id);
create index idx_cases_integration on cases (integration_id);
create index idx_cases_caratula_trgm on cases using gin (caratula_search gin_trgm_ops);
create index idx_cases_deleted on cases (deleted_at) where deleted_at is not null;

-- ----------------------------------------------------------------------------
-- movements — the study's hand-entered movement log (S09, must).
-- ----------------------------------------------------------------------------
create table movements (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  fecha date not null default current_date,
  tipo text,
  detalle text not null check (char_length(detalle) between 1 and 4000),
  pinned boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_movements_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create index idx_movements_case on movements (case_id, fecha desc);
create index idx_movements_study on movements (study_id, fecha desc);
create index idx_movements_created_by on movements (created_by);

-- ----------------------------------------------------------------------------
-- actuaciones — court publications pulled from a portal (S10/S11).
-- HARD CONSTRAINT (sync idempotency): unique (case_id, portal_ref) — the
-- connector must UPSERT, never duplicate, no matter how often it re-reads.
-- ----------------------------------------------------------------------------
create table actuaciones (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  integration_id uuid references integrations (id) on delete set null,
  portal_ref text not null,
  fecha date,
  detalle text,
  tipo text,
  fojas integer check (fojas is null or fojas >= 0),
  estado text not null default 'por_sincronizar'
    check (estado in (
      'disponible', 'por_sincronizar', 'sincronizando',
      'solo_en_portal', 'con_error', 'pendiente_de_plan', 'sin_espacio'
    )),
  document_path text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_actuaciones_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create unique index uq_actuaciones_case_portal_ref
  on actuaciones (case_id, portal_ref);
create index idx_actuaciones_case_fecha on actuaciones (case_id, fecha desc);
create index idx_actuaciones_study_estado on actuaciones (study_id, estado);
create index idx_actuaciones_integration on actuaciones (integration_id);

-- ----------------------------------------------------------------------------
-- novedades — the unified "Novedades judiciales" feed (S05/S06).
-- read state is per member (novedade_reads).
-- ----------------------------------------------------------------------------
create table novedades (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  actuacion_id uuid references actuaciones (id) on delete set null,
  fecha date not null default current_date,
  tipo text not null default 'actuacion',
  archivos jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_novedades_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
-- One novedad per actuación (no duplicate notices when sync re-reads).
create unique index uq_novedades_actuacion
  on novedades (case_id, actuacion_id) where actuacion_id is not null;
create index idx_novedades_study_fecha on novedades (study_id, fecha desc);
create index idx_novedades_case on novedades (case_id, fecha desc);

create table novedade_reads (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  novedade_id uuid not null references novedades (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_novedade_reads on novedade_reads (novedade_id, user_id);
create index idx_novedade_reads_user on novedade_reads (user_id, read_at desc);
create index idx_novedade_reads_study on novedade_reads (study_id);

-- ----------------------------------------------------------------------------
-- inbound_emails — MEV email-forwarding ingestion (should-have connector).
-- provider_message_id = idempotency key for retried inbound webhooks.
-- ----------------------------------------------------------------------------
create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  integration_id uuid not null references integrations (id) on delete cascade,
  provider_message_id text not null,
  from_addr text not null,
  subject text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  raw jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_inbound_emails_provider_id
  on inbound_emails (provider_message_id);
create index idx_inbound_emails_integration on inbound_emails (integration_id, received_at desc);
create index idx_inbound_emails_unprocessed on inbound_emails (received_at)
  where processed_at is null;

-- ----------------------------------------------------------------------------
-- persons — studio directory feeding partes + pruebas informantes (S12/S14).
-- ----------------------------------------------------------------------------
create table persons (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 200),
  tipo text not null default 'fisica'
    check (tipo in ('fisica', 'juridica')),
  contactos jsonb not null default '{}',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_persons_study on persons (study_id, nombre);

create table case_partes (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null references persons (id) on delete cascade,
  tipo text not null
    check (tipo in ('representada', 'contraparte', 'otro')),
  abogados jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_case_partes_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create unique index uq_case_partes on case_partes (case_id, person_id);
create index idx_case_partes_person on case_partes (person_id);
create index idx_case_partes_study on case_partes (study_id);

-- ============================================================================
-- DEADLINES — the crown jewel: plazos engine (F03, S12, S30, S34).
--
-- Rules encoded here (evidence: recon F03):
--   * count starts the day AFTER fecha_efectiva (both corridos and habiles)
--   * habiles skip weekends, national holidays, judicial feria (January and
--     July) and the study's días inhábiles
--   * provincial holidays NEVER count (no such kind exists in calendar_days —
--     structural exclusion, not a runtime filter)
--   * corridos: NO roll-over when the last day is inhábil
--   * horas: includes nights (exact start time TODO(gap), see function)
-- ============================================================================

-- One calendar for feriados + feria + días inhábiles, with Origen (S30):
-- study_id is null  -> origen "Del sistema", written by migrations/service
--                      role only (RLS denies writes on null-study rows).
-- study_id set      -> origen "De tu estudio", written by members.
create table calendar_days (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references studies (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('feriado', 'feria', 'inhabil')),
  name text not null default '',
  origen text generated always as
    (case when study_id is null then 'sistema' else 'estudio' end) stored,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_calendar_days_system
  on calendar_days (day, kind) where study_id is null;
create unique index uq_calendar_days_study
  on calendar_days (study_id, day, kind) where study_id is not null;
create index idx_calendar_days_day on calendar_days (day);
create index idx_calendar_days_study on calendar_days (study_id, day);

-- Is this date a working day for this study?
create or replace function public.es_habil(p_day date, p_study_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select extract(isodow from p_day)::int not in (6, 7)
     and not exists (
       select 1 from calendar_days c
       where c.day = p_day
         and (c.study_id is null or c.study_id = p_study_id)
     );
$$;

-- Compute the deadline instant (always timestamptz, ART wall-clock encoded).
-- Callers never compute plazos themselves: the plazos trigger below calls
-- this function, so UI, API and jobs cannot disagree.
create or replace function public.compute_fecha_limite(
  p_study_id uuid,
  p_fecha_efectiva date,
  p_tipo text,
  p_cantidad int
) returns timestamptz
  language plpgsql stable set search_path = public as $$
declare
  v_day date := p_fecha_efectiva;
  v_count integer := 0;
  v_guard integer := 0;
begin
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 5000 then
    raise exception 'invalid plazo quantity: %', p_cantidad;
  end if;

  if p_tipo = 'horas' then
    -- TODO(gap): the exact start time of an "horas" plazo is not documented
    -- in the recon; default = midnight of fecha_efectiva in ART.
    return (p_fecha_efectiva + (p_cantidad || ' hours')::interval)
           at time zone 'America/Argentina/Buenos_Aires';
  elsif p_tipo = 'corridos' then
    -- Count starts the day after; NO roll-over if the last day is inhábil.
    v_day := p_fecha_efectiva + p_cantidad;
    return (v_day + interval '1 day' - interval '1 second')
           at time zone 'America/Argentina/Buenos_Aires';
  elsif p_tipo = 'habiles' then
    while v_count < p_cantidad loop
      v_day := v_day + 1;
      v_guard := v_guard + 1;
      if v_guard > 3660 then
        raise exception 'plazo exceeds 10 years of calendar time';
      end if;
      if public.es_habil(v_day, p_study_id) then
        v_count := v_count + 1;
      end if;
    end loop;
    return (v_day + interval '1 day' - interval '1 second')
           at time zone 'America/Argentina/Buenos_Aires';
  end if;

  raise exception 'unknown plazo type: %', p_tipo;
end;
$$;

-- ----------------------------------------------------------------------------
-- pruebas — evidence tracking, six types, per-type status sets (S12, must).
-- ----------------------------------------------------------------------------
create table pruebas (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  type text not null
    check (type in ('documental', 'informativa', 'confesional',
                    'testimonial', 'pericial', 'otras')),
  titulo text not null check (char_length(titulo) between 1 and 300),
  informante_person_id uuid references persons (id) on delete set null,
  parte text,
  -- New pruebas start in "Proveida" (F03).
  estado text not null default 'proveida',
  fecha_efectiva date not null default current_date,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_pruebas_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create index idx_pruebas_case on pruebas (case_id);
create index idx_pruebas_study on pruebas (study_id, type);
create index idx_pruebas_informante on pruebas (informante_person_id);

-- Per-type status sets. Seeded with the only documented set (Informativa,
-- S12). Validation is skipped for types with no rows yet.
-- TODO(gap): the other five type sets are not in the recon — fill from our
-- own product design after screenshot capture, never from their code.
create table prueba_status_defs (
  prueba_type text not null
    check (prueba_type in ('documental', 'informativa', 'confesional',
                           'testimonial', 'pericial', 'otras')),
  estado text not null,
  position integer not null default 0,
  primary key (prueba_type, estado)
);

create or replace function public.chk_prueba_estado() returns trigger
  language plpgsql as $$
begin
  if exists (select 1 from prueba_status_defs where prueba_type = new.type)
     and not exists (
       select 1 from prueba_status_defs
       where prueba_type = new.type and estado = new.estado
     ) then
    raise exception 'estado % not valid for prueba type %', new.estado, new.type;
  end if;
  return new;
end;
$$;
create trigger trg_prueba_estado before insert or update of estado on pruebas
  for each row execute function public.chk_prueba_estado();

create table prueba_estado_hist (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  prueba_id uuid not null references pruebas (id) on delete cascade,
  estado text not null,
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_prueba_hist_prueba on prueba_estado_hist (prueba_id, changed_at desc);
create index idx_prueba_hist_study on prueba_estado_hist (study_id);

-- ----------------------------------------------------------------------------
-- plazos — one row per (prueba, estado-cycle). A status change RESTARTS the
-- plazo from the new state (F03): the API inserts a new row with
-- estado_cycle + 1; the previous row stays as history and stops reminding.
--
-- HARD CONSTRAINT: fecha_limite is unique per (case, prueba, estado-cycle)
-- — at most one deadline per cycle — and is indexed for the reminder job.
-- ----------------------------------------------------------------------------
create table plazos (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  prueba_id uuid references pruebas (id) on delete cascade,
  concepto text not null check (char_length(concepto) between 1 and 300),
  tipo text not null check (tipo in ('horas', 'corridos', 'habiles')),
  cantidad integer not null check (cantidad between 1 and 5000),
  fecha_efectiva date not null,
  fecha_limite timestamptz not null,
  estado_cycle integer not null default 1 check (estado_cycle >= 1),
  source text not null default 'prueba'
    check (source in ('prueba', 'manual', 'tool')),
  reminders_sent text[] not null default '{}'
    check (reminders_sent <@ array['day_before', 'day_of', 'hour_before']::text[]),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_plazos_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
-- The DB owns the computation: fecha_limite is recomputed on every write of
-- its inputs, so no code path can disagree with the engine.
create or replace function public.trg_plazos_compute() returns trigger
  language plpgsql as $$
begin
  new.fecha_limite := public.compute_fecha_limite(
    new.study_id, new.fecha_efectiva, new.tipo, new.cantidad
  );
  return new;
end;
$$;
create trigger trg_plazos_compute
  before insert or update of study_id, fecha_efectiva, tipo, cantidad on plazos
  for each row execute function public.trg_plazos_compute();

-- HARD CONSTRAINT: one fecha_limite per (case, prueba, estado-cycle).
create unique index uq_plazos_case_prueba_cycle
  on plazos (case_id, prueba_id, estado_cycle) where prueba_id is not null;
create index idx_plazos_fecha_limite on plazos (fecha_limite);
create index idx_plazos_study_fecha on plazos (study_id, fecha_limite);
create index idx_plazos_case_fecha on plazos (case_id, fecha_limite desc);
create index idx_plazos_prueba_cycle on plazos (prueba_id, estado_cycle desc);
-- Reminder-job scan: upcoming, not yet fully reminded.
create index idx_plazos_reminder_scan on plazos (fecha_limite)
  where not (reminders_sent @> array['day_of']::text[]);

-- Guard for ops: warns when the feriado calendar looks empty for a range.
-- TODO(gap): official Argentine holiday dates for 2026/2027 are NOT in the
-- recon inputs and must be loaded from an authoritative source before M2.
create or replace function public.assert_calendar_ready(p_from date, p_to date)
  returns void language plpgsql stable set search_path = public as $$
begin
  if not exists (
    select 1 from calendar_days
    where kind = 'feriado' and study_id is null and day between p_from and p_to
  ) then
    raise warning 'calendar not ready: no system feriados between % and %', p_from, p_to;
  end if;
end;
$$;

-- Seed feria judicial (whole of January and July — recon F03 states
-- "January & July"; exact boundaries TODO(gap) pending jurisdiction check).
-- Idempotent; called by the yearly calendar-seed job.
create or replace function public.seed_feria_year(p_year integer)
  returns integer language plpgsql as $$
declare v_inserted integer := 0;
begin
  insert into calendar_days (study_id, day, kind, name)
  select null, d::date, 'feria', 'Feria judicial'
  from generate_series(
    make_date(p_year, 1, 1), make_date(p_year, 1, 31), interval '1 day'
  ) as d
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  insert into calendar_days (study_id, day, kind, name)
  select null, d::date, 'feria', 'Feria judicial'
  from generate_series(
    make_date(p_year, 7, 1), make_date(p_year, 7, 31), interval '1 day'
  ) as d
  on conflict do nothing;
  get diagnostics v_inserted = v_inserted + row_count;

  return v_inserted;
end;
$$;

-- ----------------------------------------------------------------------------
-- task_statuses — the five evidenced defaults + custom states (S16, must).
-- Rows are created per study by init_study_defaults(); keys are stable,
-- names/colors are editable per study.
-- ----------------------------------------------------------------------------
create table task_statuses (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  key text not null,
  name text not null,
  color text not null default '#64748b',
  position integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_task_statuses_study_key unique (study_id, key)
);
create index idx_task_statuses_study on task_statuses (study_id, position);

-- ----------------------------------------------------------------------------
-- tasks — studio-wide board (S16, F04, must). Task due dates are TYPED by
-- the user (never computed — F03 edge).
-- ----------------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid,
  -- cascade (not restrict): a study delete cascades tasks and task_statuses
  -- as siblings; RESTRICT would race their delete order and abort.
  status_id uuid not null references task_statuses (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 255),
  descripcion text not null default '',
  prioridad text not null default 'sin_prioridad'
    check (prioridad in ('alta', 'normal', 'baja', 'sin_prioridad')),
  responsable_id uuid references profiles (id) on delete set null,
  vence_at timestamptz,
  completed_at timestamptz,
  favorite boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'procurador_ia')),
  source_actuacion_id uuid references actuaciones (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_tasks_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade,
  -- vence_at sanity: allow up to one year of backfill (recording already
  -- overdue work), block absurd dates.
  constraint chk_task_vence check (
    vence_at is null or vence_at between created_at - interval '365 days'
                                      and created_at + interval '30 years'
  )
);
create index idx_tasks_study_status on tasks (study_id, status_id);
create index idx_tasks_case on tasks (case_id);
create index idx_tasks_responsable on tasks (responsable_id, vence_at);
create index idx_tasks_study_vence on tasks (study_id, vence_at)
  where vence_at is not null;
-- Reminder-job scan: open tasks with a due date.
create index idx_tasks_reminder_scan on tasks (vence_at)
  where vence_at is not null;
create index idx_tasks_source_actuacion on tasks (source_actuacion_id);
create unique index uq_tasks_study_source_actuacion
  on tasks (study_id, source_actuacion_id)
  where source = 'procurador_ia' and source_actuacion_id is not null;

-- completed_at is maintained by the DB from the status key.
create or replace function public.trg_tasks_completed() returns trigger
  language plpgsql as $$
declare v_key text;
begin
  select key into v_key from task_statuses where id = new.status_id;
  if v_key = 'completada' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger trg_tasks_completed before insert or update of status_id on tasks
  for each row execute function public.trg_tasks_completed();

-- ----------------------------------------------------------------------------
-- event_categories + events — shared studio agenda (S17, should).
-- TODO(gap): the six default category names and eleven colors are not in the
-- recon; defaults are seeded by the app once replica-design confirms them.
-- ----------------------------------------------------------------------------
create table event_categories (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_event_categories_study_name unique (study_id, name)
);
create index idx_event_categories_study on event_categories (study_id, position);

create table hearings (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid not null,
  fecha timestamptz not null,
  tipo text not null default 'presencial'
    check (tipo in ('online', 'presencial')),
  lugar text,
  citados jsonb not null default '[]',
  -- TODO(gap): notification status vocabulary is thin evidence (S13 index
  -- only); provisional set pending screenshot capture.
  notification_status text not null default 'pendiente'
    check (notification_status in ('pendiente', 'en_envio', 'completado')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_hearings_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create index idx_hearings_case_fecha on hearings (case_id, fecha);
create index idx_hearings_study_fecha on hearings (study_id, fecha);

create table events (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid,
  category_id uuid references event_categories (id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'audiencia', 'vencimiento', 'dia_inhabil')),
  plazo_id uuid references plazos (id) on delete cascade,
  hearing_id uuid references hearings (id) on delete cascade,
  calendar_day_id uuid references calendar_days (id) on delete cascade,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_events_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade,
  constraint chk_event_range check (end_at > start_at),
  -- source must agree with the row it points at (manual points nowhere).
  constraint chk_event_source_fk check (
    (source = 'manual'
       and plazo_id is null and hearing_id is null and calendar_day_id is null)
    or (source = 'vencimiento' and plazo_id is not null)
    or (source = 'audiencia' and hearing_id is not null)
    or (source = 'dia_inhabil' and calendar_day_id is not null)
  )
);
create index idx_events_study_start on events (study_id, start_at);
create index idx_events_case_start on events (case_id, start_at);
create index idx_events_category on events (category_id);
create index idx_events_source on events (source);

-- ----------------------------------------------------------------------------
-- documents + versions — one folder per case (S18/S19, should).
-- Quota is enforced by trigger below; antivirus is a pipeline status.
-- ----------------------------------------------------------------------------
create table documents (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid,
  folder_path text not null default '/',
  name text not null check (char_length(name) between 1 and 255),
  -- TODO(gap): only the task-attachment limit (25 MB, S16) is evidenced;
  -- the same limit is assumed for documents pending confirmation.
  size_bytes bigint not null
    check (size_bytes > 0 and size_bytes <= 26214400),
  storage_path text not null unique,
  mime_type text,
  uploaded_by uuid references profiles (id) on delete set null,
  version integer not null default 1 check (version >= 1),
  protected boolean not null default false,
  virus_status text not null default 'pending'
    check (virus_status in ('pending', 'clean', 'blocked')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_documents_case
    foreign key (case_id, study_id) references cases (id, study_id) on delete cascade
);
create index idx_documents_study_folder on documents (study_id, folder_path);
create index idx_documents_case on documents (case_id);
create index idx_documents_uploader on documents (uploaded_by);
create index idx_documents_deleted on documents (deleted_at)
  where deleted_at is not null;
create index idx_documents_name_trgm on documents using gin (name gin_trgm_ops);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  version integer not null check (version >= 1),
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null unique,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_document_versions unique (document_id, version)
);

-- Storage quota: reject the insert BEFORE it lands, then keep the counter.
create or replace function public.chk_document_quota() returns trigger
  language plpgsql set search_path = public as $$
declare
  v_quota bigint;
  v_used bigint;
begin
  select coalesce(p.storage_quota_bytes, 0), coalesce(s.storage_used_bytes, 0)
    into v_quota, v_used
    from studies s
    join plans p on p.key = s.plan_key
   where s.id = new.study_id;
  if v_used + new.size_bytes > v_quota then
    raise exception 'storage quota exceeded: % of % bytes',
      v_used + new.size_bytes, v_quota
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_document_quota before insert on documents
  for each row execute function public.chk_document_quota();

create or replace function public.maintain_storage_counter() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update studies
       set storage_used_bytes = storage_used_bytes + coalesce(new.size_bytes, 0)
     where id = new.study_id;
    return new;
  elsif tg_op = 'DELETE' then
    update studies
       set storage_used_bytes =
             greatest(0, storage_used_bytes - coalesce(old.size_bytes, 0))
     where id = old.study_id;
    return old;
  end if;
  return null;
end;
$$;
create trigger trg_storage_counter after insert or delete on documents
  for each row execute function public.maintain_storage_counter();

-- ----------------------------------------------------------------------------
-- notifications + preferences (S21, F06, must).
-- HARD CONSTRAINT: dedupe_key unique per user — reminder/digest jobs write
-- idempotently no matter how often they re-run.
-- ----------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  category text not null
    check (category in ('sistemas_judiciales', 'tareas', 'causas',
                        'equipo', 'facturacion', 'novedades_consejos')),
  title text not null,
  body text not null default '',
  deep_link text,
  payload jsonb not null default '{}',
  channel text not null default 'in_app'
    check (channel in ('in_app', 'email', 'push')),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_notifications_dedupe unique (user_id, dedupe_key)
);
create index idx_notifications_user_unread
  on notifications (user_id, created_at desc) where read_at is null;
create index idx_notifications_user_created on notifications (user_id, created_at desc);
create index idx_notifications_study on notifications (study_id, created_at desc);
create index idx_notifications_category on notifications (user_id, category);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  category text not null
    check (category in ('sistemas_judiciales', 'tareas', 'causas',
                        'equipo', 'facturacion', 'novedades_consejos')),
  in_app boolean not null default true,
  email boolean not null default true,
  push boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_notification_prefs unique (user_id, category)
);

-- ============================================================================
-- WHATSAPP MODULE A — designed from scratch (NO Veredicta reference).
-- Provider: Meta WhatsApp Business Cloud API (assumption — see
-- architecture.md for the Twilio tradeoff).
-- ============================================================================

create table wa_contacts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  display_name text not null default '',
  person_id uuid references persons (id) on delete set null,
  -- WhatsApp requires documented opt-in before the first message.
  opt_in boolean not null default false,
  opt_in_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_wa_contacts_study_phone on wa_contacts (study_id, phone_e164);
create index idx_wa_contacts_person on wa_contacts (person_id);

create table wa_conversations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  contact_id uuid not null references wa_contacts (id) on delete cascade,
  case_id uuid references cases (id) on delete set null,
  status text not null default 'bot'
    check (status in ('bot', 'humano', 'cerrada')),
  assigned_to uuid references profiles (id) on delete set null,
  handoff_reason text,
  last_inbound_at timestamptz,
  -- 24h customer-service window: after this instant only approved templates
  -- may be sent (Meta platform rule).
  window_expires_at timestamptz,
  unread_from_client integer not null default 0 check (unread_from_client >= 0),
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_wa_conversations_study_last
  on wa_conversations (study_id, updated_at desc);
create index idx_wa_conversations_status
  on wa_conversations (study_id, status);
create index idx_wa_conversations_contact on wa_conversations (contact_id);
create index idx_wa_conversations_window
  on wa_conversations (window_expires_at) where status <> 'cerrada';

create table wa_messages (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  conversation_id uuid not null references wa_conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  provider text not null default 'whatsapp_cloud_api',
  provider_message_id text,
  message_type text not null default 'text'
    check (message_type in ('text', 'template', 'image', 'document',
                            'interactive', 'location', 'button',
                            'reaction', 'unknown')),
  body text not null default '',
  payload jsonb not null default '{}',
  status text not null default 'sent'
    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  template_name text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_wa_messages_conversation on wa_messages (conversation_id, created_at);
create index idx_wa_messages_study on wa_messages (study_id, created_at desc);
-- Idempotency: Meta may deliver the same message more than once.
create unique index uq_wa_messages_provider_id
  on wa_messages (provider, provider_message_id)
  where provider_message_id is not null;

-- Webhook inbox: every Meta delivery is recorded ONCE (event_key unique),
-- then processed. Retries hit the unique key and become no-ops.
-- RLS enabled with NO policies: service role only.
create table wa_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider text not null default 'whatsapp_cloud_api',
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_wa_webhook_unprocessed on wa_webhook_events (received_at)
  where processed_at is null;

create table wa_appointment_slots (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  professional_user_id uuid references profiles (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  mode text not null default 'online'
    check (mode in ('online', 'presencial')),
  location text,
  status text not null default 'disponible'
    check (status in ('disponible', 'bloqueada')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_slot_range check (end_at > start_at)
);
create index idx_wa_slots_study_start on wa_appointment_slots (study_id, start_at);
create unique index uq_wa_slots_open
  on wa_appointment_slots (study_id, start_at,
    coalesce(professional_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'disponible';

create table wa_appointments (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  -- cascade (not restrict): sibling cascade order under a study delete is
  -- not guaranteed, and RESTRICT could abort the whole deletion.
  slot_id uuid not null references wa_appointment_slots (id) on delete cascade,
  conversation_id uuid references wa_conversations (id) on delete set null,
  contact_id uuid not null references wa_contacts (id) on delete cascade,
  case_id uuid references cases (id) on delete set null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'confirmada', 'cancelada', 'ausente')),
  booked_by text not null default 'bot'
    check (booked_by in ('bot', 'humano')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- HARD CONSTRAINT: one live booking per slot.
create unique index uq_wa_appointments_slot
  on wa_appointments (slot_id)
  where status in ('pendiente', 'confirmada');
create index idx_wa_appointments_study_start on wa_appointments (study_id, status);
create index idx_wa_appointments_conversation on wa_appointments (conversation_id);
create index idx_wa_appointments_contact on wa_appointments (contact_id);

-- ============================================================================
-- AI / ASSISTANT (could-haves; own implementation, no proprietary prompts)
-- ============================================================================

create table conversations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  case_id uuid references cases (id) on delete set null,
  title text not null default '',
  effort text not null default 'medio' check (effort in ('bajo', 'medio', 'alto')),
  forked_from uuid references conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_user on conversations (user_id, updated_at desc);
create index idx_conversations_study on conversations (study_id, updated_at desc);

create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conv_messages_conversation on conversation_messages (conversation_id, created_at);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  case_id uuid references cases (id) on delete set null,
  title text not null default '',
  version integer not null default 1 check (version >= 1),
  status text not null default 'borrador'
    check (status in ('borrador', 'abierto', 'en_documentos')),
  document_id uuid references documents (id) on delete set null,
  created_by uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_drafts_study_status on drafts (study_id, status);
create index idx_drafts_conversation on drafts (conversation_id);

-- Weekly AI quota per member (trial = 5 consultas; gate BEFORE the provider
-- call so a failed request never burns quota).
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  week_start date not null,
  consultas integer not null default 0 check (consultas >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_ai_usage_week unique (user_id, week_start)
);
create index idx_ai_usage_study on ai_usage (study_id, week_start);

-- ============================================================================
-- CONFIG & LIBRARY
-- ============================================================================

create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  entity text not null,
  entity_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_activity_study_time on activity_logs (study_id, occurred_at desc);
create index idx_activity_entity on activity_logs (entity, entity_id);

create table block_configs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  scope text not null default 'study' check (scope in ('user', 'study')),
  owner_id uuid references profiles (id) on delete cascade,
  blocks jsonb not null default '[]',
  layout jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_block_scope check ((scope = 'user') = (owner_id is not null))
);
create unique index uq_block_configs_study
  on block_configs (study_id) where scope = 'study';
create unique index uq_block_configs_user
  on block_configs (study_id, owner_id) where scope = 'user';

-- Our own smaller template library (NOT their 750+ models: skip row).
create table templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  materia text,
  origen text,
  tipo text,
  tags text[] not null default '{}',
  content text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_templates_materia on templates (materia);
create index idx_templates_tags on templates using gin (tags);
create index idx_templates_title_trgm on templates using gin (title gin_trgm_ops);

create table template_favorites (
  template_id uuid not null references templates (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (template_id, user_id)
);
create index idx_template_favorites_user on template_favorites (user_id);

-- ============================================================================
-- BILLING — PHASE 2 (schema kept now for quota FKs; not in the MVP build)
-- ============================================================================

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null unique references studies (id) on delete cascade,
  plan_key text not null references plans (key) on delete restrict,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled')),
  cycle text not null default 'monthly'
    check (cycle in ('monthly', 'annual')),
  seats integer not null default 1 check (seats >= 1),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_subscriptions_status on subscriptions (status);
create index idx_subscriptions_period_end on subscriptions (current_period_end);

create table fin_categorias (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 120),
  presupuesto_mensual_cents integer not null default 0
    check (presupuesto_mensual_cents >= 0),
  currency text not null default 'ARS' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_fin_categorias unique (study_id, nombre)
);
create index idx_fin_categorias_study on fin_categorias (study_id);

create table fin_movements (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies (id) on delete cascade,
  case_id uuid references cases (id) on delete set null,
  categoria_id uuid references fin_categorias (id) on delete set null,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto_cents bigint not null check (monto_cents > 0),
  currency text not null default 'ARS' check (char_length(currency) = 3),
  fecha date not null,
  comprobante text,
  recurrence jsonb,
  ai_read_status text not null default 'ninguno'
    check (ai_read_status in ('ninguno', 'pendiente', 'confirmado', 'rechazado')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_fin_movements_study_fecha on fin_movements (study_id, fecha desc);
create index idx_fin_movements_categoria on fin_movements (categoria_id);
create index idx_fin_movements_case on fin_movements (case_id);

-- ============================================================================
-- JOBS — cron idempotency. One row per (job, scheduled slot): a retried or
-- double-fired run sees the row and no-ops.
-- RLS enabled with NO policies: service role only.
-- ============================================================================

create table job_executions (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  slot_start timestamptz not null,
  status text not null default 'running'
    check (status in ('running', 'ok', 'error')),
  attempts integer not null default 1 check (attempts >= 1),
  error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_job_executions_slot unique (job_name, slot_start)
);
create index idx_job_executions_status on job_executions (job_name, status);

-- ============================================================================
-- STUDY BOOTSTRAP — called once right after sign-up / wizard completion:
-- owner role, membership, default task statuses.
-- ============================================================================
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

  -- TODO(gap): default event categories (6 names / 11 colors) are not
  -- evidenced; seed here once replica-design confirms them.
end;
$$;

-- Supabase Auth hook: create the profile row for every new auth user.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at maintenance on every table in this schema.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
  loop
    execute format(
      'create trigger set_updated_at before update on %I '
      || 'for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- ACCESS RULES — Supabase RLS (the chosen approach; stated in
-- architecture.md). Uniform group: tables with a study_id tenant column.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'roles', 'case_stages', 'cases', 'movements', 'actuaciones',
    'novedades', 'novedade_reads', 'integrations', 'sync_runs',
    'inbound_emails', 'persons', 'case_partes', 'plazos', 'pruebas',
    'prueba_estado_hist', 'task_statuses', 'tasks', 'event_categories',
    'events', 'hearings', 'documents', 'document_versions', 'drafts',
    'activity_logs', 'block_configs', 'fin_movements', 'fin_categorias',
    'subscriptions', 'wa_contacts', 'wa_conversations', 'wa_messages',
    'wa_appointment_slots', 'wa_appointments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I_member on %I '
      || 'using (is_member(study_id)) with check (is_member(study_id))',
      t, t
    );
  end loop;
end;
$$;

-- profiles: own row only.
alter table profiles enable row level security;
create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- studies: members see/manage their own; creation is checked by trigger.
alter table studies enable row level security;
create policy studies_select on studies for select using (is_member(id));
create policy studies_insert on studies for insert with check (created_by = auth.uid());
create policy studies_update on studies for update using (is_member(id))
  with check (is_member(id));

-- memberships: own invite row + any row of a study you belong to.
alter table memberships enable row level security;
create policy memberships_own on memberships
  for select using (user_id = auth.uid());
create policy memberships_team on memberships
  for select using (is_member(study_id));
create policy memberships_invite on memberships
  for insert with check (is_member(study_id));
create policy memberships_accept on memberships
  for update using (user_id = auth.uid() or is_member(study_id))
  with check (user_id = auth.uid() or is_member(study_id));
-- The invitee is NOT a member yet: they may find their own pending invite by
-- matching e-mail and claim it (S28 acceptance flow).
create policy memberships_invitee_select on memberships
  for select using (
    status = 'invited'
    and invite_email is not null
    and lower(invite_email) =
        lower(coalesce((select email from profiles where id = auth.uid()), ''))
  );
create policy memberships_invitee_claim on memberships
  for update using (
    status = 'invited'
    and lower(invite_email) =
        lower(coalesce((select email from profiles where id = auth.uid()), ''))
  )
  with check (user_id = auth.uid() or is_member(study_id));

-- plans: reference data, readable by any signed-in user (billing page).
alter table plans enable row level security;
create policy plans_read on plans for select using (auth.uid() is not null);

-- calendar_days: system rows readable by members; only studio rows are
-- writable by members (system rows = service role / migrations).
alter table calendar_days enable row level security;
create policy calendar_days_select on calendar_days
  for select using (study_id is null or is_member(study_id));
create policy calendar_days_write on calendar_days
  for all using (is_member(study_id)) with check (is_member(study_id));

-- notifications: strictly per user.
alter table notifications enable row level security;
create policy notifications_self on notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notification_preferences enable row level security;
create policy notification_prefs_self on notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_usage: own rows only (quota gating reads them in security definer jobs).
alter table ai_usage enable row level security;
create policy ai_usage_self on ai_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- conversations: owner inside an active membership.
alter table conversations enable row level security;
create policy conversations_self on conversations
  for all using (user_id = auth.uid() and is_member(study_id))
  with check (user_id = auth.uid() and is_member(study_id));

-- conversation_messages: via owning conversation.
alter table conversation_messages enable row level security;
create policy conversation_messages_own on conversation_messages
  for all using (exists (
    select 1 from conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
      and is_member(c.study_id)
  ));

-- template_favorites: own rows.
alter table template_favorites enable row level security;
create policy template_favorites_self on template_favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- templates: read for signed-in users; writes are service role (seeded by us).
alter table templates enable row level security;
create policy templates_read on templates for select using (auth.uid() is not null);

-- prueba_status_defs: read for signed-in users; seeded by migrations.
alter table prueba_status_defs enable row level security;
create policy prueba_status_defs_read on prueba_status_defs
  for select using (auth.uid() is not null);

-- job_executions + wa_webhook_events: RLS on, NO policies ->
-- service role only (jobs and webhook handlers run server-side).
alter table job_executions enable row level security;
alter table wa_webhook_events enable row level security;

-- ============================================================================
-- STORAGE (Supabase Storage) — bucket "documents", layout:
--   {study_id}/{case_id|studio}/{folder...}/{file}
-- Quota lives in the documents metadata table (triggers above); these
-- policies keep objects inside the tenant's folder.
-- ============================================================================
create policy "documents read own study" on storage.objects
  for select using (
    bucket_id = 'documents'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
create policy "documents insert own study" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
create policy "documents update own study" on storage.objects
  for update using (
    bucket_id = 'documents'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
create policy "documents delete own study" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================================
-- SEEDS
-- ============================================================================

insert into plans (key, name, price_cents, currency, seats, ai_quota_weekly,
                   storage_quota_bytes, is_trial)
values
  ('trial', 'Prueba',        0,       'ARS', 100, 5,    536870912,  true),
  ('pro',   'Pro',           3599000, 'ARS', 1,   null, 536870912,  false),
  ('max',   'Max',           8999000, 'ARS', 1,   null, 2147483648, false),
  ('max6x', 'Max 6x',        17999000,'ARS', 6,   null, 4294967296, false)
on conflict (key) do nothing;

-- The only per-type status set evidenced by the recon (S12, Informativa).
insert into prueba_status_defs (prueba_type, estado, position) values
  ('informativa', 'ofrecida',   1),
  ('informativa', 'proveida',   2),
  ('informativa', 'diligenciado', 3),
  ('informativa', 'reiterado',  4),
  ('informativa', 'contestado', 5),
  ('informativa', 'producida',  6),
  ('informativa', 'desistida',  7)
on conflict do nothing;
-- TODO(gap): documental / confesional / testimonial / pericial / otras sets.

-- Feria judicial for the current and next year (idempotent).
select public.seed_feria_year(2026);
select public.seed_feria_year(2027);
-- TODO(gap): system feriados for 2026/2027 must be loaded from an
-- authoritative Argentine calendar before milestone 2 sign-off.

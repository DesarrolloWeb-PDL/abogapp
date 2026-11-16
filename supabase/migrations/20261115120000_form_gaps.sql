-- ============================================================================
-- Migration: form_gaps — close the schema gaps the expediente forms expose.
--
-- Why this exists (three gaps found while building the S07 new-expediente
-- form and the S03 wizard):
--   1. studies.jurisdictions — wizard step 1 collects a string[] of picked
--      jurisdictions, but the init migration has no column for it, so the
--      supabase driver had to drop the value (see lib/supabase/studies.ts).
--   2. cases.responsable — the S07 list/filter has a Responsable column and
--      filter; the schema never had a column, so the value could only be
--      inferred from created_by.
--   3. case_stages was empty for every study — cases.etapa_id could never
--      be set and the Etapa procesal select had no rows to show.
--
-- Target     : Supabase (PostgreSQL 15+). Runs AFTER the already-applied
--              20261114120000_init.sql — additive only; that file is never
--              edited retroactively.
-- Idempotent : safe to re-run — every statement is guarded (if not exists /
--              do-block constraint check / on conflict do nothing /
--              create or replace).
-- Seed       : supabase/seed.sql needs no change. On a fresh database the
--              migration backfill runs before the seed creates its study, and
--              the seed reaches init_study_defaults() itself, which now
--              creates the same default stages.
-- Encoding   : UTF-8, no BOM
-- Naming     : identifiers and comments in English; status values use the
--              Spanish domain vocabulary (single-language product, es-AR).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. studies.jurisdictions — the wizard's step-1 selection (S03).
--
-- Encoding choice: jsonb (not text[]). The caller passes a plain
-- `string[]` (CreateStudyInput.jurisdictions) and supabase-js serialises a
-- JSON array into either column type equally well, so jsonb wins on the
-- tie-breakers: it matches the schema's other list-shaped columns
-- (roles.permissions, case citados/archivos/abogados are all jsonb), it has
-- no array-literal parsing edge cases (empty arrays, quoting, backslashes),
-- and it round-trips through PostgREST as a parsed JS array with no casts.
-- ----------------------------------------------------------------------------
alter table studies
  add column if not exists jurisdictions jsonb not null default '[]';

-- Guard the shape the app relies on (a JSON array of jurisdiction names).
-- Idempotent via the do-block, the same pattern the init migration uses for
-- uq_cases_id_study.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studies'::regclass
      and conname = 'chk_studies_jurisdictions_array'
  ) then
    alter table studies
      add constraint chk_studies_jurisdictions_array
      check (jsonb_typeof(jurisdictions) = 'array');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. cases.responsable — free-text owner shown in the S07 Responsable column
-- and filter. Deliberately NOT a profiles FK: the recon shows an editable
-- text responsibility (assignable to any name), and rows created before this
-- column read back through created_by's profile (see mapCase in
-- lib/supabase/cases.ts).
-- ----------------------------------------------------------------------------
alter table cases
  add column if not exists responsable text;

-- ----------------------------------------------------------------------------
-- 3. Default case_stages for studies that already exist (the live database
-- has one study and zero stage rows). Idempotent: names are unique per
-- study, so a re-run inserts nothing.
--
-- ASSUMPTION: the recon never evidences stage names — S30 only shows the
-- "/settings/expedientes/etapas" settings table and features.csv marks
-- etapas as "should". Inicial / Trámite / Prueba / Sentencia / Ejecución is
-- our own product default (the same set init_study_defaults seeds below);
-- studies can rename or reorder them from the Etapas settings.
-- counts_as_active keeps the column default (true) for every row: which
-- stages count as "active" on Inicio is a per-study decision made in S30.
-- ----------------------------------------------------------------------------
insert into case_stages (study_id, name, position)
select s.id, d.name, d.position
  from studies s
  cross join (values
    ('Inicial',     1),
    ('Trámite',     2),
    ('Prueba',      3),
    ('Sentencia',   4),
    ('Ejecución',   5)
  ) as d(name, position)
on conflict (study_id, name) do nothing;

-- ----------------------------------------------------------------------------
-- 4. init_study_defaults — the SAME bootstrap the init migration defines
-- (signature, security context and the roles / membership / task_statuses
-- statements are byte-compatible), extended to seed the default case stages
-- so NEW studies get an etapa picker from day one. `create or replace`
-- upgrades the function in place for both paths: the wizard RPC and the
-- seed.sql call.
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

  -- TODO(gap): default event categories (6 names / 11 colors) are not
  -- evidenced; seed here once replica-design confirms them.
end;
$$;

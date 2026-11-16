-- ============================================================================
-- attach-demo-user.sql — re-point the ALREADY-RUN seed dataset onto an
-- existing, working auth user.
--
-- Why this exists: the original seed.sql inserted its demo users directly
-- into auth.users / auth.identities. GoTrue rejects password sign-in for
-- those hand-written rows (unexpected_failure), so the seeded study was
-- unreachable: RLS (is_member) saw no member, and the notification bell
-- pointed at an owner who could never log in.
--
-- Fix: create the user properly FIRST (Supabase dashboard → Authentication →
-- Users, or sign up through the app), then run THIS file once. It moves
-- every user-scoped seed row onto that user. Nothing is deleted here — the
-- old seed users stay in auth.users. Remove them from Authentication →
-- Users only AFTER this script has run: their profile rows are still the
-- FK target of memberships/notifications, so deleting them first would
-- cascade those rows away and set studies.created_by to null.
--
-- Idempotent: safe to run twice. Every UPDATE only matches rows still owned
-- by the old seed user id (plus created_by = null healed from that
-- cascade), and the membership step no-ops once the user is attached.
--
-- Run AFTER migrations/20261114120000_init.sql and supabase/seed.sql.
-- Plain SQL only (no psql variables): runs in the dashboard SQL Editor and
-- through `npx supabase db push` alike. See replica/backend.md.
-- ============================================================================

do $$
declare
  -- CHANGE THIS TO ANY EXISTING auth.users EMAIL
  -- (Supabase dashboard -> Authentication -> Users). The user must exist
  -- in auth.users before this script runs.
  v_target_email constant text := 'prueba.abogapp@gmail.com';
  -- Owner id hard-coded by the ORIGINAL seed.sql: GoTrue rejects its
  -- password, and every seeded row below still points at it.
  v_seed_user constant uuid := 'a0000000-0000-4000-8000-000000000001';
  -- Fixed study id — identical in seed.sql (consistency rule).
  v_study     constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_target uuid;
  v_role   uuid;
  v_n      integer;
  v_total  integer := 0;
  v_pair   record;
begin
  -- 0. Resolve the target user. Abort loudly when it does not exist, so
  --    the dataset is never half-attached to a user that is not there.
  select id into v_target
    from auth.users
   where lower(email) = lower(v_target_email);
  if v_target is null then
    raise exception 'attach-demo-user.sql: no auth.users row for "%" — create the user first (Supabase dashboard → Authentication → Users, or sign up through the app), then re-run this script', v_target_email;
  end if;

  -- 1. Profile backfill (defensive): memberships.user_id and
  --    notifications.user_id FK to profiles, and a user created before the
  --    init migration has no profile row (the on_auth_user_created trigger
  --    did not exist yet). Idempotent — rows the trigger already made win
  --    on conflict.
  insert into public.profiles (id, email, full_name)
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
    from auth.users u
   where u.id = v_target
  on conflict (id) do nothing;

  -- 2. Membership — the Dueño membership init_study_defaults created for the
  --    unreachable seed user. Replace ONLY its user_id (role, study and
  --    active status are kept). Three states, all idempotent:
  --      a) target already a member -> nothing to do (second run lands here);
  --      b) seed-user row present   -> re-point it;
  --      c) both missing (e.g. the old user was deleted first and the
  --         membership cascaded away) -> insert a fresh row with the exact
  --         shape init_study_defaults uses: fixed Dueño role, active+accepted.
  if exists (
    select 1 from memberships
    where study_id = v_study and user_id = v_target
  ) then
    raise notice 'memberships: % already owns the demo study membership — nothing to change', v_target_email;
  elsif exists (
    select 1 from memberships
    where study_id = v_study and user_id = v_seed_user
  ) then
    update memberships
       set user_id = v_target
     where study_id = v_study and user_id = v_seed_user;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    raise notice 'memberships.user_id: % row(s) re-pointed (role/study/status kept)', v_n;
  else
    select id into v_role
      from roles
     where study_id = v_study and name = 'Dueño' and is_fixed;
    if v_role is null then
      raise exception 'attach-demo-user.sql: demo study % has no fixed "Dueño" role — run migrations/20261114120000_init.sql + seed.sql first', v_study;
    end if;
    insert into memberships (study_id, user_id, role_id, status, accepted_at)
    values (v_study, v_target, v_role, 'active', now())
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    raise notice 'memberships: inserted % Dueño membership row(s) for %', v_n, v_target_email;
  end if;

  -- 3–8: the user-scoped rows seed.sql created, one section per table.
  --    `or <col> is null` also heals rows whose creator column was null-ed
  --    by `on delete set null` when the unreachable seed user was removed
  --    before this script ran: the seed always set these columns, so NULL
  --    inside the demo study can only mean that cascade happened.

  -- 3. studies.created_by — the study must read as created by the user who
  --    can actually manage it (studies_insert/update policies and the
  --    wizard UI read this column).
  update studies
     set created_by = v_target
   where id = v_study
     and (created_by = v_seed_user or created_by is null);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'studies.created_by: % row(s) re-pointed', v_n;

  -- 4. cases.created_by — case list/detail attribution (S07).
  update cases
     set created_by = v_target
   where study_id = v_study
     and (created_by = v_seed_user or created_by is null);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'cases.created_by: % row(s) re-pointed', v_n;

  -- 5. persons.created_by — studio directory attribution (S12).
  update persons
     set created_by = v_target
   where study_id = v_study
     and (created_by = v_seed_user or created_by is null);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'persons.created_by: % row(s) re-pointed', v_n;

  -- 6. pruebas.created_by — evidence attribution (S12).
  update pruebas
     set created_by = v_target
   where study_id = v_study
     and (created_by = v_seed_user or created_by is null);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'pruebas.created_by: % row(s) re-pointed', v_n;

  -- 7. plazos.created_by — deadline attribution (F03).
  update plazos
     set created_by = v_target
   where study_id = v_study
     and (created_by = v_seed_user or created_by is null);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'plazos.created_by: % row(s) re-pointed', v_n;

  -- 8. notifications.user_id — the bell: the notifications_self RLS policy
  --    only exposes rows where user_id = auth.uid(), so without this the
  --    unread seed notification stays invisible to the demo user.
  update notifications
     set user_id = v_target
   where user_id = v_seed_user;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice 'notifications.user_id: % row(s) re-pointed', v_n;

  -- 9. Defensive sweep — every OTHER user-scoped column in the schema, for
  --    rows still owned by the unreachable seed user. seed.sql does not
  --    create rows in these tables today; the sweep keeps this script
  --    correct if the dataset grows (tasks, block_configs, documents,
  --    agenda, WhatsApp assignment, activity log, AI usage...). Only rows
  --    whose column equals the old seed user id match — re-running is a
  --    no-op, and legitimate NULLs (e.g. an unassigned task) are untouched.
  for v_pair in
    select t.tbl, t.col
      from (values
        ('movements',                'created_by'),
        ('novedade_reads',           'user_id'),
        ('calendar_days',            'created_by'),
        ('integrations',             'connected_by'),
        ('prueba_estado_hist',       'changed_by'),
        ('tasks',                    'responsable_id'),
        ('tasks',                    'created_by'),
        ('hearings',                 'created_by'),
        ('events',                   'created_by'),
        ('documents',                'uploaded_by'),
        ('document_versions',        'created_by'),
        ('drafts',                   'created_by'),
        ('block_configs',            'owner_id'),
        ('activity_logs',            'user_id'),
        ('fin_movements',            'created_by'),
        ('wa_conversations',         'assigned_to'),
        ('wa_appointment_slots',     'professional_user_id'),
        ('wa_appointment_slots',     'created_by'),
        ('templates',                'created_by'),
        ('template_favorites',       'user_id'),
        ('conversations',            'user_id'),
        ('ai_usage',                 'user_id'),
        ('notification_preferences', 'user_id'),
        ('memberships',              'invited_by')
      ) as t(tbl, col)
  loop
    execute format(
      'update %I set %I = $1 where %I = $2',
      v_pair.tbl, v_pair.col, v_pair.col
    ) using v_target, v_seed_user;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    raise notice '%.%: % row(s) re-pointed', v_pair.tbl, v_pair.col, v_n;
  end loop;

  -- 10. Verification summary. Per-table counts were raised above; this line
  --     is the total. Deliberately untouched: the old seed users and their
  --     profiles in auth.users/profiles (remove them by hand afterwards),
  --     and roles/task_statuses (no user column — they belong to the study,
  --     not to a person).
  raise notice 'attach-demo-user.sql: done — % row(s) re-pointed in total onto % (study %)', v_total, v_target_email, v_study;
  raise notice 'attach-demo-user.sql: next — sign in as %; the bell, cases, pruebas and the WhatsApp inbox must all be visible (RLS is_member + notifications_self)', v_target_email;
end $$;

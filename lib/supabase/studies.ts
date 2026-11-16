/**
 * Study functions for the `supabase` driver — browser-safe (anon key + RLS;
 * the wizard runs as a client component).
 *
 * createStudy = insert study (RLS: created_by = auth.uid()) + the
 * `init_study_defaults` security-definer RPC, which creates the owner's
 * membership, the fixed Dueño role and the default task statuses. That RPC
 * is exactly what the wizard's "crear estudio" step needs to end with an
 * active membership.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Study } from "@/lib/types";
import { DataLayerError } from "@/lib/data/errors";
import type { CreateStudyInput } from "@/lib/data/studies";
import { getBrowserClient } from "./client";

interface StudyRow {
  id: string;
  name: string;
  plan_key: string;
  /** jsonb array of jurisdiction names; absent on pre-migration rows. */
  jurisdictions?: string[] | null;
  created_at: string;
}

export async function createStudySupabase(
  input: CreateStudyInput,
): Promise<Study> {
  const supabase = getBrowserClient();
  const user = await requireUser(supabase);

  const name = input.name.trim() || "Mi estudio";
  // Same normalisation as the fake branch: trim and drop blanks, so both
  // drivers store the identical array for the wizard's step-1 selection.
  const jurisdictions = input.jurisdictions
    .map((item) => item.trim())
    .filter(Boolean);

  const { data: study, error } = await supabase
    .from("studies")
    .insert({ name, plan_key: "trial", created_by: user.id, jurisdictions })
    .select("id, name, plan_key, jurisdictions, created_at")
    .single();
  if (error || !study) {
    throw new DataLayerError("save_failed");
  }

  const { error: initError } = await supabase.rpc("init_study_defaults", {
    p_study_id: study.id,
    p_owner_id: user.id,
  });
  if (initError) {
    // No membership → the study would be invisible under RLS. There is no
    // studies DELETE policy (by design), so surface the failure instead of
    // leaving a half-created tenant silently.
    throw new DataLayerError("save_failed");
  }

  return mapStudy(study);
}

export async function getMyStudySupabase(): Promise<Study | null> {
  const supabase = getBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select(
      "study:studies(id, name, plan_key, jurisdictions, created_at)",
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DataLayerError("save_failed");

  const study = (data?.study ?? null) as unknown as StudyRow | null;
  return study ? mapStudy(study) : null;
}

async function requireUser(
  supabase: SupabaseClient,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new DataLayerError("not_signed_in");
  return user;
}

/** plan_key (DB vocabulary) → Study.plan (app vocabulary). */
function mapStudy(row: StudyRow): Study {
  const plan: Study["plan"] =
    row.plan_key === "trial"
      ? "prueba"
      : row.plan_key === "ninguno"
        ? "ninguno"
        : "activo";

  return {
    id: row.id,
    name: row.name,
    plan,
    // A row written before the jurisdictions column existed has no value;
    // PostgREST always sends the jsonb array, so only a missing key means
    // "unknown" — both collapse to the honest empty list.
    jurisdictions: Array.isArray(row.jurisdictions) ? row.jurisdictions : [],
    createdAt: row.created_at,
  };
}

/**
 * Bot-settings reads/writes for the `supabase` driver.
 *
 * Browser-safe by default (anon client + RLS: the bot_settings_select /
 * _update / _insert policies scope rows to `is_member(study_id)`). The
 * WhatsApp webhook passes its SERVICE-ROLE client instead: Meta delivers
 * with no user session, so the webhook writer reads the same row through
 * one query per inbound message (never one per message field — no N+1).
 *
 * Upsert-on-missing: a study without a row gets the defaults inserted (the
 * same values the migration seeds), so the admin screen and the webhook
 * always find one. A concurrent insert losing the primary-key race re-reads
 * the winner's row instead of failing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BOT_SETTINGS, type BotSettings } from "@/lib/data/bot";
import { DataLayerError } from "@/lib/data/errors";
import { getBrowserClient } from "./client";

/** Raw bot_settings row as PostgREST returns it (snake_case columns). */
interface BotSettingsRow {
  study_id: string;
  enabled: boolean;
  greeting: string;
  off_hours: string;
  handoff: string;
}

const UNIQUE_VIOLATION = "23505";
const COLUMNS = "study_id, enabled, greeting, off_hours, handoff";

function toSettings(row: BotSettingsRow): BotSettings {
  return {
    studyId: row.study_id,
    enabled: row.enabled,
    greeting: row.greeting,
    offHours: row.off_hours,
    handoff: row.handoff,
  };
}

/** The insert payload both write paths share (defaults or edited values). */
function toRowPayload(settings: {
  enabled: boolean;
  greeting: string;
  offHours: string;
  handoff: string;
}): Omit<BotSettingsRow, "study_id"> {
  return {
    enabled: settings.enabled,
    greeting: settings.greeting,
    off_hours: settings.offHours,
    handoff: settings.handoff,
  };
}

/**
 * The study's settings row; creates the defaults when it does not exist yet.
 *
 * `client` is injectable so the webhook can reuse this function with its
 * service-role client — one round trip per inbound message either way.
 */
export async function getBotSettingsSupabase(
  studyId: string,
  client: SupabaseClient = getBrowserClient(),
): Promise<BotSettings> {
  const { data, error } = await client
    .from("bot_settings")
    .select(COLUMNS)
    .eq("study_id", studyId)
    .maybeSingle();
  if (error) throw new DataLayerError("save_failed");
  if (data) return toSettings(data as BotSettingsRow);

  // No row yet → create the defaults (the values the migration backfills).
  const { data: created, error: insertError } = await client
    .from("bot_settings")
    .insert({ study_id: studyId, ...toRowPayload(DEFAULT_BOT_SETTINGS) })
    .select(COLUMNS)
    .single();
  if (insertError) {
    // Someone else (the migration backfill, a parallel read) won the race:
    // their row carries the same values — read it instead of failing.
    if (insertError.code === UNIQUE_VIOLATION) {
      const { data: existing, error: reselectError } = await client
        .from("bot_settings")
        .select(COLUMNS)
        .eq("study_id", studyId)
        .maybeSingle();
      if (!reselectError && existing) {
        return toSettings(existing as BotSettingsRow);
      }
    }
    throw new DataLayerError("save_failed");
  }
  if (!created) throw new DataLayerError("save_failed");
  return toSettings(created as BotSettingsRow);
}

/**
 * Persist the edited settings for one study. The shared validation already
 * ran in lib/data/bot-settings.ts (non-empty trimmed copy, ≤500 chars,
 * boolean enabled) — this function only writes.
 *
 * Update first, insert when the study has no row yet (a member's first save
 * before the backfill, or a row removed out-of-band), with the same
 * lost-race re-read as the read path.
 */
export async function updateBotSettingsSupabase(
  input: BotSettings,
): Promise<BotSettings> {
  const client = getBrowserClient();
  const payload = toRowPayload(input);

  const { data, error } = await client
    .from("bot_settings")
    .update(payload)
    .eq("study_id", input.studyId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new DataLayerError("save_failed");
  if (data) return toSettings(data as BotSettingsRow);

  const { data: created, error: insertError } = await client
    .from("bot_settings")
    .insert({ study_id: input.studyId, ...payload })
    .select(COLUMNS)
    .single();
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      const { data: existing, error: reselectError } = await client
        .from("bot_settings")
        .select(COLUMNS)
        .eq("study_id", input.studyId)
        .maybeSingle();
      if (!reselectError && existing) {
        return toSettings(existing as BotSettingsRow);
      }
    }
    throw new DataLayerError("save_failed");
  }
  if (!created) throw new DataLayerError("save_failed");
  return toSettings(created as BotSettingsRow);
}

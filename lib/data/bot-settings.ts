/**
 * Study-level bot settings — the data layer behind /configuracion/bot
 * (WhatsApp Unit 1, "admin de mensajes").
 *
 * Driver split (the rule every other module follows): the supabase driver
 * reads and writes the `bot_settings` row (RLS: is_member policies); the
 * fake layer has no table, so it answers the seeded defaults and keeps
 * per-study overrides in memory — same signatures, so no screen changes on
 * the swap.
 *
 * Validation lives HERE, driver-agnostic and BEFORE any write: every message
 * must be non-empty after trim and at most BOT_MESSAGE_MAX characters, and
 * `enabled` must be a boolean. Failures are typed `DataLayerError`s; the
 * form shows its own per-field Spanish copy (validateBotSettingsInput)
 * before it ever calls updateBotSettings.
 */

import { DEFAULT_BOT_SETTINGS, type BotSettings } from "./bot";
import { DataLayerError } from "./errors";
import { getDataDriver } from "./driver";
import {
  getBotSettingsSupabase,
  updateBotSettingsSupabase,
} from "@/lib/supabase/bot-settings";

export type { BotSettings } from "./bot";

/** Max characters per message — also the textareas' `maxLength`. */
export const BOT_MESSAGE_MAX = 500;

/** What updateBotSettings writes: the study plus the editable values. */
export interface UpdateBotSettingsInput {
  studyId: string;
  enabled: boolean;
  greeting: string;
  offHours: string;
  handoff: string;
}

/** Per-field Spanish copy the form renders inline (undefined = valid). */
export interface BotSettingsFieldErrors {
  greeting?: string;
  offHours?: string;
  handoff?: string;
}

/**
 * Fake-driver overrides, keyed by study (the store.ts seed has no settings
 * table). Module-level on purpose: the fake layer is an in-memory singleton
 * too, and a full page reload re-seeds both.
 */
const overrides = new Map<string, BotSettings>();

/**
 * The study's settings. supabase: select the row, inserting the defaults
 * when it is missing. fake: the seeded defaults (the same "upsert on
 * missing" contract — there is nothing to persist until someone edits).
 */
export async function getBotSettings(studyId: string): Promise<BotSettings> {
  if (getDataDriver() === "supabase") return getBotSettingsSupabase(studyId);
  return overrides.get(studyId) ?? { studyId, ...DEFAULT_BOT_SETTINGS };
}

/**
 * Validate, trim and save. Runs before the driver switch so a bad input can
 * never reach either store (the same order signUp uses).
 *
 * Error codes: empty/blank copy and a non-boolean `enabled` are
 * `missing_fields` (a perfect fit); the >500-char bound REUSES
 * `missing_fields` too because errors.ts is outside this unit's surfaces —
 * a dedicated code (e.g. `invalid_bot_settings`) would read better in the
 * toast; reported upstream. The form never surfaces either: it validates
 * with validateBotSettingsInput first and shows per-field copy.
 */
export async function updateBotSettings(
  input: UpdateBotSettingsInput,
): Promise<BotSettings> {
  const trimmed: BotSettings = {
    studyId: input.studyId,
    enabled: input.enabled,
    greeting: input.greeting.trim(),
    offHours: input.offHours.trim(),
    handoff: input.handoff.trim(),
  };
  assertValid(trimmed);

  if (getDataDriver() === "supabase") return updateBotSettingsSupabase(trimmed);

  overrides.set(trimmed.studyId, trimmed);
  return trimmed;
}

/**
 * Spanish per-field messages for the admin form (rioplatense voseo), keyed
 * by the field the user must fix. Checks the trimmed value for emptiness
 * and the trimmed length against BOT_MESSAGE_MAX.
 */
export function validateBotSettingsInput(
  input: Pick<UpdateBotSettingsInput, "greeting" | "offHours" | "handoff">,
): BotSettingsFieldErrors {
  const errors: BotSettingsFieldErrors = {};

  const greeting = input.greeting.trim();
  if (!greeting) {
    errors.greeting = "El saludo no puede quedar vacío.";
  } else if (greeting.length > BOT_MESSAGE_MAX) {
    errors.greeting = `El saludo no puede superar los ${BOT_MESSAGE_MAX} caracteres.`;
  }

  const offHours = input.offHours.trim();
  if (!offHours) {
    errors.offHours = "El mensaje de fuera de horario no puede quedar vacío.";
  } else if (offHours.length > BOT_MESSAGE_MAX) {
    errors.offHours = `El mensaje de fuera de horario no puede superar los ${BOT_MESSAGE_MAX} caracteres.`;
  }

  const handoff = input.handoff.trim();
  if (!handoff) {
    errors.handoff = "El mensaje de traspaso no puede quedar vacío.";
  } else if (handoff.length > BOT_MESSAGE_MAX) {
    errors.handoff = `El mensaje de traspaso no puede superar los ${BOT_MESSAGE_MAX} caracteres.`;
  }

  return errors;
}

/** Throws typed codes for anything validateBotSettingsInput would flag. */
function assertValid(input: BotSettings): void {
  if (typeof input.enabled !== "boolean") {
    throw new DataLayerError("missing_fields");
  }
  const errors = validateBotSettingsInput(input);
  if (errors.greeting || errors.offHours || errors.handoff) {
    throw new DataLayerError("missing_fields");
  }
}

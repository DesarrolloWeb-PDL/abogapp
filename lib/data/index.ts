/**
 * The fake data layer's public surface (T3b) — the ONE module screens import.
 *
 * Every function is async with the signature the future Supabase/Drizzle
 * layer will keep, so swapping the implementation changes no screen code
 * (replica-build Step 2 rule). Grouped like the API in
 * replica/architecture.md: auth / studies / cases / pruebas / notifications /
 * whatsapp.
 */

// Auth (S01 / S02)
export {
  getSession,
  parseDemoSessionCookie,
  signIn,
  signOut,
  signUp,
  updateProfile,
  type AuthOutcome,
  type ProfileOutcome,
  type Session,
  type SignInInput,
  type SignUpInput,
} from "./auth";

// Driver switch: "supabase" when the project keys exist, "fake" otherwise.
export { getDataDriver, isSupabaseConfigured, type DataDriver } from "./driver";

// Studies (S03 wizard)
export {
  createStudy,
  getMyStudy,
  requireStudy,
  type CreateStudyInput,
} from "./studies";

// Cases (S07)
export { createCase, getCase, listCases, type CreateCaseInput } from "./cases";

// Pruebas + plazos (S12) — fecha límite always computed by lib/plazos.
export { createPrueba, listPruebas, type CreatePruebaInput } from "./pruebas";

// Notifications (S21)
export {
  listNotifications,
  markNotificationRead,
  onNotification,
  onNotificationsChanged,
  unreadCount,
} from "./notifications";

// WhatsApp intake (Module A)
export {
  handleInboundMessage,
  listConversations,
  listMessages,
  type InboundMessageInput,
  type InboundMessageResult,
} from "./whatsapp";

// Errors: typed codes + the Spanish copy the UI shows.
export { DataLayerError, ERROR_COPY, errorCopy, type DataErrorCode } from "./errors";

// Seam contract for S12: the add-prueba form receives the non-working days
// from here and hands them to computeFechaLimite — it never computes dates.
export { nonWorkingDays } from "./calendar";

// WhatsApp webhook (T8) — signature, payload parsing and the idempotent loop.
export {
  parseInboundMessages,
  processInboundPayload,
  verifyHubSignature,
  type ParsedInbound,
  type ProcessInboundOptions,
  type WebhookProcessResult,
} from "./webhook";
export { markEventProcessed, releaseEventKey } from "./whatsapp";

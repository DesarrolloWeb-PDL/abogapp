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

// Cases (S07) — list + filters/sort predicates + narrow patches
// (favorite / archive / bulk archive / soft delete).
export {
  applyCaseFilters,
  archiveCase,
  bulkArchive,
  compareCasesBy,
  createCase,
  getCase,
  listCases,
  softDeleteCase,
  toggleFavorite,
  type CaseListFilter,
  type CaseSortKey,
  type CreateCaseInput,
  type SortDirection,
} from "./cases";

// Case stages / etapas (S07 form + S30 settings admin)
export {
  createStage,
  deleteStage,
  listStages,
  moveStage,
  renameStage,
  setStageCountsAsActive,
  STAGE_NAME_MAX,
  type CaseStage,
  type CreateStageInput,
  type StageMoveDirection,
} from "./stages";

// Pruebas + plazos (S12) — fecha límite always computed by lib/plazos.
export { createPrueba, listPruebas, type CreatePruebaInput } from "./pruebas";

// Tasks (S16 / F04) — M2 list slice: create, estado transitions, filters.
// The kanban board (drag-drop, grouping, bulk bar) is deferred past this slice.
export {
  compareTasksByDue,
  createTask,
  isTaskOverdue,
  listTaskStatuses,
  listTasks,
  updateTask,
  TASK_PRIORIDADES,
  TASK_TITULO_MAX,
  TERMINAL_STATUS_KEYS,
  type CreateTaskInput,
  type Task,
  type TaskFilter,
  type TaskPrioridad,
  type TaskStatus,
  type UpdateTaskPatch,
} from "./tasks";

// Movements (S09) — the case's MANUAL movement log: create + pin toggle +
// tipo/date/search filters, no notifications (S09 never asks for one).
export {
  MOVEMENT_DETALLE_MAX,
  MOVEMENT_TIPOS,
  applyMovementFilter,
  compareMovementsByFecha,
  createMovement,
  isMovementTipo,
  listMovements,
  movementPinBadge,
  updateMovement,
  type CreateMovementInput,
  type Movement,
  type MovementFilter,
  type MovementQuery,
  type MovementTipo,
  type UpdateMovementPatch,
} from "./movements";

// Notifications (S21) — list + mark-read, M2 filtered pagination and the
// per-category preferences behind the emission gate.
export {
  clearNotificationPreferenceCache,
  listNotificationPreferences,
  listNotifications,
  listNotificationsPage,
  markNotificationRead,
  NOTIFICATION_CATEGORIES,
  onNotification,
  onNotificationsChanged,
  unreadCount,
  updateNotificationPreference,
  type NotificationChannel,
  type NotificationEstado,
  type NotificationListOptions,
  type NotificationPage,
  type NotificationPreference,
} from "./notifications";

// WhatsApp intake (Module A)
export {
  handleInboundMessage,
  listConversations,
  listMessages,
  type InboundMessageInput,
  type InboundMessageResult,
} from "./whatsapp";

// WhatsApp bot settings — admin screen /configuracion/bot (Unit 1)
export {
  BOT_MESSAGE_MAX,
  getBotSettings,
  updateBotSettings,
  validateBotSettingsInput,
  type BotSettings,
  type BotSettingsFieldErrors,
  type UpdateBotSettingsInput,
} from "./bot-settings";

// WhatsApp bot LLM fallback (Unit 3) — env-gated on AI_API_KEY, rules first
export {
  LLM_DISCLAIMER,
  LLM_USER_MAX_CHARS,
  resolveBotReply,
  type LlmAsk,
  type ResolveBotReplyOptions,
} from "./bot-llm";

// Errors: typed codes + the Spanish copy the UI shows.
export { DataLayerError, ERROR_COPY, errorCopy, type DataErrorCode } from "./errors";

// Seam contract for S12: the add-prueba form receives the non-working days
// from here and hands them to computeFechaLimite — it never computes dates.
// The S30 admin writes the study's own días inhábiles through the same
// module, and loadNonWorkingDays() keeps the shared set truthful.
export {
  addStudioDay,
  listStudioDays,
  listSystemDays,
  loadNonWorkingDays,
  nonWorkingDays,
  removeStudioDay,
  type AddStudioDayInput,
  type CalendarDay,
  type CalendarDayKind,
  type CalendarDayOrigen,
} from "./calendar";

// WhatsApp webhook (T8) — signature, payload parsing and the idempotent loop.
export {
  parseInboundMessages,
  parseStatusUpdates,
  processInboundPayload,
  verifyHubSignature,
  type ParsedInbound,
  type ParsedStatusUpdate,
  type ProcessInboundOptions,
  type WaDeliveryStatus,
  type WebhookProcessResult,
} from "./webhook";
export { markEventProcessed, releaseEventKey } from "./whatsapp";

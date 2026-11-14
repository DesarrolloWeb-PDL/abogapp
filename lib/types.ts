/**
 * Domain types for the M1 vertical slice.
 *
 * Identifiers and field names are English (code vocabulary); enum/status VALUES
 * are Spanish because the product is single-language (es-AR) and the database
 * stores Spanish domain vocabulary (see replica/architecture.md).
 *
 * The shapes mirror the future Supabase/Drizzle layer so the fake data layer
 * (T3) can be swapped for the real one without touching screen code.
 */

export type IsoDate = string; // `YYYY-MM-DD` — a calendar date, never an instant
export type IsoDateTime = string; // full ISO timestamp

export interface Study {
  id: string;
  name: string;
  plan: "prueba" | "activo" | "ninguno";
  /** Jurisdictions picked in the onboarding wizard (S03 step 1). */
  jurisdictions: string[];
  createdAt: IsoDateTime;
}

export interface User {
  id: string;
  fullName: string;
  email: string;
}

export interface StudyCase {
  id: string;
  studyId: string;
  caratula: string;
  numero: string;
  fuero: string;
  jurisdiccion: string;
  juzgado: string;
  etapa: string;
  tipo: "Judicial" | "Extrajudicial";
  responsable: string;
  favorite: boolean;
  archived: boolean;
  createdAt: IsoDateTime;
  lastActivityAt: IsoDateTime;
}

/** The six evidence types tracked per case (S12). */
export type PruebaTipo =
  | "Documental"
  | "Informativa"
  | "Confesional"
  | "Testimonial"
  | "Pericial"
  | "Otras";

/** Deadline unit: hours / calendar days / business days. */
export type PlazoTipo = "horas" | "corridos" | "habiles";

export interface Plazo {
  id: string;
  studyId: string;
  caseId: string;
  pruebaId: string;
  tipo: PlazoTipo;
  cantidad: number;
  /** The count starts the day after this date (data-layer rule, T3). */
  fechaEfectiva: IsoDate;
  /**
   * Owned by the data layer / DB trigger — never computed in the client.
   * `null` while the engine has not processed the row yet.
   */
  fechaLimite: IsoDate | null;
}

export interface Prueba {
  id: string;
  studyId: string;
  caseId: string;
  tipo: PruebaTipo;
  titulo: string;
  informante: string;
  estado: string;
  fechaEfectiva: IsoDate;
  plazos: Plazo[];
}

export type NotificationCategory =
  | "Plazos"
  | "Expedientes"
  | "Sistema"
  | "Equipo";

export interface AppNotification {
  id: string;
  studyId: string;
  userId: string;
  titulo: string;
  detalle: string;
  categoria: NotificationCategory;
  leida: boolean;
  createdAt: IsoDateTime;
  /** Deep link target (read-on-click navigates here), or null for none. */
  enlace: string | null;
}

/**
 * WhatsApp intake (Module A) — every element is an assumption pending the
 * MetaJurídico/Whaticket recon (see replica/architecture.md).
 */
export type WaConversationStatus = "bot" | "humano" | "cerrada";

export interface WaConversation {
  id: string;
  studyId: string;
  phone: string;
  contactName: string;
  /** Which side is answering: the local bot, a human, or stopped (STOP). */
  status: WaConversationStatus;
  /** Inbound messages nobody has read yet. */
  unread: number;
  /** Body of the latest message, shown as the list snippet. */
  lastSnippet: string;
  lastMessageAt: IsoDateTime;
}

export interface WaMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: IsoDateTime;
}

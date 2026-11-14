import type {
  AppNotification,
  Prueba,
  Study,
  StudyCase,
  User,
  WaConversation,
  WaMessage,
} from "@/lib/types";

/**
 * Seed data for the M1 slice.
 *
 * Plain typed constants — no functions, no side effects. The fake data layer
 * (T3, lib/data/*) reads these so every screen shows realistic content before
 * the real Supabase/Drizzle layer exists. All names, cases and messages are
 * invented for this clean-room build.
 */

export const seedUser: User = {
  id: "user-1",
  fullName: "Ana Beltrán",
  email: "ana@estudiobeltran.com.ar",
};

export const seedStudy: Study = {
  id: "study-1",
  name: "Estudio Beltrán & Asoc.",
  plan: "prueba",
  jurisdictions: [
    "Ciudad Autónoma de Buenos Aires",
    "Provincia de Buenos Aires",
  ],
  createdAt: "2026-10-02T14:00:00.000Z",
};

/**
 * Password of the seeded demo account (S01 login without signing up first).
 * Fake by design — never reused anywhere real.
 */
export const seedDemoPassword = "estudiobeltran";

export const seedCases: StudyCase[] = [
  {
    id: "case-1",
    studyId: seedStudy.id,
    caratula: "Ríos, Carlos c/ Energía del Norte S.A. s/ daños y perjuicios",
    numero: "45.213/2025",
    fuero: "Civil y Comercial",
    jurisdiccion: "Ciudad Autónoma de Buenos Aires",
    juzgado: "Juzgado Civil N° 12",
    etapa: "Trámite",
    tipo: "Judicial",
    responsable: "Ana Beltrán",
    favorite: true,
    archived: false,
    createdAt: "2026-10-04T15:30:00.000Z",
    lastActivityAt: "2026-11-13T17:45:00.000Z",
  },
  {
    id: "case-2",
    studyId: seedStudy.id,
    caratula: "Sucesión de Ferrari, Juan",
    numero: "12.987/2024",
    fuero: "Sucesiones",
    jurisdiccion: "Provincia de Buenos Aires",
    juzgado: "Juzgado de Sucesiones N° 3",
    etapa: "Cita",
    tipo: "Judicial",
    responsable: "Ana Beltrán",
    favorite: false,
    archived: false,
    createdAt: "2026-09-18T12:00:00.000Z",
    lastActivityAt: "2026-11-10T10:15:00.000Z",
  },
  {
    id: "case-3",
    studyId: seedStudy.id,
    caratula: "Pérez, Lucía c/ Municipalidad de San Martín s/ amparo",
    numero: "8.402/2026",
    fuero: "Contencioso Administrativo",
    jurisdiccion: "Provincia de Buenos Aires",
    juzgado: "Juzgado Contencioso Administrativo N° 2",
    etapa: "Inicial",
    tipo: "Judicial",
    responsable: "Ana Beltrán",
    favorite: false,
    archived: false,
    createdAt: "2026-11-01T09:20:00.000Z",
    lastActivityAt: "2026-11-12T16:05:00.000Z",
  },
];

export const seedPruebas: Prueba[] = [
  {
    id: "prueba-1",
    studyId: seedStudy.id,
    caseId: "case-1",
    tipo: "Informativa",
    titulo: "Informes bancarios de la demandada",
    informante: "Banco Nación — Sucursal Norte",
    estado: "Ofrecida",
    fechaEfectiva: "2026-11-09",
    plazos: [
      {
        id: "plazo-1",
        studyId: seedStudy.id,
        caseId: "case-1",
        pruebaId: "prueba-1",
        tipo: "habiles",
        cantidad: 10,
        fechaEfectiva: "2026-11-09",
        // Verified against lib/plazos: 10 hábiles from Mon 2026-11-09 (count
        // starts Tue 11-10) land on Mon 2026-11-23.
        fechaLimite: "2026-11-23",
      },
    ],
  },
  {
    id: "prueba-2",
    studyId: seedStudy.id,
    caseId: "case-1",
    tipo: "Testimonial",
    titulo: "Testigo del siniestro",
    informante: "Martín Ocampo",
    estado: "Pendiente",
    fechaEfectiva: "2026-11-16",
    plazos: [
      {
        id: "plazo-2",
        studyId: seedStudy.id,
        caseId: "case-1",
        pruebaId: "prueba-2",
        tipo: "corridos",
        cantidad: 5,
        fechaEfectiva: "2026-11-16",
        // Engine check: 2026-11-16 + 5 corridos = 2026-11-21 (no roll-over
        // even though the last day is a Saturday).
        fechaLimite: "2026-11-21",
      },
    ],
  },
  {
    id: "prueba-3",
    studyId: seedStudy.id,
    caseId: "case-2",
    tipo: "Documental",
    titulo: "Inventario de la sucesión",
    informante: "Cliente",
    estado: "Producida",
    fechaEfectiva: "2026-10-28",
    plazos: [
      {
        id: "plazo-3",
        studyId: seedStudy.id,
        caseId: "case-2",
        pruebaId: "prueba-3",
        tipo: "corridos",
        cantidad: 15,
        fechaEfectiva: "2026-10-28",
        fechaLimite: "2026-11-12",
      },
    ],
  },
];

export const seedNotifications: AppNotification[] = [
  {
    id: "notif-1",
    studyId: seedStudy.id,
    userId: seedUser.id,
    titulo: "Vence en 9 días",
    detalle:
      "El plazo de «Informes bancarios de la demandada» vence el 23/11/2026.",
    categoria: "Plazos",
    leida: false,
    createdAt: "2026-11-14T09:00:00.000Z",
    enlace: "/expedientes/case-1?tab=pruebas",
  },
  {
    id: "notif-2",
    studyId: seedStudy.id,
    userId: seedUser.id,
    titulo: "Plazo vencido",
    detalle:
      "El plazo de «Inventario de la sucesión» venció el 12/11/2026.",
    categoria: "Plazos",
    leida: false,
    createdAt: "2026-11-13T08:00:00.000Z",
    enlace: "/expedientes/case-2?tab=pruebas",
  },
  {
    id: "notif-3",
    studyId: seedStudy.id,
    userId: seedUser.id,
    titulo: "Expediente actualizado",
    detalle: "Se registró una nueva actividad en «Pérez, Lucía c/ Municipalidad de San Martín s/ amparo».",
    categoria: "Expedientes",
    leida: true,
    createdAt: "2026-11-12T16:10:00.000Z",
    enlace: "/expedientes/case-3",
  },
];

/** Convenience: unread notification count for the bell badge. */
export const seedUnreadCount = seedNotifications.filter((n) => !n.leida).length;

/**
 * WhatsApp intake seed (Module A, own design — no reference screen).
 * One conversation waiting on the bot, one already handed to a human.
 */
export const seedWaConversations: WaConversation[] = [
  {
    id: "wa-conv-1",
    studyId: seedStudy.id,
    phone: "+54 9 11 4444-0001",
    contactName: "Ramiro Sosa",
    status: "bot",
    unread: 1,
    lastSnippet: "¿Cuánto tiempo tengo para responder la demanda?",
    lastMessageAt: "2026-11-14T10:12:00.000Z",
  },
  {
    id: "wa-conv-2",
    studyId: seedStudy.id,
    phone: "+54 9 11 4444-0002",
    contactName: "Paula Vidal",
    status: "humano",
    unread: 0,
    lastSnippet: "Te paso el número de expediente por privado.",
    lastMessageAt: "2026-11-13T15:40:00.000Z",
  },
];

export const seedWaMessages: WaMessage[] = [
  {
    id: "wa-msg-1",
    conversationId: "wa-conv-1",
    direction: "inbound",
    body: "Hola, quería hacer una consulta sobre un plazo",
    createdAt: "2026-11-14T09:58:00.000Z",
  },
  {
    id: "wa-msg-2",
    conversationId: "wa-conv-1",
    direction: "outbound",
    body: "¡Hola! Soy el asistente del estudio. ¿En qué te puedo ayudar?",
    createdAt: "2026-11-14T09:58:30.000Z",
  },
  {
    id: "wa-msg-3",
    conversationId: "wa-conv-1",
    direction: "inbound",
    body: "¿Cuánto tiempo tengo para responder la demanda?",
    createdAt: "2026-11-14T10:12:00.000Z",
  },
  {
    id: "wa-msg-4",
    conversationId: "wa-conv-2",
    direction: "inbound",
    body: "Buenas, ¿me pasan el número de causa?",
    createdAt: "2026-11-13T15:35:00.000Z",
  },
  {
    id: "wa-msg-5",
    conversationId: "wa-conv-2",
    direction: "outbound",
    body: "Te paso el número de expediente por privado.",
    createdAt: "2026-11-13T15:40:00.000Z",
  },
];

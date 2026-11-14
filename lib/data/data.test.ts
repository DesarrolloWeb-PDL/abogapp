import { beforeEach, describe, expect, it } from "vitest";
import { computeFechaLimite } from "@/lib/plazos";
import {
  createCase,
  createPrueba,
  createStudy,
  getCase,
  getMyStudy,
  getSession,
  handleInboundMessage,
  listCases,
  listNotifications,
  listPruebas,
  markNotificationRead,
  nonWorkingDays,
  onNotificationsChanged,
  signIn,
  signUp,
  unreadCount,
} from "@/lib/data";
import { resetDataStore } from "@/lib/data/store";

/**
 * Contract tests for the fake data layer (T3b).
 *
 * The signatures here are the ones the future Supabase/Drizzle layer must
 * keep, so these tests double as the swap checklist: same behaviour, real
 * database behind it, no screen changes.
 */

const NEW_USER = {
  fullName: "Camila Ferreyra",
  email: "camila@test.com.ar",
  password: "clave-de-prueba",
};

async function signUpWithStudy(studyName: string) {
  const signed = await signUp(NEW_USER);
  if (!signed.ok) throw new Error(`signUp failed: ${signed.error}`);
  const study = await createStudy({
    name: studyName,
    jurisdictions: ["Córdoba"],
  });
  return { session: signed.session, study };
}

/** ART (UTC−3) calendar date of an engine instant, mirroring the data layer. */
function artDate(instant: Date): string {
  return new Date(instant.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDataStore();
});

describe("auth", () => {
  it("signUp opens a session that getSession can read back", async () => {
    const result = await signUp(NEW_USER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = await getSession();
    expect(session?.user.email).toBe(NEW_USER.email);
    expect(session?.user.fullName).toBe(NEW_USER.fullName);
  });

  it("signIn rejects wrong credentials with a typed error code", async () => {
    await signUp(NEW_USER);

    const wrongPassword = await signIn({
      email: NEW_USER.email,
      password: "otra-clave",
    });
    const unknownUser = await signIn({
      email: "nadie@test.com.ar",
      password: "clave-de-prueba",
    });

    expect(wrongPassword).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
    expect(unknownUser).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
  });

  it("signUp refuses a duplicated email", async () => {
    await signUp(NEW_USER);
    const duplicate = await signUp(NEW_USER);

    expect(duplicate).toEqual({ ok: false, error: "email_taken" });
  });
});

describe("studies", () => {
  it("createStudy makes the new study the current one", async () => {
    await signUp(NEW_USER);
    const study = await createStudy({
      name: "Estudio Ferreyra",
      jurisdictions: ["Santa Fe", "Córdoba"],
    });

    const mine = await getMyStudy();
    expect(mine?.id).toBe(study.id);
    expect(mine?.name).toBe("Estudio Ferreyra");
    expect(mine?.jurisdictions).toEqual(["Santa Fe", "Córdoba"]);
  });
});

describe("cases", () => {
  it("createCase persists and the case shows up in listCases", async () => {
    await signUpWithStudy("Estudio Nuevo");

    const created = await createCase({
      caratula: "Gómez, Rosa c/ Empresa de Luz S.A. s/ cobro de pesos",
      numero: "90.111/2026",
      fuero: "Civil y Comercial",
      jurisdiccion: "Córdoba",
      juzgado: "Juzgado Civil N° 4",
    });

    const all = await listCases();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(created.id);
    expect(all[0]?.caratula).toBe(created.caratula);

    const fetched = await getCase(created.id);
    expect(fetched?.id).toBe(created.id);
  });
});

describe("pruebas", () => {
  it("createPrueba computes fecha_limite through the plazos engine", async () => {
    const { study } = await signUpWithStudy("Estudio Nuevo");
    const kase = await createCase({ caratula: "Expediente de prueba" });

    const prueba = await createPrueba({
      caseId: kase.id,
      tipo: "Informativa",
      titulo: "Informe contable del demandado",
      informante: "Estudio contable Rivadavia",
      fechaEfectiva: "2026-11-09",
      plazo: { tipo: "habiles", cantidad: 10 },
    });

    const plazo = prueba.plazos[0];
    expect(plazo).toBeDefined();
    expect(plazo?.fechaLimite).not.toBeNull();

    // The data layer must delegate to the engine — never re-implement math.
    const engineDate = computeFechaLimite({
      fechaEfectiva: "2026-11-09",
      tipo: "habiles",
      cantidad: 10,
      nonWorkingDays,
    });
    expect(plazo?.fechaLimite).toBe(artDate(engineDate));
    expect(plazo?.fechaLimite).toBe("2026-11-23");

    // The stored plazo keeps the inputs the DB trigger would re-read.
    expect(plazo?.tipo).toBe("habiles");
    expect(plazo?.cantidad).toBe(10);
    expect(plazo?.fechaEfectiva).toBe("2026-11-09");
    expect(plazo?.studyId).toBe(study.id);
    expect(plazo?.caseId).toBe(kase.id);
  });

  it("createPrueba emits an unread notification for the plazo", async () => {
    await signUpWithStudy("Estudio Nuevo");
    const kase = await createCase({ caratula: "Expediente notificado" });

    const before = await unreadCount();

    await createPrueba({
      caseId: kase.id,
      tipo: "Testimonial",
      titulo: "Testigo del contrato",
      informante: "Lucía Peralta",
      fechaEfectiva: "2026-11-16",
      plazo: { tipo: "corridos", cantidad: 5 },
    });

    const after = await unreadCount();
    expect(after).toBe(before + 1);

    const notifications = await listNotifications();
    const emitted = notifications.find((item) => !item.leida);
    expect(emitted).toBeDefined();
    expect(emitted?.categoria).toBe("Plazos");
    expect(emitted?.detalle).toContain("Testigo del contrato");
    expect(emitted?.enlace).toBe(`/expedientes/${kase.id}?tab=pruebas`);

    // listPruebas exposes the same prueba with its plazo attached.
    const pruebas = await listPruebas(kase.id);
    expect(pruebas).toHaveLength(1);
    expect(pruebas[0]?.titulo).toBe("Testigo del contrato");
  });
  it("every seeded plazo agrees with the plazos engine", async () => {
    const { seedPruebas } = await import("@/lib/seed");

    for (const prueba of seedPruebas) {
      for (const plazo of prueba.plazos) {
        const engineDate = computeFechaLimite({
          fechaEfectiva: plazo.fechaEfectiva,
          tipo: plazo.tipo,
          cantidad: plazo.cantidad,
          nonWorkingDays,
        });
        expect(plazo.fechaLimite).toBe(artDate(engineDate));
      }
    }
  });
});

describe("notifications", () => {
  it("markNotificationRead lowers the unread count and notifies subscribers", async () => {
    await signUpWithStudy("Estudio Nuevo");
    const kase = await createCase({ caratula: "Expediente avisado" });

    // createPrueba emits the only notification of this (new) user, so the
    // seed rows of the demo user are never mutated by this test.
    await createPrueba({
      caseId: kase.id,
      tipo: "Testimonial",
      titulo: "Aviso de vencimiento",
      informante: "Lucía Peralta",
      fechaEfectiva: "2026-11-16",
      plazo: { tipo: "corridos", cantidad: 5 },
    });

    const before = await unreadCount();
    expect(before).toBeGreaterThan(0);

    // The shell badge subscribes to this seam to re-read the count.
    let changes = 0;
    const unsubscribe = onNotificationsChanged(() => {
      changes += 1;
    });

    const [emitted] = await listNotifications();
    expect(emitted).toBeDefined();
    if (!emitted) return;
    await markNotificationRead(emitted.id);
    unsubscribe();

    expect(changes).toBe(1);
    expect(await unreadCount()).toBe(before - 1);
    expect(await unreadCount()).toBe(0);

    // Marking an already-read notification again must not re-notify.
    let extra = 0;
    const off = onNotificationsChanged(() => {
      extra += 1;
    });
    await markNotificationRead(emitted.id);
    off();
    expect(extra).toBe(0);
  });
});

describe("whatsapp", () => {
  it("handleInboundMessage replies to a greeting", async () => {
    const result = await handleInboundMessage({
      phone: "+54 9 11 5555-0101",
      contactName: "Marina Duarte",
      text: "Hola, ¿me pueden ayudar con una consulta?",
    });

    expect(result.botReply).toBeTruthy();
    expect(result.conversation.status).toBe("bot");
    expect(result.conversation.contactName).toBe("Marina Duarte");
  });

  it("handleInboundMessage respects STOP and stays silent afterwards", async () => {
    const phone = "+54 9 11 5555-0202";

    const greeting = await handleInboundMessage({ phone, text: "Buenas!" });
    expect(greeting.botReply).toBeTruthy();

    const stopped = await handleInboundMessage({ phone, text: "STOP" });
    expect(stopped.botReply).toBeNull();
    expect(stopped.conversation.status).toBe("cerrada");

    const afterStop = await handleInboundMessage({ phone, text: "hola?" });
    expect(afterStop.botReply).toBeNull();
    expect(afterStop.conversation.status).toBe("cerrada");
  });
});

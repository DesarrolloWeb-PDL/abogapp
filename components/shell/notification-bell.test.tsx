import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { AppNotification } from "@/lib/types";
import {
  BellPanel,
  bellItemReadOnOpen,
  bellPanelReducer,
  bellTabEstado,
  formatBellBadge,
  initialBellPanelState,
  loadBellPanelPage,
  type BellPanelProps,
} from "./notification-bell-panel";
import { NotificationBell } from "./notification-bell";

/**
 * Bell dropdown behaviour (S21 / T3): the panel opens, its Todas/No leídas
 * tabs drive the SAME `listNotificationsPage` driver /notificaciones reads
 * with, and the pre-existing badge cap + read-on-click path keep working.
 *
 * Node environment (no jsdom/RTL in the dependency tree — vitest.config.ts):
 * the state machine and the driver wiring are asserted directly, the panel
 * markup through react-dom/server, and the closed trigger through SSR of the
 * real NotificationBell. The DOM interaction (open, filtering, deep link) is
 * covered end-to-end by e2e/bell.spec.ts.
 */

// The panel only ever reads (and marks) through the data layer, so the mock
// exposes exactly those seams — any new import from "@/lib/data" fails here
// until the mock (and the review it forces) catches up.
vi.mock("@/lib/data", () => ({
  listNotificationsPage: vi.fn(async () => ({
    items: [],
    hasMore: false,
    total: 0,
  })),
  listNotifications: vi.fn(async () => []),
  markNotificationRead: vi.fn(async () => undefined),
  unreadCount: vi.fn(async () => 0),
  onNotification: vi.fn(() => () => {}),
  onNotificationsChanged: vi.fn(() => () => {}),
  listNotificationPreferences: vi.fn(async () => []),
  updateNotificationPreference: vi.fn(async () => ({
    category: "",
    inApp: true,
    email: true,
  })),
  NOTIFICATION_CATEGORIES: [
    { value: "sistemas_judiciales", label: "Sistemas judiciales" },
    { value: "tareas", label: "Tareas" },
    { value: "causas", label: "Causas" },
    { value: "equipo", label: "Equipo" },
    { value: "facturacion", label: "Facturación" },
    { value: "novedades_consejos", label: "Novedades y consejos" },
  ],
}));

// next/link renders an <a> in the server tree; the mock keeps the test
// independent of the Next.js runtime (the e2e suite exercises the real one).
vi.mock("next/link", () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { listNotificationsPage, markNotificationRead } from "@/lib/data";

const unreadItem: AppNotification = {
  id: "notif-unread",
  studyId: "study-1",
  userId: "user-1",
  titulo: "Vence el 23/11/2026",
  detalle: "El plazo de la causa vence en 5 días.",
  categoria: "Plazos",
  leida: false,
  createdAt: "2026-11-18T14:00:00.000Z",
  enlace: "/expedientes/case-1",
};

const readItem: AppNotification = {
  ...unreadItem,
  id: "notif-read",
  titulo: "Tarea completada",
  leida: true,
  enlace: null,
};

function baseProps(overrides: Partial<BellPanelProps> = {}): BellPanelProps {
  return {
    panelId: "bell-panel",
    tab: "todas",
    status: "ready",
    items: [unreadItem, readItem],
    unread: 1,
    onTabChange: () => {},
    onMarkAll: () => {},
    onPreferences: () => {},
    onRetry: () => {},
    onSelectItem: () => {},
    onClose: () => {},
    ...overrides,
  };
}

/** Every rendered <button role="tab">, in DOM order. */
function renderedTabs(html: string): string[] {
  return html.match(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bell panel open state", () => {
  it("starts closed and opens on toggle", () => {
    expect(initialBellPanelState).toEqual({ open: false, tab: "todas" });
    expect(bellPanelReducer(initialBellPanelState, { type: "toggle" })).toEqual(
      { open: true, tab: "todas" },
    );
  });

  it("closes from any state and resets the tab to Todas", () => {
    const opened = bellPanelReducer(initialBellPanelState, { type: "toggle" });
    const onNoLeidas = bellPanelReducer(opened, {
      type: "tab",
      tab: "no_leidas",
    });
    expect(onNoLeidas).toEqual({ open: true, tab: "no_leidas" });

    expect(bellPanelReducer(onNoLeidas, { type: "close" })).toEqual({
      open: false,
      tab: "todas",
    });
    // Toggling while open closes (and resets) too.
    expect(bellPanelReducer(onNoLeidas, { type: "toggle" })).toEqual({
      open: false,
      tab: "todas",
    });
  });
});

describe("Todas / No leídas filtering", () => {
  it("maps each tab onto the estado the page filters with", () => {
    expect(bellTabEstado("todas")).toBe("todas");
    expect(bellTabEstado("no_leidas")).toBe("no_leidas");
  });

  it("reads through listNotificationsPage — the driver /notificaciones uses", async () => {
    await loadBellPanelPage("todas");
    expect(listNotificationsPage).toHaveBeenCalledWith({ estado: "todas" });

    await loadBellPanelPage("no_leidas");
    expect(listNotificationsPage).toHaveBeenCalledWith({
      estado: "no_leidas",
    });
  });

  it("renders aria-selected on exactly the active tab", () => {
    const todas = renderToStaticMarkup(<BellPanel {...baseProps()} />);
    const todasTabs = renderedTabs(todas);
    expect(todasTabs).toHaveLength(2);
    const selectedTodas = todasTabs.filter((tab) =>
      tab.includes('aria-selected="true"'),
    );
    expect(selectedTodas).toHaveLength(1);
    expect(selectedTodas[0]).toContain("Todas");
    expect(todas).toContain('aria-labelledby="bell-panel-tab-todas"');

    const noLeidas = renderToStaticMarkup(
      <BellPanel {...baseProps({ tab: "no_leidas" })} />,
    );
    const selectedNoLeidas = renderedTabs(noLeidas).filter((tab) =>
      tab.includes('aria-selected="true"'),
    );
    expect(selectedNoLeidas).toHaveLength(1);
    expect(selectedNoLeidas[0]).toContain("No leídas");
    expect(noLeidas).toContain('aria-labelledby="bell-panel-tab-no_leidas"');
  });
});

describe("panel markup", () => {
  it("is a named dialog with tabs, rows, actions and the page escape", () => {
    const html = renderToStaticMarkup(<BellPanel {...baseProps()} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Notificaciones"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('href="/notificaciones"');
    expect(html).toContain("Ver la lista completa");
    expect(html).toContain("Marcar todas como leídas");
    expect(html).toContain("Preferencias");
  });

  it("renders deep links with read state that is never colour-only", () => {
    const html = renderToStaticMarkup(<BellPanel {...baseProps()} />);
    expect(html).toContain('href="/expedientes/case-1"');
    expect(html).toContain("(sin leer)");
    expect(html).toContain("(leída)");
    // Weight carries the read state alongside the dot and the sr-only text.
    expect(html).toContain("text-base font-semibold text-text");
    expect(html).toContain("text-base font-medium text-text-muted");
  });

  it("shows loading, error and the per-tab empty copy", () => {
    const loading = renderToStaticMarkup(
      <BellPanel {...baseProps({ status: "loading", items: [] })} />,
    );
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Cargando notificaciones");

    const error = renderToStaticMarkup(
      <BellPanel {...baseProps({ status: "error", items: [] })} />,
    );
    expect(error).toContain("No pudimos cargar las notificaciones.");
    expect(error).toContain("Reintentar");

    const emptyTodas = renderToStaticMarkup(
      <BellPanel {...baseProps({ items: [] })} />,
    );
    expect(emptyTodas).toContain("No hay notificaciones nuevas.");

    const emptyNoLeidas = renderToStaticMarkup(
      <BellPanel {...baseProps({ tab: "no_leidas", items: [] })} />,
    );
    expect(emptyNoLeidas).toContain(
      "Estás al día con las novedades de tu estudio.",
    );
  });

  it("disables mark-all while nothing is unread", () => {
    // Match the ATTRIBUTE, not the `disabled:` utilities in the class list.
    const enabled = renderToStaticMarkup(<BellPanel {...baseProps()} />);
    expect(enabled).not.toContain('disabled=""');

    const disabled = renderToStaticMarkup(
      <BellPanel {...baseProps({ unread: 0 })} />,
    );
    expect(disabled).toContain('disabled=""');
  });
});

describe("NotificationBell trigger (closed state)", () => {
  it("renders a button with aria-expanded and no panel while closed", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <NotificationBell />
      </ToastProvider>,
    );
    // The bell opens a panel: it is a disclosure button, never a link.
    expect(html).toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).toContain('aria-expanded="false"');
    // unreadCount() resolves to 0 after hydration only — SSR shows no badge.
    expect(html).toContain('aria-label="Notificaciones"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-selected");
  });
});

describe("regression: badge cap + read-on-click path", () => {
  it("keeps the 9+ badge cap and marks read through the data layer on click", () => {
    // Badge (pre-existing shell behaviour): hidden at 0, capped at 9+.
    expect(formatBellBadge(0)).toBeNull();
    expect(formatBellBadge(4)).toBe("4");
    expect(formatBellBadge(9)).toBe("9");
    expect(formatBellBadge(10)).toBe("9+");
    expect(formatBellBadge(128)).toBe("9+");

    // Read-on-click (pre-existing page behaviour, now reached from the
    // dropdown): an unread row writes once through markNotificationRead…
    bellItemReadOnOpen(unreadItem);
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
    expect(markNotificationRead).toHaveBeenCalledWith("notif-unread");

    // …and an already-read row never writes again.
    bellItemReadOnOpen(readItem);
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
  });
});

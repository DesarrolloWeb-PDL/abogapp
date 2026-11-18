import type { Metadata } from "next";
import { BotSettingsView } from "./bot-settings-view";

export const metadata: Metadata = { title: "Configuración del bot" };

/**
 * WhatsApp bot settings (/configuracion/bot) — Unit 1 of the WhatsApp
 * phase: the study edits the bot's message strings instead of the copy that
 * used to be hardcoded in lib/data/bot.ts, and switches the bot on/off.
 */
export default function ConfiguracionBotPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Configuración del bot</h1>
        <p className="text-base text-text-muted">
          Personalizá cómo responde el asistente de WhatsApp en tu estudio.
          Los cambios se aplican a las próximas conversaciones.
        </p>
      </div>

      <BotSettingsView />
    </div>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;

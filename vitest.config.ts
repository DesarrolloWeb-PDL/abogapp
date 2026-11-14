import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest setup for the M1 slice (T1).
 * Node environment: the first tests cover the data layer / plazos math (T3),
 * which are pure functions. jsdom + React Testing Library come later if the
 * component tests need them (Next.js docs: 01-app/02-guides/testing/vitest.md).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});

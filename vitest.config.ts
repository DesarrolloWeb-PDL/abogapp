import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest setup (T1, extended by the backend phase).
 * Node environment: the suite covers the data layer / plazos math (pure
 * functions) plus route handlers with mocked sessions/clients — no live
 * Supabase project. jsdom + React Testing Library come later if the
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
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});

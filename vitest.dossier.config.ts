import { defineConfig } from "vitest/config";

// Runs scripts/feel-dossier.run.ts (a headless report, not a test) with the
// same Rapier resolution settings as vitest.config.ts. `npm run feel-dossier`.
export default defineConfig({
  resolve: { mainFields: ["module", "main"] },
  ssr: { resolve: { mainFields: ["module", "main"] } },
  test: {
    environment: "node",
    server: { deps: { inline: ["@dimforge/rapier3d"] } },
    include: ["scripts/feel-dossier.run.ts"],
    testTimeout: 120_000,
  },
});

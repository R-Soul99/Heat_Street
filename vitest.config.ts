import { defineConfig } from "vitest/config";

// @dimforge/rapier3d@0.20.0's package.json has a `module` field but no `main`
// and no `exports` map. Vite's client resolution includes `module` by default so
// the browser build works, but the Node/SSR path Vitest uses does not — without
// all three settings below every Rapier test dies at import with
// `Failed to resolve entry for package "@dimforge/rapier3d"`.
export default defineConfig({
  resolve: { mainFields: ["module", "main"] },
  ssr: { resolve: { mainFields: ["module", "main"] } },
  test: {
    environment: "node",
    server: { deps: { inline: ["@dimforge/rapier3d"] } },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  // DEVIATION from 01-01-PLAN.md, which forbade this key on RESEARCH.md's claim
  // that Vite 8.2.2 pre-bundles Rapier correctly. That claim was verified only at
  // the "dev server serves the rewritten wasm import with a 200" level, not by
  // executing it. Executing it in headless Chrome fails with
  //   Uncaught TypeError: Cannot set properties of undefined (setting '0')
  //   at rapier_wasm3d_bg.js  __wbg_set_index_aac0f95bd3ef91b6
  // Cause: esbuild inlines a COPY of rapier_wasm3d_bg.js into
  // node_modules/.vite/deps/@dimforge_rapier3d.js while externalising the .wasm.
  // Vite's generated wasm-instance module then builds the wasm import object from
  // the RAW node_modules copy of the same glue. Two glue module instances means
  // two `heap` arrays: the wasm calls back into the raw copy, whose heap never
  // received the objects the bundled copy allocated, so getObject() is undefined.
  // Excluding the package from pre-bundling leaves exactly one glue instance.
  // This is the conditional fallback CLAUDE.md documents under "Version
  // Compatibility": add optimizeDeps.exclude if the dev server pre-bundler chokes.
  // Production builds were unaffected either way (Rollup keeps a single glue).
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d"],
  },
  build: {
    // Rapier's .wasm ESM import makes the importing module an async module,
    // which requires top-level await support.
    target: "esnext",
    // Vite's default base64-inlines assets below the threshold. The Rapier
    // .wasm is 2.02 MB; inlining it bloats the JS bundle and defeats separate
    // asset caching.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
});

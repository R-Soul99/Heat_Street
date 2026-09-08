---
phase: 01
slug: engine-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-08
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest@5.0.0 |
| **Config file** | none — Wave 0 creates `vitest.config.ts` (MUST include `resolve.mainFields` + `ssr.resolve.mainFields` + `server.deps.inline` so `@dimforge/rapier3d` resolves — see RESEARCH.md Pitfall 3) |
| **Quick run command** | `npx vitest run tests/sim-clock.test.ts` (~0.2s, no WASM) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~2-5 seconds |

Also required per commit/wave: `npx tsc --noEmit` (typecheck) and `npx biome check .` (lint).

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/sim-clock.test.ts && npx tsc --noEmit`
- **After every plan wave:** `npx vitest run && npx tsc --noEmit && npx biome check .`
- **Before `/gsd-verify-work`:** Full suite green, plus four manual browser checks (SC2 judder at 30/60/144Hz, SC3 real 60s alt-tab, SC4 HUD contents, `?debug` gating)
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-xx | 01 | 0 | VEH-03 | — | N/A | setup | `npm i -D vitest@5.0.0 && npx vitest --version` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | VEH-03 / SC1 | — | N/A | unit | `npx vitest run tests/determinism.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | VEH-03 / SC1 | — | N/A | unit | `npx vitest run tests/determinism.test.ts -t "input tape"` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | VEH-03 / SC1 | — | N/A | unit | `npx vitest run tests/determinism.test.ts -t "sensitive"` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC1 | — | N/A | unit | `npx vitest run tests/sim-clock.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC2 | — | N/A | unit | `npx vitest run tests/interpolation.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC2 | — | N/A | manual | — (requires real display at multiple refresh rates) | n/a | ⬜ pending |
| 01-xx-xx | 01 | ? | SC3 | — | N/A | unit | `npx vitest run tests/sim-clock.test.ts -t "stall"` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC3 | — | N/A | unit | `npx vitest run tests/sim-clock.test.ts -t "rebaseline"` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC3 | — | N/A | manual | — (real 60s alt-tab in browser) | n/a | ⬜ pending |
| 01-xx-xx | 01 | ? | SC4 | — | N/A | unit | `npx vitest run tests/frame-budget.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC4 | — | N/A | manual | — (requires real WebGL context) | n/a | ⬜ pending |
| 01-xx-xx | 01 | ? | SC5 | V14 Config | Pinned exact versions, no Google Maps pipeline recommended without supersession pointer | unit | `npx vitest run tests/docs-present.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC5 | — | N/A | unit | `npx vitest run tests/road-graph-schema.test.ts` | ❌ W0 | ⬜ pending |
| 01-xx-xx | 01 | ? | SC5 | Tampering | No file recommends Google Maps pipeline without supersession pointer | unit (grep) | `npx vitest run tests/no-google-pipeline.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are placeholders — the planner assigns real IDs; this table's rows must be satisfied by whatever IDs it produces.*

---

## Wave 0 Requirements

- [ ] `package.json` — project init (does not exist yet — greenfield)
- [ ] `tsconfig.json` — `moduleResolution: bundler`, verified clean with `typescript@7.0.2`
- [ ] `vite.config.ts` — `build.target: 'esnext'`, `assetsInlineLimit: 0`
- [ ] `vitest.config.ts` — MUST include `resolve.mainFields` + `ssr.resolve.mainFields` + `server.deps.inline`, or every Rapier-importing test fails to resolve (covers SC1/VEH-03)
- [ ] `biome.json` — per CONTEXT.md D-08
- [ ] `tests/sim-clock.test.ts` — covers SC1, SC3
- [ ] `tests/determinism.test.ts` — covers VEH-03, SC1
- [ ] `tests/interpolation.test.ts` — covers SC2
- [ ] `tests/frame-budget.test.ts` — covers SC4
- [ ] `tests/road-graph-schema.test.ts`, `tests/docs-present.test.ts`, `tests/no-google-pipeline.test.ts` — cover SC5
- [ ] Framework install: `npm i -D vitest@5.0.0`

**Sequencing note (from RESEARCH.md):** put "install deps + `vitest.config.ts` + a trivial `RAPIER.version()` smoke test" in the very first wave — a ten-minute task that de-risks the entire phase's verification strategy and fails loudly/immediately if the resolver config is wrong.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Judder visually absent at 30/60/144Hz | SC2 | Requires a real display running at multiple refresh rates | Set OS/monitor refresh rate to 30, 60, 144Hz in turn; observe the debug scene's falling/spinning body for visible stutter |
| Real 60s alt-tab produces no teleport/explosion/fast-forward | SC3 | Unit test covers the rebaseline mechanism; this covers actual browser tab-visibility wiring | Alt-tab away from the running debug scene for 60+ seconds, return, observe the simulation resumes at 1x real-time with no jump |
| HUD shows physics ms, render ms, draw calls, triangles, body count vs. budget | SC4 | Needs a real WebGL context | Toggle HUD with the dedicated key behind `?debug`; visually confirm all 5 fields render and the frame-budget comparison is visible |
| `?debug` query param gates HUD correctly | SC4 / V5 | Requires a real browser URL | Load without `?debug` (HUD absent), load with `?debug` (HUD present); confirm the value is never rendered into the DOM (presence check only) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 3
slug: surfaces-helicopter-camera
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (already configured, `environment: "node"`, no jsdom) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/<new-file>.test.ts` |
| **Full suite command** | `npm run check` (typecheck + lint + `vitest run`) |
| **Estimated runtime** | ~30 seconds |

**Environment constraint:** `vitest.config.ts` uses `environment: "node"` with no jsdom —
`document`, `HTMLCanvasElement`, `AudioContext` and WebGL are all unavailable in tests. Pure
logic (`SurfaceMap` lookups, `SURFACE_PROFILES`, camera heading/altitude/FOV math, occlusion
decision logic) is directly unit-testable; anything touching `THREE.PositionalAudio`,
`AudioContext`, `THREE.WebGLRenderer`, or DOM class toggling is manual-only.

---

## Sampling Rate

- **After every task commit:** Run the relevant new pure-logic test file(s)
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite must be green, PLUS human playtest sessions for
  SC3/SC4/SC6 (camera drift stability, speed legibility, occlusion mitigation choice) — these
  cannot be automated away
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-xx | 01 | 0 | SURF-01 | — | N/A | unit | `npx vitest run tests/surface.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-xx | 01 | 0 | SURF-01 | — | N/A | unit | `npx vitest run tests/surface-telemetry.test.ts -t skidpad` | ❌ W0 | ⬜ pending |
| 03-01-xx | 01 | — | SURF-02 | — | N/A | manual | — (visual/audio distinctness; no jsdom/AudioContext) | n/a | ⬜ pending |
| 03-02-xx | 02 | 0 | CAM-01 | — | N/A | unit | `npx vitest run tests/camera-heading.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-xx | 02 | 0 | CAM-02 | — | N/A | unit | `npx vitest run tests/camera-framing.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-xx | 02 | 0 | CAM-03 | — | N/A | unit | `npx vitest run tests/camera-skin.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-xx | 02 | 0 | CAM-04 | — | N/A | unit | `npx vitest run tests/occlusion.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-xx | 02 | — | CAM-04 (SC6) | — | N/A | manual | — (explicit human playtest, not a paper decision, per CONTEXT.md D-06) | n/a | ⬜ pending |
| 03-02-xx | 02 | — | SC3 | — | N/A | manual | — (drift stability/no-shake is a perceptual judgment, D-11) | n/a | ⬜ pending |
| 03-02-xx | 02 | — | SC4 | — | N/A | manual | — (60 vs 110mph legibility, explicit go/no-go human playtest gate, D-12) | n/a | ⬜ pending |
| 03-xx-xx | any | any | V5 (tuning input validation) | T-3-01 | New tunables run through `clampTuning`/`parseSavedTuning`-style pipeline, never reach a Rapier setter or THREE API unclamped | unit | `npx vitest run tests/<tuning-extension>.test.ts` | ❌ W0 | ⬜ pending |

*Exact task IDs to be finalized by the planner; this table's rows map 1:1 to the phase requirements above and must be reconciled against the actual PLAN.md task IDs once written.*

---

## Wave 0 Requirements

- [ ] `tests/surface.test.ts` — covers `SurfaceMap` lookup/register logic (known handle → registered surface; unknown/undefined handle → default)
- [ ] `tests/surface-telemetry.test.ts` — extends the existing `runRoutine`/`ROUTINES` telemetry harness (`src/physics/telemetry/run.ts`) with a per-surface skidpad sweep — the direct automated proof of SC1's "measurable grip change"
- [ ] `tests/camera-heading.test.ts` — pure-function test for the velocity-heading/chassis-forward blend across the low-speed threshold
- [ ] `tests/camera-framing.test.ts` — pure-function test asserting the altitude/FOV curve is monotonic in speed and clamps at the cap
- [ ] `tests/camera-skin.test.ts` — asserts the skin-switch function does not touch camera-rig state (distance/damping/target)
- [ ] `tests/occlusion.test.ts` — pure-function test for the fade/steepen decision logic, fed hand-built fake raycast-hit arrays (mirroring `debug-gate.test.ts`'s Node-safe fake style)
- [ ] No new test framework/config needed — Vitest is already fully configured for this style of pure-logic test

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Surface visual (tire smoke/dust/mud spray/skid decal) and audio (chirp vs. muffled rumble) distinctness | SURF-02 | Requires seeing/hearing rendered output; no jsdom/AudioContext in the harness | Drive across each of the 6 surfaces in the debug scene and confirm distinct FX + audio per surface |
| Camera reads as stable through a full 40-degree drift, no shake/jitter | SC3 (CAM-01/02) | "No shake or jitter" is a perceptual judgment (D-11) | Script or manually perform a 40-degree drift; playtester confirms camera stays stable |
| 60mph vs 110mph visually distinguishable via altitude/FOV shift | SC4 (CAM-02) | Explicit go/no-go human playtest gate (D-12) | Drive at 60mph then 110mph; playtester confirms they can tell the difference on sight |
| Fade vs. steepen occlusion mitigation — which reads best | SC6 (CAM-04) | Explicit "not a paper decision" human playtest gate (D-06) | Prototype both mitigations in a dense-building area; playtester picks the winner |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

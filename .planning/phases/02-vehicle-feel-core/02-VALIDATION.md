---
phase: 02
slug: vehicle-feel-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-08
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest@5.0.0 |
| **Config file** | `vitest.config.ts` (Rapier resolver settings already correct — do not change) |
| **Quick run command** | `npx vitest run tests/vehicle-telemetry.test.ts` |
| **Full suite command** | `npm run check` (`tsc --noEmit && biome check . && vitest run`) |
| **Estimated runtime** | ~1s quick / full suite per `npm run check` |

> Note: `--reporter=basic` does not exist in Vitest 5 and errors at startup; use the default reporter, or `--reporter=verbose --silent=false` when console output is needed from a test.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/vehicle-telemetry.test.ts tests/live-input.test.ts`
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite must be green, then the browser telemetry run against live-tuned values
- **Max feedback latency:** ~1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-accel | TBD | TBD | VEH-01 | — | 0-60 mph in 6.0–7.0s at default tuning | integration (headless physics) | `npx vitest run tests/vehicle-telemetry.test.ts -t accel` | ❌ W0 | ⬜ pending |
| TBD-brake | TBD | TBD | VEH-01 | — | 60-0 mph in 110–135 ft | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t brake` | ❌ W0 | ⬜ pending |
| TBD-skidpad | TBD | TBD | VEH-01 | — | Skidpad 0.75–1.05 lateral g | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t skidpad` | ❌ W0 | ⬜ pending |
| TBD-handbrake | TBD | TBD | VEH-01 | — | Handbrake produces >25° slip, recovers below 5° within 2.5s | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t handbrake` | ❌ W0 | ⬜ pending |
| TBD-brake-understeer | TBD | TBD | VEH-01 (D-04) | — | Cornering radius under braking > cornering radius while coasting | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t brake-understeer` | ❌ W0 | ⬜ pending |
| TBD-brake-wins | TBD | TBD | VEH-01 (Pitfall 7) | — | Throttle + brake together decelerates | unit | `npx vitest run tests/vehicle.test.ts -t "brake wins"` | ❌ W0 | ⬜ pending |
| TBD-ramp-input | TBD | TBD | VEH-02 | — | Keyboard ramp reaches full lock in 0.40s ± 1 tick, independent of call pattern | unit (pure) | `npx vitest run tests/live-input.test.ts` | ❌ W0 | ⬜ pending |
| TBD-idempotent | TBD | TBD | VEH-02 | — | `sampleForTick(n)` twice returns an identical frame | unit (pure) | `npx vitest run tests/live-input.test.ts -t idempotent` | ❌ W0 | ⬜ pending |
| TBD-gamepad | TBD | TBD | VEH-02 | — | Gamepad analog axes bypass the ramp; deadzone applied | unit (pure, injected pad snapshot) | `npx vitest run tests/live-input.test.ts -t gamepad` | ❌ W0 | ⬜ pending |
| TBD-steer-sign | TBD | TBD | VEH-02 | — | `steer = +1` yields a negative yaw rate (right turn) | integration | `npx vitest run tests/vehicle.test.ts -t "steer sign"` | ❌ W0 | ⬜ pending |
| TBD-ramp-jump | TBD | TBD | VEH-04 | — | 120 mph launch lands with tilt < 20° and forward speed > 40 mph | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t ramp` | ❌ W0 | ⬜ pending |
| TBD-ramp-no-assist | TBD | TBD | VEH-04 | — | Auto-level assist disabled ⇒ the ramp test above fails (proves the assist is load-bearing) | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t "ramp without assist"` | ❌ W0 | ⬜ pending |
| TBD-reproducible | TBD | TBD | VEH-03 (regression) | — | Two identical scripted telemetry runs produce identical `takeSnapshot()` hashes | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t reproducible` | ❌ W0 | ⬜ pending |
| TBD-stability | TBD | TBD | SC3 / D-08 | — | Full lock at 60 mph for 5s: max tilt < 15° | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t stability` | ❌ W0 | ⬜ pending |
| TBD-roll-assist | TBD | TBD | D-06 | — | Body-roll assist at default gain never exceeds 15° tilt in any routine | integration | `npx vitest run tests/vehicle-telemetry.test.ts -t "roll assist stability"` | ❌ W0 | ⬜ pending |
| TBD-speedo | TBD | TBD | NAV-01 | — | mph conversion and needle-angle mapping pure/correct at 0/60/160/200 mph (clamped) | unit (pure formatter) | `npx vitest run tests/speedometer.test.ts` | ❌ W0 | ⬜ pending |
| TBD-damping | TBD | TBD | NAV-01 | — | Digit damping is framerate-independent (same settle time at 16.7ms and 6.9ms steps) | unit (pure) | `npx vitest run tests/speedometer.test.ts -t damping` | ❌ W0 | ⬜ pending |
| TBD-persist | TBD | TBD | D-17 | — | `gui.save()` round-trips through JSON and `gui.load()`; corrupt blob discarded not thrown | unit | `npx vitest run tests/tuning-persist.test.ts` | ❌ W0 | ⬜ pending |
| TBD-layering | TBD | TBD | Layering | — | `src/input/` and `src/hud/` obey layering rules; no `innerHTML`; no `performance.now()` outside `loop.ts`/`src/debug/` | unit (source scan) | `npx vitest run tests/layering.test.ts` | ✅ exists — MODIFY | ⬜ pending |
| TBD-playtest | TBD | TBD | SC1 / SC2 / SC5 | — | Slide reads as a big recoverable drift; steering feels smooth on both devices; car reads as a heavy muscle car | manual-only | human playtest checkpoint | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are placeholders (TBD-*) — the planner assigns real plan/wave/task IDs; this map's requirement→test coverage must be preserved when it does.*

---

## Wave 0 Requirements

- [ ] `src/physics/telemetry/routines.ts` + `run.ts` — the shared telemetry harness; **this is the true wave-0 blocker**, six of the tests below import it
- [ ] `tests/vehicle-telemetry.test.ts` — covers VEH-01, VEH-04, SC3, D-04, D-06 stability
- [ ] `tests/vehicle.test.ts` — covers the steering sign and the throttle-vs-brake exclusion
- [ ] `tests/live-input.test.ts` — covers VEH-02
- [ ] `tests/speedometer.test.ts` — covers NAV-01's pure half
- [ ] `tests/tuning-persist.test.ts` — covers D-17
- [ ] `tests/layering.test.ts` — modify: add `src/input/` and `src/hud/` rules
- [ ] Framework install: none — Vitest and the Rapier resolver config already work

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slide reads as a big, readable, recoverable drift (Bullitt reference) | SC1 | Perceptual judgement of "readable" — not machine-checkable | Play with `?debug` tuning panel open; provoke oversteer via throttle and handbrake; counter-steer to catch; confirm the slide is visually legible and recoverable |
| Steering feels smooth on keyboard (ramped) and gamepad (analog) | SC2 | Perceptual judgement of "smooth" | Drive with keyboard, then gamepad; confirm no twitchiness or binary snap-to-lock feel |
| Car reads as a "heavy muscle car" per Bullitt anchor | SC5 | Subjective feel sign-off explicitly required by the phase's success criteria | Full playtest session against the scripted telemetry track results; human sign-off required before phase close |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s (quick command)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

# Phase 2: Vehicle Feel Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 2-vehicle-feel-core
**Areas discussed:** Drift & oversteer control scheme, Feel reference anchor, Speedometer/gauge visual style, Telemetry targets & tuning panel scope

---

## Drift & Oversteer Control Scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, dedicated handbrake | Locks rear-wheel friction near-zero on press, reliable/learnable slide trigger | ✓ |
| No — throttle/weight-transfer only | Oversteer purely from throttle lift, late braking, steering | |
| Both | Handbrake for hard entries + throttle-oversteer for subtler slides | |

**User's choice:** Yes, dedicated handbrake (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Light assist | Subtle stabilizing yaw torque helps catch borderline slides | ✓ |
| No assist — raw physics | Counter-steering 100% on the player, real friction/slip only | |

**User's choice:** Light assist (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Lock-up / skid loss of steering | Braking too hard while turning reduces front grip, car skids straight | ✓ |
| Longer stopping distance only | Full steering retained, only consequence is running out of road | |

**User's choice:** Lock-up / skid loss of steering (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Binary | Simple on/off handbrake input | ✓ |
| Analog | Variable intensity via gamepad trigger | |

**User's choice:** Binary (Recommended)

**Notes:** None beyond the above.

---

## Feel Reference Anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Bullitt's Mustang chase (film) | Heavy, momentum-driven, hard body-roll, tire chirp on direction changes | ✓ |
| The Crew / Forza Horizon | Modern arcade-realistic hybrid benchmark | |
| Driver / Burnout | More exaggerated, drift-happy, less sim-grounded | |

**User's choice:** Bullitt's Mustang chase (film)

| Option | Description | Selected |
|--------|-------------|----------|
| Visible body roll & weight transfer | Car visibly leans/dives/squats, reads as heavy | ✓ |
| Momentum & commitment to a line | Resists snap turns, rewards planning ahead | |
| Both equally | Co-equal priorities | |

**User's choice:** Visible body roll & weight transfer (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-level assist | Gentle in-air torque nudges chassis toward wheels-down landing | ✓ |
| No assist — momentum carries rotation | Whatever rotation existed at takeoff continues in air | |

**User's choice:** Auto-level assist (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Assist layer | Speed-scaled downforce/anti-roll torque on top of physics | ✓ |
| Pure physical tuning only | Rely entirely on CoM, track width, suspension | |

**User's choice:** Assist layer (Recommended)

**Notes:** User raised a freeform question mid-discussion: should NPC vehicles (pursuers/AI racers) use the same physics as the player? Resolved: yes, same vehicle controller/tuning for consistency, but built generically (not player-hardcoded) so Phase 7/8 can reuse it for pursuers; NPCs far from the player fall back to a cheaper kinematic model per CLAUDE.md's existing LOD guidance. Actual NPC AI logic and LOD-switching remain out of Phase 2 scope. User confirmed this understanding was correct.

---

## Speedometer/Gauge Visual Style

| Option | Description | Selected |
|--------|-------------|----------|
| Retro analog gauge | Period-correct circular needle, amber redline, white numerals | ✓ |
| Modern neutral HUD gauge | Flat design, no skeuomorphic dial texture | |

**User's choice:** Retro analog gauge — **correction applied mid-discussion**: the tool initially recorded "Modern neutral HUD gauge" as selected; the user flagged this was wrong and confirmed retro analog was the intended answer. CONTEXT.md reflects the corrected decision (D-10).

| Option | Description | Selected |
|--------|-------------|----------|
| mph | Matches American muscle-car/chase-cinema setting | ✓ |
| kph | Metric readout | |
| Both (toggle) | Selectable, adds settings surface | |

**User's choice:** mph (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom-right corner, 0–160mph | Racing-game convention, doesn't block road view | ✓ |
| Bottom-center, 0–160mph | More prominent/cinematic, covers more screen | |

**User's choice:** Bottom-right corner, 0–160mph range (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Slight damping | Smoothing filter avoids flickery digit-jitter | ✓ |
| Instant/raw | Always shows exact current speed | |

**User's choice:** Slight damping (Recommended)

**Notes:** See correction above.

---

## Telemetry Targets & Tuning Panel Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Real-ish muscle-car figures | ~6-7s 0-60, ~120ft braking, grounded in period-correct performance | ✓ |
| Arcade-exaggerated | Faster/shorter than realistic, prioritizes fun over grounded numbers | |

**User's choice:** Real-ish muscle-car figures (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Dev tool only | Gated behind ?debug, never shipped to players | ✓ |
| Could inform a future player setting | Keep door open for an accessibility slider later | |

**User's choice:** Dev tool only (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Expose all of them | Every relevant knob live from the start | ✓ |
| Start with a curated core set | Fewer sliders initially, add as needed | |

**User's choice:** Expose all of them (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Persist via localStorage | Survives reload/HMR, reset-to-defaults button available | ✓ |
| Always reset to code defaults | Every reload starts from code values | |

**User's choice:** Persist via localStorage (Recommended)

**Notes:** None beyond the above.

---

## Claude's Discretion

- Exact vehicle controller wheel geometry and chassis mass/CoM starting values (informed by RESEARCH.md and CLAUDE.md's tuning table)
- Exact implementation mechanism for each assist layer (slide-catch, jump auto-level, anti-roll)
- Directory/module layout for vehicle controller code under `src/`
- Exact retro-gauge visual details (font, needle shape, tick marks, redline start point)
- Whether the scripted telemetry track is a standalone scene, debug overlay, or test-runner script

## Deferred Ideas

- NPC/pursuer AI driving logic and kinematic-vs-full-physics LOD switching — belongs to Phase 7 (AI racers) and Phase 8 (Getaway/heat pursuers)
- Player-facing handling/assist settings (e.g. accessibility slider) — explicitly out of scope for v1 per REQUIREMENTS.md

# Phase 5: Objectives, Navigation & Race Modes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-20
**Phase:** 5-objectives-navigation-race-modes
**Areas discussed:** Checkpoint authoring & courses, Checkpoint feel & detection, Minimap presentation, Circuit & fast-retry feel

---

## Checkpoint Authoring & Courses

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-authored sibling file | New `juliette-ga.routes.json`-style file, same philosophy as 04.1's hand-authored crests | ✓ |
| Auto-generated from junction nodes | Programmatically pick checkpoints from the 36 junction nodes | |
| You decide | Claude picks a default | |

**User's choice:** Hand-authored sibling file.
**Notes:** Matches the road-graph schema's own note that checkpoint authoring "may move to a sibling file in Phase 5."

| Option | Description | Selected |
|--------|-------------|----------|
| 1 P2P + 1 Circuit | ~5-8 checkpoint P2P course, ~4-6 checkpoint Circuit loop | ✓ |
| Several of each | 2-3 P2P routes and 2-3 Circuit loops | |
| You decide | Claude proposes count/spacing | |

**User's choice:** 1 P2P + 1 Circuit.

| Option | Description | Selected |
|--------|-------------|----------|
| Mixed surfaces | At least one gravel/dirt stretch per course | ✓ |
| Mostly tarmac | Keep courses on the paved network | |
| You decide | Claude picks based on the real layout | |

**User's choice:** Mixed surfaces.
**Notes:** Exercises the surface-grip mechanic from Phase 3, which the race modes would otherwise not showcase.

| Option | Description | Selected |
|--------|-------------|----------|
| Avoid known defects for now | Route clear of the 4 open `[Phase 04.1, open]` defect coordinates | ✓ |
| Route through them anyway | Use gameplay pressure to prioritize fixes | |
| You decide | Claude picks placement, notes proximity either way | |

**User's choice:** Avoid them for now.

---

## Checkpoint Feel & Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Vertical light pillar | Tall glowing column, visible over buildings | ✓ |
| Floating ring/gate | A ring/arch the car drives through | |
| You decide | Claude picks based on camera angle | |

**User's choice:** Vertical light pillar.

| Option | Description | Selected |
|--------|-------------|----------|
| Generous | Tall, wide sensor volume spanning the road and above jump height | ✓ |
| Precise | Thin plane/line, exact-position crossing check | |
| You decide | Claude picks detection approach | |

**User's choice:** Generous.

| Option | Description | Selected |
|--------|-------------|----------|
| Chime + beacon color change | Audio cue + color swap + immediate retarget | ✓ |
| Bigger moment | Adds screen flash + HUD counter tick | |
| You decide | Claude picks feedback intensity | |

**User's choice:** Chime + beacon color change.

| Option | Description | Selected |
|--------|-------------|----------|
| Disappear | Visited beacons vanish once hit | ✓ |
| Stay, dimmed | Visited beacons remain as a faded marker | |
| You decide | Claude picks based on visual clarity | |

**User's choice:** Disappear.

---

## Minimap Presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Heading-up, rotating | Map rotates under a fixed car icon | |
| North-up, fixed | Map stays fixed, car icon rotates | ✓ |
| You decide | Claude picks based on implementation simplicity | |

**User's choice:** North-up, fixed.
**Notes:** Reads like a real broadcast/police map overlay, fitting the helicopter-cam framing — the opposite of the recommended default.

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed, whole-course view | Constant scale, shows every checkpoint at once | |
| Zoomed, follows player | Smaller radius, pans with the car | (custom) |
| You decide | Claude picks based on real map size | |

**User's choice (free text):** "zoomed, but with edge indicators" — a custom combination of the zoomed/follow-player option plus off-screen edge blips pointing toward checkpoints outside the visible radius.
**Notes:** Not one of the originally offered options; captured verbatim as D-10.

| Option | Description | Selected |
|--------|-------------|----------|
| Dark map, bright roads | Near-black background, high-contrast roads, colored checkpoint dots | ✓ |
| Translucent overlay | Semi-transparent panel over the 3D scene | |
| You decide | Claude picks a consistent style | |

**User's choice:** Dark map, bright roads.

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom-left | Keeps top-right/top-left free for future HUD elements | ✓ |
| Top-right | Traditional racing-game placement | |
| You decide | Claude picks to avoid future collisions | |

**User's choice:** Bottom-left.

---

## Circuit & Fast-Retry Feel

| Option | Description | Selected |
|--------|-------------|----------|
| 3 laps | Long enough to feel like a race, short enough not to overstay | ✓ |
| 1 lap | Simplest, but doesn't exercise lap-count signalling | |
| You decide | Claude picks a lap count | |

**User's choice:** 3 laps.

| Option | Description | Selected |
|--------|-------------|----------|
| HUD banner + red tint | Text warning plus subtle red vignette | ✓ |
| Banner only, no tint | Just the text warning | |
| You decide | Claude picks signalling intensity | |

**User's choice:** HUD banner + red tint.
**Notes:** User answered with the raw option index "1" rather than selecting via the option list; confirmed with the user as selecting this (first-listed) option before proceeding.

| Option | Description | Selected |
|--------|-------------|----------|
| Flat penalty, e.g. +5s | Same fixed penalty every respawn | |
| Proportional to distance lost | Penalty scales with distance to the last checkpoint | |
| You decide | Claude picks a value, documents reasoning | ✓ |

**User's choice:** You decide.

| Option | Description | Selected |
|--------|-------------|----------|
| Instant hard-cut | Zero-transition snap to the start line | |
| Quick flash/fade | Brief ~100-150ms screen flash | ✓ |
| You decide | Claude picks based on feel once driveable | |

**User's choice:** Quick flash/fade.

---

## Claude's Discretion

- Respawn-at-last-checkpoint time penalty exact value (flat penalty, amount TBD — pick and document reasoning).
- Exact sibling checkpoint-file name/location and schema shape (follow `crest-geometry.ts`'s precedent as a starting point).
- The road-aware directional arrow's own visual presentation (3D floating arrow vs. HUD-corner compass widget) — not discussed this session at all; NAV-04 locks that it must be road-aware (via `ngraph.path`), but the on-screen form is open.
- Exact checkpoint colors (current-target vs. visited), chime sound design, and edge-indicator blip visual style.
- Exact P2P/Circuit checkpoint node/coordinate picks on the real map.

## Deferred Ideas

None — all four discussed areas stayed within Phase 5's own scope. No pending todos matched this phase (`gsd-sdk query todo.match-phase 5` returned zero matches).

# Feature Research

**Domain:** Arcade driving game — point-to-point/circuit racing + police-pursuit evasion + endless survival chase, browser (WebGL), single-player, high-angle "helicopter" camera
**Researched:** 2026-09-07
**Confidence:** MEDIUM-HIGH (genre convention is well documented across game wikis, design writeups and player-reception sources; no single authoritative spec exists for "what a racing game must have," so findings are triangulated from multiple credible sources)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these and the game reads as a prototype, not a product.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Speed readout (analog + digital)** | Speed and race position are the two elements virtually no racing game omits. Speed is the player's primary control feedback loop | LOW | Needle reads better in peripheral vision than digits; ship both. At helicopter distance the car gives no speed cue on its own, so this is doing more work than usual here |
| **Live run timer** | The entire medal premise is time-based; a timer that only appears at the end is unusable | LOW | Must run in-world, top-center or top-right, monospaced/tabular numerals so digits don't jitter |
| **Minimap with route/checkpoints** | Burnout Paradise shipped an open-world racer with no in-race GPS or map and it is *the* canonical UX failure of the genre — players had to pause and read a paper map mid-race | MEDIUM | Non-negotiable for open-route modes. Simplify aggressively: roads as lines, checkpoints as dots, player as arrow. Rotate-with-player or north-up is a real decision — north-up pairs badly with a rotating chase cam |
| **Directional indicator to next objective** | Open-route racing without it is unplayable for a first-time player on an unfamiliar map | MEDIUM | See "Checkpoint/Waypoint UX" deep dive — needs two layers (world beacon + road-aware guidance) |
| **Checkpoint counter (n / N)** | Players need progress legibility, especially in unordered modes | LOW | |
| **Instant restart (single key, no menu)** | This is the load-bearing feature of any time-attack game. PolyTrack's core loop is explicitly "drive a section, spot where you lost speed, restart instantly, try one change" | LOW-MEDIUM | Target sub-300ms back to the start line. No confirmation dialog, no loading screen, no unskippable countdown. If restart costs 5 seconds, the "one more try" loop dies and medals become dead content |
| **Reset-to-road / respawn at last checkpoint** | Open-route driving means ditches, rollovers, and getting wedged on scenery. Every shipped open-route racer has this | LOW | Separate key from restart. Respawn facing the correct direction, with a small time penalty so it can't be used as a shortcut |
| **Persistent best time per level** | Already a PROJECT.md requirement; also table stakes — a time-attack game that forgets your times has no progression | LOW | localStorage/IndexedDB is fine for v1 |
| **Medal thresholds visible before and during the run** | Players can't chase a target they can't see | LOW | Show all three thresholds on the pre-race screen and the currently-achievable one live during the run |
| **Surface-appropriate audio/visual feedback** | Tarmac/gravel/grass/mud must sound and look distinct or the friction system is invisible to the player | MEDIUM | Tire smoke, dust plumes, skid decals, per-surface tire loop. Already a PROJECT.md requirement — worth noting it is *also* table stakes, not just flavor |
| **Engine audio tied to RPM/throttle/load** | Silence or a single looped sample immediately reads as unfinished. Sound is one of the primary sense-of-speed channels | MEDIUM | Layered loops crossfaded by RPM is the standard cheap approach |
| **Pause + quit-to-menu** | Basic | LOW | Pause must not be usable to scout the map in timed modes — freeze the camera |
| **Gamepad + keyboard input with analog steering** | Desktop browser racing games are expected to support both; digital-only steering kills the "controllable oversteer" pillar | MEDIUM | Keyboard needs a steering ramp/smoothing curve to approximate analog, or the car will feel binary |
| **Pursuer count + heat tier indicator (chase modes)** | NFS Most Wanted's pursuit status bar — showing current status, number of active police cars, time until the next backup wave, and bust risk — is the genre reference and players expect that level of legibility | MEDIUM | See "Heat System" deep dive |
| **Visible damage state (chase modes)** | Damage that affects performance without a readable indicator feels like the game cheating | LOW-MEDIUM | A simple 3-segment integrity bar plus escalating visual damage on the model |
| **Sirens + doppler + directional audio for pursuers** | The primary "where are they" channel, and the main tonal payload of the whole chase-cinema pitch | MEDIUM | |

---

### Differentiators (Competitive Advantage)

Ordered roughly by leverage-per-unit-of-work for this specific project.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **A 4th medal tier above gold ("Ace" / dev time)** | Highest leverage replayability feature in the doc. Trackmania's Author Medal sits above gold and is what keeps its campaigns alive for years — gold is *completable*, the top tier is an endless carrot that never resolves | LOW | Costs a threshold number and an icon. Do not gate anything behind it. Gold should mean "near-perfect execution" (per PROJECT.md); Ace means "you found a better route" |
| **Ghost of your own personal best** | Converts an abstract number into moment-to-moment spatial feedback — "I'm two car lengths down into turn 4." PolyTrack does exactly this with leaderboard ghosts and it is the backbone of its loop | MEDIUM | Record position/rotation at fixed interval (~20-30Hz), interpolate on playback. Storage is small if you quantize. Works especially well with the high camera — the ghost is always on screen |
| **Live split delta vs. target medal / vs. PB** | This is what makes medal chasing *compelling* rather than merely present. A post-race number tells you that you failed; a live +0.4s delta at checkpoint 3 tells you *where* | MEDIUM | Requires per-checkpoint split times stored with the PB. Cheap once the checkpoint system exists |
| **Post-run sector breakdown with worst-sector highlight** | Turns "I lost" into "one more try, I know exactly where." The single strongest driver of retry intent in time-attack games | LOW-MEDIUM | Table of per-checkpoint splits, delta vs PB, worst one flagged red |
| **Signature helicopter camera with contextual reskin** | Already the project's stated visual identity. No mainstream browser driving game owns this framing; it is genuinely distinctive and it doubles as the diegetic frame for radio chatter and news-broadcast overlays | MEDIUM-HIGH | See the conflict note in Dependencies — this camera *removes* most of the standard sense-of-speed toolkit and must be compensated for deliberately |
| **News/police broadcast HUD framing** | Chopper cam + broadcast lower-third + radio chatter subtitle strip delivers the entire "light narrative" requirement through the HUD itself, at near-zero extra cost. Mission briefs become dispatch calls; escalation becomes radio traffic | LOW-MEDIUM | Reuse one text/audio event bus for both race commentary and police dispatch. Contextual skin swap = colors, font, station ident |
| **One new legible mechanic per heat tier** | The difference between escalation that thrills and escalation that just gets noisier. NFS MW tiers each introduce a distinct thing (faster units → SUVs → roadblocks → spike strips → helicopter), not just a stat bump | MEDIUM-HIGH | See deep dive. Budget one new pursuer behavior per tier, not one new pursuer *stat* |
| **Pursuit breakers / environmental takedowns** | The most reliably-loved mechanic from NFS Most Wanted: destructible roadside props that collapse onto pursuers. Gives the player agency in a chase instead of pure fleeing, and it's pure chase-cinema | MEDIUM | Marked on minimap. Each one is a scripted prop with a physics collapse — reusable across maps |
| **Hiding spots / cooldown zones** | Directly delivers the Bullitt "cut the engine in an alley" fantasy. NFS MW's hiding spots accelerate cooldown; without them, evasion is just "drive far away," which is boring | LOW-MEDIUM | Trigger volumes under overpasses, in alleys, in barns. Reads well from a high camera if visually marked |
| **Helicopter counter-play (tunnels/overpasses break chopper LOS)** | Gives the top heat tier a specific, learnable answer instead of feeling arbitrary. NFS MW's chopper is only evadable via large tunnels — that specificity is what makes it a *puzzle* rather than a punishment | LOW | Requires tunnel/covered geometry in maps — a map-authoring constraint, flag it early |
| **Distinct handling profiles per car (heavy V8 vs. light European compact)** | Design-doc goal, and it multiplies map content: same route, different car, different optimal line. Also creates natural medal categories | MEDIUM | Keep the roster tiny (3-5). Each car must be a different *verb*, not a different stat line |
| **Boxed-in / bust-risk meter rather than instant bust** | Makes near-misses the core emotional beat. NFS MW's pursuit bar slides toward arrest while you're stationary near police and back toward escape when they lose contact — the *approach* to failure is the drama | MEDIUM | Fill while cornered/slow/surrounded, drain while free and moving. Never instant-fail on a single contact |
| **Escalation pre-announcement ("dispatch requesting additional units")** | Warning-then-consequence. Escalation the player hears coming feels fair; escalation that just appears feels like the game cheating | LOW | Radio chatter line ~3-5s before each tier's units actually spawn |
| **Medal grid on level select** | Completionist pull, at-a-glance progress, and it's how players decide what to replay | LOW | Grid of levels × medal icons. Trackmania and every Mario Kart time-trial screen do this |
| **Replay/highlight of the run (chopper cam)** | The camera is already a broadcast camera; a post-run replay is nearly free once the ghost recorder exists, and it's highly shareable | MEDIUM | v1.x. Reuses the ghost recording format |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Car customization / tuning trees (visual + performance)** | Genre convention; NFS/Forza players expect it; feels like "depth" | Every feature costs UI, art, audio, balancing and testing far beyond the mechanic itself, and >70% of surveyed indie devs cite oversized scope as the reason projects miss deadlines or die. Worse: **performance tuning destroys medal-time comparability** — a time becomes a statement about a build, not about driving | Small hand-tuned roster with fixed stats. Medal times defined per (level × car) or per fixed car. Cosmetic-only paint/livery swap if you want the customization *feeling* for near-zero cost |
| **Rubber-band / catch-up AI** | Makes races "close" and appears to solve difficulty tuning | Deeply and consistently hated. The failure mode players articulate is that winning feels like the AI let you and losing feels like punishment for playing well. GTA Online's leader-slowdown catch-up is widely described as "a punishment" | Fixed AI difficulty per level, tuned by lap-time target. **The medal time is the real opponent** — AI racers exist for pressure, spectacle and traffic-line chaos, not as the scoring metric. This also means AI can be much dumber than in a game where they're the win condition |
| **Rewind / time-scrub** | Reduces frustration on long runs; Forza/Dirt normalized it | Structurally incompatible with time-attack integrity — communities report rewind being used to grind out otherwise-impossible near-perfect laps, which invalidates the leaderboard. It also *competes with* instant restart, and instant restart is the better answer for short levels | Instant restart + generous checkpoint respawn. Keep levels short enough (60-180s) that restarting is cheap. If a level is long enough to want rewind, the level is too long |
| **Global online leaderboards (v1)** | Obvious for a time-attack game; PolyTrack proves the appeal | Requires a backend, accounts, and non-trivial anti-cheat (a browser game with client-authoritative timing is trivially spoofable). Enormous surface area for a solo project | Local PB table + your own ghost in v1. Add global leaderboards only after the loop is proven, and design the run-recording format now so a server-verifiable replay is possible later |
| **Free roam between events** | "It's an open map, why can't I just drive?" | It's effectively an additional mode requiring its own content density, discoverables, event-entry UX, ambient traffic and polish — and it dilutes the tight level-select → run → restart loop that makes medal chasing work | Level-select + area unlock (already the PROJECT.md decision). If you want free driving, ship it as an unlocked "Cruise" toggle per map late, with no objectives |
| **Component-level damage sim (engine/transmission/steering)** | Feels more "real"; sim racers model it | For an arcade-realistic hybrid viewed from 60m up, per-component damage is invisible to the player and unreadable as feedback. It also makes chase failure feel arbitrary | Single integrity value, 3 readable thresholds (pristine / damaged: reduced top speed + audible rattle / critical: smoke + degraded handling), then the destruction end-state PROJECT.md already calls for |
| **Full traffic simulation with civilian AI** | Chase cinema is full of traffic; it's a huge part of the fantasy | Real traffic AI (intersections, right-of-way, reactive avoidance) is one of the most expensive systems in the genre and it will fight your pursuer AI for the same road graph | Light "moving obstacle" traffic: vehicles on rails along road splines with simple braking and a panic-swerve on proximity. At helicopter distance the deception holds completely |
| **Multiple selectable cameras** | Standard racing-game option; some players will ask for a bumper cam | Doubles the tuning burden: car feel, HUD layout, checkpoint marker readability, level scale and sense-of-speed all have to work in both. It also dissolves the one thing that makes this game visually identifiable | Commit to the single reskinned high-angle camera (PROJECT.md decision). Ship *zoom* and a small altitude/tilt band as the player-facing control, not a camera mode switch |
| **Weather and day/night as simulated systems** | Adds variety cheaply-looking | A dynamic system means every lighting condition must be legible with the same HUD and checkpoint markers, and it multiplies your art validation matrix | Per-level fixed lighting presets (golden-hour chase, night pursuit, dusty noon). Same visual variety, no system |
| **Procedural maps** | Infinite content | Already ruled out in PROJECT.md — and correctly: medal times require stable, hand-tuned routes. Procedural generation and time-attack medals are fundamentally incompatible | Real-world-derived maps via the existing extraction tool |
| **Difficulty settings** | Accessibility | In a medal-graded game, difficulty settings either invalidate the medals or require per-difficulty medal tables (3× the tuning work) | Difficulty *is* the medal tier. Bronze is the accessible difficulty. Add driving assists (steering assist, auto-brake) as separate toggles that don't touch medal validity, or that flag a time as assisted |
| **Nitrous / boost meter** | Universal arcade racer convention | Not in the 60s-70s chase-cinema vocabulary at all — a nitrous bar is a Fast & Furious signifier, not a Bullitt one. It also flattens the "momentum matters, brake late" handling pillar by giving a get-out-of-jail button | Handbrake + weight transfer as the skill expression. If you want a spike-of-power mechanic, a short "redline" overrev with an engine-heat cost is more period-appropriate |
| **Story cutscenes / dialogue trees** | Already out of scope | Confirming: correct call | Radio chatter + mission brief cards over the chopper feed |

---

## Deep Dives (Requested by Downstream Consumer)

### 1. What makes a heat/wanted-level pursuit system feel good

**The core structural insight: a pursuit is two states, not one.**

| State | What's happening | What the player is doing | What the HUD shows |
|-------|------------------|--------------------------|--------------------|
| **ACTIVE** | Pursuers have contact. Heat rises with time and infractions | Outrunning, ramming, using pursuit breakers | Pursuer count, tier, backup ETA, bust-risk meter |
| **COOLDOWN / SEARCH** | Contact lost, but units are still searching a radius. Heat has *not* dropped yet | Hiding, going quiet, avoiding patrols | A search timer/meter draining; last-known-position marker on minimap |
| **CLEAR** | Cooldown completed, heat decays a tier | — | Meter resets; radio "we've lost him" |

The cooldown state is where the Bullitt/French Connection fantasy actually lives, and it's the part most amateur implementations skip. Do not drop heat the instant line-of-sight breaks — heat should only begin decaying once the player is genuinely outside the search radius *and* out of line of sight, and higher tiers should mean longer cooldowns with wider search. That gap between "they can't see me" and "I'm clear" is the tension.

**Design rules, in priority order:**

1. **Escalate on a legible clock, not on hidden state.** Show the backup timer. NFS Most Wanted's pursuit bar showing active unit count and time-to-next-backup-wave is the reference implementation and it's the reason its chases feel like a system rather than a mood.
2. **Announce before you escalate.** Radio chatter 3-5 seconds before new units arrive. Same consequence, radically different fairness perception.
3. **One new *mechanic* per tier, not one new stat.** MW's tiers each introduce something learnable: faster interceptors → SUVs that survive contact → roadblocks → spike strips → helicopter. Suggested Heat Street ladder: `1: single cruiser` → `2: pair + PIT attempts` → `3: roadblocks` → `4: heavy ram unit (SUV)` → `5: helicopter spotlight (defeatable in tunnels/under cover)`.
4. **Every tier must have a learnable escape.** NFS Heat's most-cited failure is a risk/reward gulf that felt "too wide" and too random at high heat — players stopped taking the risk. Escape difficulty should scale *sub-linearly* while reward scales linearly, so higher heat is always net-positive EV for a skilled player.
5. **Make failure cheap.** High-heat risk is only worth taking if being busted costs ~2 seconds and a restart key. Punitive bust penalties (money loss, progress loss) plus a slow restart is what turns a risk/reward system into a "just don't engage" system.
6. **Never instant-fail on contact.** Use a bust-risk meter that fills while boxed in/slow/surrounded and drains while free — the near-miss is the product.
7. **Feed back on three channels simultaneously.** Audio (siren doppler, radio chatter, chopper rotor), visual (heat meter, minimap blips, spotlight cone, last-known-position ping), and camera (auto-cut to a higher, wider chopper framing as heat peaks — the design doc's open question; the auto-trigger reads better than a manual toggle precisely because it *is* escalation feedback).
8. **Guard against degenerate evasion.** NFS Heat's police AI can be confused into abandoning chases by driving in circles through scenery. Require *both* LOS loss and distance for cooldown to start, and have units path to last-known-position rather than giving up on losing contact.
9. **Survival mode is a different curve.** Per the design doc, Survival should escalate continuously rather than in discrete tiers. Endless-mode design consensus: pace by difficulty *bands* that widen over time rather than pure ramp or pure randomness, and guarantee a breather beat after each spike so a restart always feels winnable. Score by a composite (time survived × heat tier × pursuers wrecked), not by time alone — time-alive alone rewards passive play.

**Suggested tuning starting point:** ~30-45s per tier escalation at full engagement; cooldown 8s (tier 1) scaling to ~25s (tier 5); heat decays one tier per completed cooldown, not straight to zero.

---

### 2. Minimal HUD for an arcade racer (and this camera specifically)

**The universal floor:** speed and position/progress are the two elements virtually no racing game omits. Everything else is contextual.

**Compose the HUD per mode rather than building one HUD with hidden elements.** A getaway HUD showing a lap counter, or a circuit HUD reserving space for a heat meter, both read as sloppy.

| Element | Race modes | Chase modes | Placement |
|---------|-----------|-------------|-----------|
| Speedometer (needle + digits) | Yes | Yes | Bottom-right |
| Run timer | Yes | Getaway: yes / Survival: yes (survived) | Top-center |
| Live delta vs. target medal / PB | Yes | No | Under timer, color-coded green/red, appears at each checkpoint for ~3s |
| Medal threshold pips | Yes | No | On the timer — passing bronze/silver/gold marks visibly "burns" that medal away |
| Checkpoint counter / lap counter | Yes | No | Top-center, under timer |
| Position (P2/6) | Circuit only | No | Top-left |
| Minimap | Yes | Yes | Bottom-left |
| Screen-edge direction arrow | Yes | Getaway (to escape point) | Edge-anchored |
| Heat tier meter + pursuer count + backup ETA | No | Yes | Top-right |
| Damage/integrity | Optional | Yes | Bottom-right, next to speedo |
| Radio chatter / dispatch strip | Yes (race control) | Yes (police dispatch) | Bottom-center, 1-2 lines, auto-fade |

**Camera-specific constraints that override the usual advice:**

- The car occupies a small area near screen center and is the only thing the player is tracking. **Keep the center third of the screen completely clear.** Anchor everything to edges and corners.
- Speed is the element carrying the most load here, because a high-angle camera strips out the usual sense-of-speed cues. Standard practice attributes the sensation mostly to FOV, camera height/proximity, motion blur and camera shake — and a helicopter cam weakens or removes all four. Compensate deliberately: **dynamic camera altitude and tilt bound to speed** (GTA's top-down mode raises the camera with vehicle speed for exactly this reason), ground-plane detail density, motion trails/speed lines at the frame edges, subtle handheld chopper drift that intensifies with speed, and aggressive audio (wind, engine load, rotor wash).
- The altitude-vs-detachment tradeoff is real and documented: raising the camera to give the player time to see what's ahead makes them feel detached from the action. Find the band experimentally and clamp it tightly; consider raising *FOV* rather than altitude at high speed.
- Prefer **static, non-animated HUD elements**. Racing HUDs conventionally keep timers and speed static and numeric so attention stays on the road rather than on fluctuating UI.
- Semi-transparent / context-fading HUD is the standard pattern, but **do not fade navigation elements**. Guidance should stay visible while a route is still unfamiliar and only becomes noise once memorized — that's a player setting, not an automatic behavior.

---

### 3. What makes medal / time-trial systems compelling long-term

Five things, roughly in order of impact:

**a) A tier above the "completable" one.** Trackmania's ladder is Bronze → Silver → Gold → Author, and the Author time is what sustains its campaigns for years — it's set by the track creator's own validated run and is treated as a hunt in its own right. Gold as the ceiling means a skilled player finishes your content and leaves. Add a 4th tier. It costs one number and one icon.

**b) Sub-second restart.** PolyTrack's loop is explicitly built on this: drive, identify a lost tenth, restart instantly, change one thing. Everything else in this section is downstream of restart cost. Budget engineering effort here disproportionately — pre-warm the scene, never reload assets, never show a countdown you can't skip.

**c) Feedback that localizes failure.** Two mechanisms, both cheap once checkpoints exist:
- **Live split delta** vs. PB or vs. target medal, surfaced at each checkpoint.
- **Post-run sector table** with the worst sector highlighted.
Without these, a failed gold attempt produces "I was 1.2s off" — which is not actionable and does not generate a retry. With them it produces "I lost 0.9 of that in sector 3" — which does.

**d) A ghost.** Your own PB rendered as a translucent car is the highest-fidelity version of (c): it turns time into a visible, spatial, per-corner comparison, and it works unusually well with a high camera because the ghost is almost always in frame. PolyTrack extends this to leaderboard ghosts so you can watch exactly where a faster player brakes and cuts.

**e) Consistent, derivable thresholds.** The common amateur mistake is hand-setting medal times per level from a single playthrough, producing inconsistent difficulty — level 4's gold is trivial, level 5's is impossible, and players lose calibration and stop trying. Instead: record a designer reference run per level, then apply fixed percentage bands across the whole game (starting point: `Ace = ref`, `Gold = ref × 1.03`, `Silver = ref × 1.10`, `Bronze = ref × 1.22`). Consistency across levels matters more than perfection on any one level. Re-record reference runs after any handling change — medal times are a *derived artifact of the physics*, and this is a real maintenance dependency.

**Two things to avoid:**
- **Do not gate progression on gold.** Trackmania gates its difficulty ladder on accumulated *bronze/silver* counts, keeping the wall low and the ceiling high. Per PROJECT.md, area unlock should require completion or bronze — gold stays optional mastery.
- **Do not let assists or rewind produce medal-valid times.** Either exclude them from medals or flag assisted times separately.

---

### 4. Common mistakes in checkpoint / waypoint UX for open-route racing

| Mistake | Why it hurts | Fix |
|---------|-------------|-----|
| **No minimap / no route overview** | Burnout Paradise's defining flaw: an open-world racer with no in-race GPS, few street-name markers, and races so easy to get lost in that players had to pause and consult a map. This alone sank the driving experience for a large share of reviewers | Always-on minimap showing all remaining checkpoints, plus a full-map view on the pre-race screen so players can plan a route before the clock starts |
| **Arrow points as-the-crow-flies** | The classic open-route failure — the arrow points through a building or across a river and the player drives into geometry | **Two-layer navigation.** Layer 1: a world-space beacon (light column visible over buildings) says *where*. Layer 2: road-aware guidance says *how*. Forza Horizon runs a GPS guide line and a racing-line overlay as separately toggleable systems for exactly this reason |
| **Unordered checkpoints with no targeting rule** | Player doesn't know which one the game "wants," or the arrow flickers between two equidistant ones | Midnight Club's solution and the genre standard: in ordered races the arrow points to the next checkpoint; in unordered races **it points to the nearest un-hit checkpoint**. Add hysteresis so it doesn't oscillate at the midpoint |
| **Auto-nearest targeting *without* a full map view** | Nearest-first is a greedy algorithm and is frequently not the optimal route. Players who follow the arrow, then discover a better order, feel the game misled them | Show *all* remaining checkpoints on the minimap simultaneously and treat the arrow as a suggestion, not an instruction. In Point-to-Point/Checkpoint Hunt, route discovery is the depth — surface it |
| **Checkpoint volumes too small or too short** | Clipping a gate by a bumper's width at 90mph is pure frustration. Missing one because a pursuer rammed you off-line is worse | Make gates generously wide and floor-to-sky. The genre convention is literally "large translucent rectangles stretching high into the sky." Err far on the side of forgiving |
| **Overlap-based detection at high speed** | With a fixed physics timestep, a fast car can tunnel through a thin trigger between steps and simply not register. This is a genuine bug class in Rapier/physics-driven games and it will destroy trust in your medal times | Use a **swept segment-vs-plane crossing test** on the car's position between frames, not an overlap query. Also validate crossing *direction* so reversing back through a gate doesn't double-count |
| **No "you missed it" state** | Player blows past a checkpoint at speed and has no idea whether to continue or turn back | Immediate, unmissable feedback: arrow flips, distance counter starts increasing in red, "TURN AROUND" prompt. Never silently wait |
| **Markers unreadable from the game's actual camera angle** | Specific risk here — from a steep high angle, vertical light columns foreshorten to near-nothing while ground markers read fine; at a shallower angle it's the reverse | Ship **both**: a ground-plane ring/painted gate *and* a vertical beam, plus a minimap dot and screen-edge arrow. Validate every marker at the shallowest and steepest camera altitudes |
| **No respawn, or respawn facing the wrong way** | Guaranteed in open-route driving. Missing this is one of the most common indie-racer omissions | Dedicated respawn key: reposition on the nearest road spline at the last passed checkpoint, upright, facing the correct direction, at ~30% of prior speed, with a fixed time penalty |
| **Degenerate straight-line shortcuts** | If checkpoints are placed so a straight off-road line beats the road route, the "any route" freedom collapses into one boring answer | Two levers: place checkpoints so off-road lines trade grip for distance (the surface-friction system gives you this for free), or accept it as emergent depth the way Midnight Club did — where the design goal was explicitly *multiple viable paths* with shortcuts and jumps, and crossing paths that create wheel-to-wheel moments |
| **Distance-to-next shown in a straight line** | Reads as "200m" when the road route is 600m; erodes trust in every other readout | Either show road-route distance, or show nothing and rely on the beacon |

---

## Feature Dependencies

```
[Vehicle physics + handling]
    └──requires──> [Rapier integration + input layer]

[Surface friction system]
    └──requires──> [Vehicle physics]
    └──requires──> [Map data: per-surface material tagging]

[Checkpoint system]
    └──requires──> [Swept trigger detection]
    └──requires──> [Road graph / spline data]  (for respawn + road-aware nav)

[Navigation UX: beacon + arrow + minimap]
    └──requires──> [Checkpoint system]
    └──requires──> [Road graph]

[Run timer + splits]
    └──requires──> [Checkpoint system]

[Medal system]
    └──requires──> [Run timer + splits]
    └──requires──> [Persistence layer]
    └──requires──> [STABLE vehicle physics]   <-- hard ordering constraint

[Ghost playback]
    └──requires──> [Run recorder]
    └──requires──> [Persistence layer]

[Live split delta]
    └──requires──> [Run timer + splits] + [Persistence layer]

[Area unlock progression]
    └──requires──> [Medal system] + [Persistence layer]

[Pursuer AI]
    └──requires──> [Vehicle physics] + [Road graph / pathfinding]

[Heat system]
    └──requires──> [Pursuer AI] + [LOS/detection] + [spawn director]

[Roadblocks / spike strips]
    └──requires──> [Road graph]  (need valid placement nodes ahead of the player)

[Helicopter pursuer (heat tier 5)]
    └──requires──> [Heat system] + [covered/tunnel geometry in maps]

[Survival mode]
    └──requires──> [Heat system] + [Damage + destruction end-state]

[Getaway mode]
    └──requires──> [Heat system] + [Checkpoint system (escape point)]

[Radio chatter / mission briefs]
    └──requires──> [Game event bus]   (one bus serves race + pursuit events)

[Helicopter camera]  ──conflicts──>  [Conventional sense-of-speed toolkit]
[Performance tuning] ──conflicts──>  [Medal-time comparability]
[Rewind]             ──conflicts──>  [Medal-time integrity]
[Rubber-band AI]     ──conflicts──>  [Medal times as the real opponent]
```

### Dependency Notes

- **Medal system requires stable vehicle physics.** This is the single most important ordering constraint in the whole project. Medal times are a derived artifact of the handling model — any change to grip, mass, power or surface friction invalidates every recorded reference time. **Do not author medal times until handling is locked.** Plan for one explicit "medal calibration" pass after the physics phase closes.
- **Navigation, roadblocks and respawn all require a road graph.** The Google Maps extraction tool must output not just geometry but a traversable road network (nodes, edges, direction, surface type). If it doesn't yet, that is a blocking prerequisite for three separate systems. Flag it early.
- **Ghost, live splits, and post-run sector analysis share one recorder.** Build the run recorder once (checkpoint splits + sampled transforms), and all three fall out of it. Building splits without the recorder means building it twice.
- **Getaway and Survival share ~90% of a system.** Both need pursuer AI, heat/escalation, damage and destruction. Getaway adds an escape-point win condition; Survival removes it and adds a score curve. Sequence them adjacently, Getaway first (a win condition is easier to tune than an endless curve).
- **Helicopter camera conflicts with sense of speed.** The standard toolkit (low FOV-warping camera, motion blur, camera shake, close ground proximity) is largely unavailable at high angle. This is not a blocker but it *is* a feature requirement: dynamic altitude/FOV bound to speed, edge speed-lines, high ground-plane detail density, and heavy audio compensation must be treated as required work, not polish.
- **Checkpoint markers depend on final camera altitude band.** Don't author markers until camera altitude is settled, or you'll re-author them.
- **Radio chatter is the cheapest possible narrative layer, but only if the event bus exists first.** Design escalation, checkpoint and race events to emit through one bus from the start.

---

## MVP Definition

### Launch With (v1)

Ruthless read: **one area, three modes, one car class, medals that work.**

- [ ] **Vehicle physics — weighty, momentum-driven, controllable oversteer** — the entire product is downstream of this
- [ ] **Surface friction (tarmac / gravel / grass / dirt) with distinct visual + audio** — the depth mechanic that makes off-road route choice meaningful
- [ ] **Helicopter camera with speed-bound altitude/FOV** — signature identity; must ship correct, not late
- [ ] **Checkpoint system with swept detection, generous volumes, respawn** — foundation for every mode
- [ ] **Two-layer navigation (beacon + road-aware arrow) + minimap** — without this, open-route modes are unplayable for new players
- [ ] **Point-to-Point mode (unordered checkpoints, any route)** — cheapest mode to build, showcases route freedom
- [ ] **Circuit mode with AI racers (fixed difficulty, no rubber-banding)** — reuses everything from P2P plus lap logic
- [ ] **Getaway mode with heat tiers 1-3 (cruiser → pair + PIT → roadblocks)** — proves the chase pillar without needing SUVs or a helicopter unit
- [ ] **Heat system: active/cooldown/clear states, visible meter, unit count, backup ETA, bust-risk meter** — the pursuit is not shippable without the legibility layer
- [ ] **Damage integrity (3 thresholds) + destruction end-state**
- [ ] **Medal system: bronze / silver / gold / Ace, thresholds derived from reference runs by fixed percentage bands**
- [ ] **Instant restart (<300ms) + persistent best times + medal grid on level select**
- [ ] **Live split delta + post-run sector table with worst-sector highlight** — this is what makes medals stick
- [ ] **Mode-specific HUD (speed, timer, splits, minimap, arrow, heat, damage, chatter strip)**
- [ ] **Radio chatter / mission brief over event bus** — narrative requirement, near-zero cost once the bus exists
- [ ] **Keyboard + gamepad with smoothed/analog steering**
- [ ] **One playable area with 6-10 hand-tuned level instances across the three modes**

### Add After Validation (v1.x)

- [ ] **Survival mode** — trigger: Getaway's heat curve is tuned and fun. Survival is a re-pacing of an already-proven system; building it first means tuning an endless curve on top of an unproven one
- [ ] **PB ghost playback** — trigger: players are replaying levels for medals. Highest-value single addition once the loop is confirmed
- [ ] **Heat tiers 4-5 (heavy ram unit, helicopter spotlight + tunnel counter-play)** — trigger: tiers 1-3 read as fair and escalation pacing is dialed in. Requires covered geometry in maps
- [ ] **Pursuit breakers + hiding spots** — trigger: chases feel like fleeing rather than playing. These convert evasion from passive to active
- [ ] **Second and third car with genuinely different handling verbs** — trigger: one car's medal times are being beaten consistently. Multiplies existing map content
- [ ] **Areas 2-3 + area unlock progression**
- [ ] **Post-run chopper-cam replay** — trigger: ghost recorder exists; nearly free, highly shareable

### Future Consideration (v2+)

- [ ] **Global leaderboards with server-verified replays** — defer: needs backend, accounts, and anti-cheat. Design the run-recording format v1 so this stays possible
- [ ] **Community/custom level tooling** — defer: the highest-ceiling replayability feature in the genre (it's what makes Trackmania eternal), but it needs a stable physics build and an editor
- [ ] **Cosmetic livery/paint** — defer: pure polish, but the cheapest "customization" that doesn't break medal comparability
- [ ] **Multiplayer** — already out of scope in PROJECT.md; correctly so
- [ ] **Mobile/touch** — already out of scope

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Vehicle physics (arcade-realistic) | HIGH | HIGH | P1 |
| Instant restart (<300ms) | HIGH | LOW | P1 |
| Checkpoint system (swept detection, generous volumes) | HIGH | MEDIUM | P1 |
| Two-layer navigation + minimap | HIGH | MEDIUM | P1 |
| Medal system incl. 4th "Ace" tier | HIGH | LOW-MEDIUM | P1 |
| Live split delta + post-run sector table | HIGH | MEDIUM | P1 |
| Heat system (states + tiers 1-3 + legibility HUD) | HIGH | HIGH | P1 |
| Surface friction w/ audio-visual distinction | HIGH | MEDIUM | P1 |
| Helicopter camera + speed compensation | HIGH | MEDIUM-HIGH | P1 |
| Respawn / reset-to-road | HIGH | LOW | P1 |
| Persistent best times + medal grid | HIGH | LOW | P1 |
| Damage integrity + destruction end-state | MEDIUM | MEDIUM | P1 |
| Radio chatter / mission briefs | MEDIUM | LOW | P1 |
| AI racers (fixed difficulty) | MEDIUM | MEDIUM-HIGH | P1 |
| PB ghost playback | HIGH | MEDIUM | P2 |
| Survival mode | MEDIUM | MEDIUM | P2 |
| Heat tiers 4-5 (SUV, helicopter + tunnel counter) | MEDIUM | MEDIUM-HIGH | P2 |
| Pursuit breakers + hiding spots | MEDIUM | MEDIUM | P2 |
| Additional cars with distinct handling | MEDIUM | MEDIUM | P2 |
| Light rails-based traffic | MEDIUM | MEDIUM | P2 |
| Area unlock progression | MEDIUM | LOW | P2 |
| Post-run replay | MEDIUM | LOW (after ghost) | P3 |
| Cosmetic liveries | LOW | LOW-MEDIUM | P3 |
| Global leaderboards | HIGH | HIGH | P3 |
| Custom level editor | HIGH | HIGH | P3 |

**Priority key:** P1 = must have for launch · P2 = should have, add when possible · P3 = future consideration

---

## Competitor Feature Analysis

| Feature | NFS Most Wanted (2005) | Trackmania / PolyTrack | Midnight Club | Forza Horizon | **Heat Street approach** |
|---------|------------------------|------------------------|---------------|---------------|--------------------------|
| **Pursuit escalation** | 7 conditions; each adds a distinct unit type/tactic (GTOs → Corvettes → Rhino SUVs → helicopter) | — | Light | Light | 5 tiers, one new *mechanic* per tier, pre-announced by radio chatter |
| **Pursuit HUD** | Pursuit status bar: state, active unit count, backup timer, bust risk. Best in class | — | — | Simple | Adopt MW's model wholesale — it's the genre reference |
| **Cooldown/evasion** | Timed cooldown with search; hiding spots accelerate it; higher heat = longer cooldown; helicopter evadable only via large tunnels | — | — | — | Three-state model (Active / Cooldown / Clear); hiding spots + tunnels as tier-5 counter-play |
| **Bust condition** | Meter fills leftward → arrest cutscene → fines/impound | — | — | Wreck/reset | Bust-risk meter, never instant-fail. Bust = instant retry, no economy penalty |
| **Medal tiers** | — | Bronze/Silver/Gold + **Author** (creator's validated time) | Position-based | Star ratings | Bronze/Silver/Gold + **Ace** — the above-gold tier is the long-term hook |
| **Progression gating** | Blacklist ladder | Difficulty ladder gated on *counts of bronze/silver/gold*, not on gold per level | Career ladder | Accolade points | Area unlock on completion/bronze; gold+Ace stay optional |
| **Restart friction** | Moderate | PolyTrack: single key, instant — the core of its loop | Moderate | Fast rewind | Sub-300ms single key. Treat as a P1 engineering target |
| **Ghosts** | — | PolyTrack: pick any leaderboard player, race their translucent ghost | — | Drivatars | Own PB ghost in v1.x; leaderboard ghosts only if global leaderboards ever ship |
| **Open-route nav** | Waypoint + minimap | N/A (fixed tracks) | **Arrow → next checkpoint if ordered, → nearest if unordered**; no barriers, any drivable route counts | GPS guide line + racing line, separately toggleable | Midnight Club's targeting rule + Forza's two-layer guidance (beacon + road-aware line) |
| **Open-route nav failure to avoid** | — | — | — | — | **Burnout Paradise**: no in-race GPS/map, sparse street markers, players pausing mid-race to read a map. Do not repeat |
| **Catch-up AI** | Present, disliked | None — the clock is the opponent | Present | Drivatar-based | **None.** Fixed difficulty; the medal time is the opponent |
| **Damage** | Cosmetic + pursuit-relevant | None | Light | Cosmetic + light performance | Single integrity value, 3 readable thresholds, destruction end-state |
| **Customization** | Deep visual + performance tuning | None (fixed car) | Deep | Deep | **None** in v1 — protects medal comparability and scope |

---

## Sources

**Pursuit / heat systems**
- [Need for Speed: Most Wanted — Pursuit system (Wikibooks)](https://en.wikibooks.org/wiki/Need_for_Speed:_Most_Wanted/Pursuit_system) — HIGH confidence for mechanics detail (pursuit bar contents, cooldown, hiding spots, pursuit breakers, milestones, bounty)
- [Pursuit — Need for Speed Wiki](https://nfs.fandom.com/wiki/Pursuit) — MEDIUM; heat-level escalation, helicopter at heat 4+, cooldown scaling
- [Need for Speed: Most Wanted (2005) — Wikipedia](https://en.wikipedia.org/wiki/Need_for_Speed:_Most_Wanted_(2005_video_game)) — MEDIUM
- ["Risk/reward with cop attention in Need for Speed Heat" — Gamereactor](https://www.gamereactor.eu/risk-reward-with-cop-attention-in-need-for-speed-heat/) — MEDIUM; heat-as-multiplier design
- [Need for Speed Heat review — TheSixthAxis](https://www.thesixthaxis.com/2019/11/13/need-for-speed-heat-review-ps4-pro-xbox-one-pc/) and [GameGrin](https://www.gamegrin.com/reviews/need-for-speed-heat-review/) — MEDIUM; the "risk/reward gulf too wide" and fairness criticism
- [Wanted-level / heat customization reference (GTAVillage)](https://gtavillage.com/gta-5/tutorials/9351-wanted-level-customization-police-response-2026) — LOW-MEDIUM; tuning parameters (search radius, decay time, escalation thresholds, sight range) and the "cooldown starts only outside LOS *and* search radius" rule

**Medals / time-trial replayability**
- [Medals — Trackmania Wiki](https://www.trackmania.wiki/wiki/Medals) — HIGH; four-tier structure, Author Time derived from creator's validated run
- [What is a Seasonal Campaign? — Trackmania documentation](https://doc.trackmania.com/play/what-is-a-seasonal-campaign/) — HIGH; difficulty ladder gated on *counts* of bronze/silver/gold
- [Trackmania Summer 2026 author times](https://simracing-pc.de/en/2026/07/01/trackmania-summer-2026-author-times-author-medals/) — MEDIUM; author-time hunting as ongoing endgame
- PolyTrack (browser racer) feature analysis — [Poki listing](https://poki.com/en/g/polytrack), [polytrackplay.org](https://polytrackplay.org/en) — LOW-MEDIUM (marketing/aggregator sources; corroborated across several independently) — instant restart, leaderboard ghosts, clean-lap badges
- [Time Trial — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/TimeTrial) — LOW-MEDIUM; ghost conventions

**Navigation / checkpoint UX**
- [Midnight Club II designer diary — GameSpot](https://www.gamespot.com/articles/midnight-club-ii-designer-diary/1100-2911845/) — MEDIUM-HIGH; explicit design intent for multiple viable paths and crossing routes
- [Races — Midnight Club Wiki](https://midnightclub.fandom.com/wiki/Races) — MEDIUM; the ordered-vs-unordered arrow targeting rule
- [Burnout Paradise review — N4G](https://n4g.com/news/101688/burnout-paradise-review-silly-flaws-will-drive-you-crazy) and [Art as Games analysis](https://artasgames.wordpress.com/2013/09/14/burnout-paradise/) — MEDIUM; the no-GPS navigation failure
- [FH3 Navigation — Forza Support](https://support.forzamotorsport.net/hc/en-us/articles/360005300874-FH3-Navigation) — HIGH (official); separately-toggleable GPS guide line and race line
- [Forza Horizon 6 HUD & accessibility guide — Apex Tune Hub](https://apextunehub.com/games/forza-horizon-6/guides/hud-accessibility-settings) — LOW-MEDIUM; keep guidance visible until routes are memorized

**HUD / game feel**
- [Racing Game Design — GameDesignSkills](https://gamedesignskills.com/game-design/racing/) — MEDIUM (fetch blocked, findings via search excerpt); speed + position as the near-universal HUD floor
- [Best UI design patterns for racing games — LinkedIn Advice](https://www.linkedin.com/advice/0/what-best-ui-design-patterns-racing-games-skills-gaming-industry-au8uf) — LOW-MEDIUM; minimal/unobtrusive, context-fading HUD
- [Racing games with the best sense of speed — Game Rant](https://gamerant.com/racing-games-best-sense-feel-speed/) — MEDIUM; FOV, camera placement, motion blur, camera shake as the primary levers
- [Top-Down Perspective — GTA Wiki](https://gta.fandom.com/wiki/Top-Down_Perspective) — MEDIUM; limited forward line-of-sight, camera raised with speed, and the altitude-vs-detachment tradeoff. Most directly relevant existing analysis of this project's camera choice
- [A Complete Guide to Game Camera Setups — Pixune](https://pixune.com/blog/game-camera-setups/) — LOW-MEDIUM

**Anti-features**
- [Rubber-Band AI — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/RubberBandAI) and [ResetEra discussion](https://www.resetera.com/threads/is-there-even-a-single-racing-game-out-there-where-rubberband-ai-actually-improves-the-experience.886038/) — MEDIUM; consistent, strong negative player reception
- [Circuit-Adaptive Challenge Balancing in Racing Games (GEM 2014, PDF)](https://sander.landofsand.com/publications/paper_gem2014_alex_rietveld.pdf) — HIGH (peer-reviewed); documents catch-up criticism and proposes alternatives
- [Rewind mode in racing games — NeoGAF](https://www.neogaf.com/threads/rewind-mode-in-racing-games.905921/) — LOW-MEDIUM; rewind vs. leaderboard integrity
- [Damage! Pros, Cons & Paradoxes — OverTake](https://www.overtake.gg/news/damage-pros-cons-paradoxes.668/) and [10 Racing Games With The Best Damage Models — CarThrottle](https://www.carthrottle.com/news/10-racing-games-best-damage-models) — MEDIUM; cosmetic vs. performance damage tradeoffs
- [Scope Creep in Indie Games — Wayline](https://www.wayline.io/blog/scope-creep-indie-games-avoiding-development-hell) and [Scope Creep: The Silent Killer of Solo Indie Game Development](https://www.wayline.io/blog/scope-creep-solo-indie-game-development) — MEDIUM; >70% of surveyed indie devs cite oversized scope; features cost far more than their mechanic
- [How To Set Up Pacing, Difficulty, And Progression Within An Infinite Metagame — GameDev.net](https://gamedev.net/blogs/entry/2294544-how-to-set-up-pacing-difficulty-and-progression-within-an-infinite-metagame/) — MEDIUM; difficulty banding, guaranteed-easy beat after failure, endless-mode pacing

**Project inputs**
- `D:\Projects 2\Heat Street\.planning\PROJECT.md`
- `D:\Projects 2\Heat Street\heat-street-design-doc.md`

### Confidence Caveats

- No authoritative primary-source design documentation exists for most commercial racing games; genre convention here is triangulated from game wikis, reviews, and community discussion. Treat *mechanics descriptions* (what a game did) as MEDIUM-HIGH and *design rationale* (why it worked) as MEDIUM.
- Specific numeric tuning suggestions (30-45s per heat tier, medal percentage bands, sub-300ms restart) are **derived starting points, not sourced values**. They must be validated by playtesting.
- The helicopter-camera / sense-of-speed conflict is inferred by combining two well-sourced findings (the standard speed toolkit is FOV + camera proximity + blur + shake; top-down cameras have documented forward-visibility and detachment problems). No source directly analyzes a high-angle *arcade racing* camera, because very few games have shipped one — which is simultaneously the risk and the differentiator.

---
*Feature research for: arcade driving / police-pursuit / time-attack hybrid, browser*
*Researched: 2026-09-07*

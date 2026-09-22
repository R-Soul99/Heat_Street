# Phase 5 Validation

## Automated Checks

Run focused checks after each implementation wave:

- `npm test -- --run tests/course-data.test.ts tests/navigation.test.ts tests/route-validation.test.ts`
- `npm test -- --run tests/checkpoint-detection.test.ts tests/race-state.test.ts`
- `npm test -- --run tests/respawn.test.ts tests/restart.test.ts tests/loop.test.ts`
- `npm test -- --run tests/minimap.test.ts tests/race-coordinator.test.ts`

Run the phase gates after integration:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

The known Phase 2 vehicle telemetry failures remain unrelated and must be recorded rather than changed.

## Requirement Sampling

Focused tests cover NAV-03 through NAV-07, P2P-01, and CIRC-01. The blocking browser checkpoint in `05-04-PLAN.md` verifies the real Juliette routes, beacon visibility, road-aware guidance, mixed-surface traversal, three-lap completion, wrong-way feedback, upright respawn, and sub-second in-place restart.

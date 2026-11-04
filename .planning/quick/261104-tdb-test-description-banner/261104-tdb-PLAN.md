# Quick 261104-tdb: test description banner

**Goal:** While a sign-off test station is running in the `?feel` / `?debug` playground (e.g.
`?map=juliette-ga&feel`), show the test's name and description along the top of the screen.

## Tasks

1. In `src/debug/test-stations.ts` (`createTestStations`), add a fixed top-of-screen banner
   (`pointer-events:none`, hidden until first launch) showing `TEST [key] name @ speed mph` and
   the station's `note` text. Repaint on launch, repeat (G) and speed change.
2. Move the existing one-line speed/stations panel down (top 34px -> 64px) so the banner does
   not cover it.

## Verify

- `npx tsc --noEmit` clean; `npx biome check src/debug/test-stations.ts` clean.
- `npx vitest run tests/sign-off-stations.test.ts` green.
- Browser: launch a station with a number key; banner appears with that station's note.

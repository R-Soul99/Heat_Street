# Quick 261104-tdb summary: test description banner

**Commit:** 67685f7 (`src/debug/test-stations.ts`)

## What changed

- `createTestStations` now builds a top-of-screen banner: bold yellow title
  `TEST [key] name @ speed mph`, then the station's `note` below. It stays hidden until the first
  launch, then updates on launch, G (repeat) and `[` / `]` (speed).
- The existing one-line panel moved from top 34px to 64px to sit below the banner.
- No new data: it reuses the `note` already in each `<area>.stations.json`.

## Verification

- `npx tsc --noEmit`: clean. `npx vitest run tests/sign-off-stations.test.ts`: 8/8.
- `npx biome check`: one formatter complaint appeared after the edit and was fixed with
  `biome check --write`.
- Visual check: the user ran station 1 on `?map=juliette-ga&feel` with the banner in place. They
  reported the test result but did not comment on the banner's look or layout.

## Notes

- The banner has no hide control and no end-of-test detection; it stays up until reload.
- Built inline rather than via the planner/executor subagents, given the size of the change.

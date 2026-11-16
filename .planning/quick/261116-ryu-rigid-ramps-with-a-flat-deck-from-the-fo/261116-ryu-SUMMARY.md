# Quick 261116-ryu Summary

Rigid ramp decks (top = ground at foot start + profile) and straight road drawing (Shift or "Straight" toggle). Task 3 (human check) awaiting.

## Commits
- 825557d fix(quick-261116-ryu): rigid ramp deck from one base height
- 2d5f3c8 feat(quick-261116-ryu): straight road drawing (Shift or Straight toggle) (includes git rm of roads-do-not-snap todo)

## Changes
- `rampBaseY` exported from src/core/crest-geometry.ts; buildRampGeometry top vertices use it, ground vertices still sample real ground. Round crests untouched.
- Editor ramp ray pick (features.ts) and selection box (editor.ts) use base + heightM.
- tool-dispatch: `roadStraight` option, Stroke.straight, Shift or option gives 2-point preview and stroke; < 0.5 m applies nothing. Editor "Straight" toggle in road options.
- Other consumers: none compute ramp top from terrain themselves (terrain-format only uses rampLengthM).

## Deviations
None.

## Verification
vitest full: 2735 passed, 1 failed (pre-existing tests/demo-hills.test.ts max-slope). tsc clean. biome clean on touched files.

## Pending
Task 3 human check.

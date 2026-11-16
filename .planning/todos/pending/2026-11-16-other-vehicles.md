---
created: 2026-11-16T09:00:00.000Z
title: Add other vehicles to the game
area: gameplay
files: []
---

## Problem

The user wants other vehicles ("we really need those other vehicles") — said while building a
playground map with the new editor tools. No roadmap phase covers it yet. Related: the 2026-09-20
todo on drivetrain type per car class.

## Solution

Needs a discuss/plan phase first: which vehicles, how they differ (handling, drivetrain, size), whether
they are drivable, AI traffic, or both, and how the player picks one.

Leftover from the closed 2026-09-20 drivetrain todo: RWD/FWD/AWD classes already exist (`?car=`,
`src/core/vehicle-class.ts`, front drive share plus understeer bias). When real car classes are
planned, rename the rear-specific tuning field `drive.engineForcePerRearWheel`
(`src/core/vehicle-tuning.ts`, `src/core/feel.ts`) to a drivetrain-neutral name.

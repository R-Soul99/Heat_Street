---
status: complete
---
# Summary 261029-wb3

Commit 596b985 on exp/pivot-blend. Gate is continuous (no dwell); new drive.pivotAssist (default 0.6) scales the yaw torque and front-axle cap. pivotTurn default is still 0 (off).

Sweep (full steer+throttle, entry 0/3/6/9 m/s, 2 s): pivot off turned 93-129 deg, peak yaw accel 3.9; assist 0.6 turned 185-210 deg, peak 3.9-5.1, no step with entry speed; assist 1 (old strength) turned ~330 deg, peak 5.7-8.9. Pure tyre physics (assist 0) gives only 49 vs 42 deg in the 1 s routine.

Verification: tsc, biome, 1457 vitest tests pass; feel-dossier runs. Not felt by the user yet.

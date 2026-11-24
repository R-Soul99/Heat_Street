# 10-13 human check: progress notes

Not a SUMMARY: the check is still open. Fold this into 10-13-SUMMARY.md when the user approves.

| Step | Result |
|------|--------|
| 1-2 Editor layout, build a stage | User: "how do i set start and end points? it's not clear". Fixed in e511c96: named tags, Place finish button, next-step prompt, errors that name what is missing, unfinished routes no longer block saving. User then built a 6-gate stage on demo-hills. |
| 3 Test stage | User asked how to run the stage; pointed to Test stage and the direct URL. No code change. |
| 4 Drive it | User drove one stage: "i wasted a lot of time turning round to go through a gate the 'right' way". Fixed in the gate-direction commit: automatic gate direction, Auto button, larger arrows, backwards warning, ground chevrons. Not yet re-driven. |
| 5 Gate order and respawn | Not reported yet |
| 6 Personal best | Not reported yet |
| 7 Road routes | Not reported yet (use grid-test; demo-hills has only 2 road nodes) |

Design changes against the plans: dragging no longer sets a gate direction (start only); gates and
finish carry an optional `headingManual` flag. D-03 (forward-only gates) is unchanged.

Uncommitted on purpose: `public/maps/demo-hills.stages.json` (the user's test stage, re-aimed
2026-11-24) and `public/maps/demo-hills.terrain.bin` (changed by editor saves).

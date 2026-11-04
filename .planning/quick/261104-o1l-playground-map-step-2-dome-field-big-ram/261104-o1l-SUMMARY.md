---
status: complete
commit: ec9d016
---

# Quick 261104-o1l: playground map step 2

`?map=playground` added (terrain format, flat tarmac, 1600 x 1300 m). Pipeline:
`generate-playground` -> `compile-map --area playground` -> `convert-terrain --area playground` ->
`author-playground-routes`; outputs committed under `public/maps/playground.*`.

- Dome field: 5 x 4 domes, radius 18-44 m, deterministic jitter, >= 4 m between rims (test enforces).
- Gap jumps S/M/L (4/6/8 m lips): take-off (R250 foot), gap 46/55/64 m, landing ramp (R100 foot). Gaps from headless
  drives: 82 mph at the lip lands 17-23 m past the landing lip; below ~80 mph it comes up short into the lip wall.
  Not yet felt by hand.
- Ovals: large (300 m straights, R120), medium (200, R70), small (120, R40); each fed from a spine road.
- Launch pads 1-7 (dome field, 3 jumps, 3 ovals) via `playground.stations.json`, visible in `?feel` / `?debug`.
- `author-feel-test-routes.ts` takes `--area`; feel-test output verified byte-identical.

Gate: typecheck, vitest (1855) pass. `biome check .` has 4 pre-existing errors (logs/_scratch, gltf.test.ts), none ours.
Open: step 3 terrain-surface grid; hand-drive the jumps.

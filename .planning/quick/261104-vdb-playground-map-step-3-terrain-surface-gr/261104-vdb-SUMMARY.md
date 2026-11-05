---
status: complete
quick_id: 261104-vdb
completed: 2026-11-04
---

# Quick 261104-vdb: playground map step 3 - summary

`?map=playground` now has five surface strips in the south-east: grass, sand, mud, gravel, dirt road, north to
south (pads on keys 8, 9, 0, -, =). Each strip is 600 m long (x 860..1460) and 59 m wide, 15 m apart, with a
pad 40 m in facing east, so there is a 560 m run and room to turn around. A feeder joins each way to the spine.

## Finding: explicit road width is capped at 30 m
`build-graph.ts` accepts an explicit `width` tag only between `MIN_EXPLICIT_WIDTH_M` and
`MAX_EXPLICIT_WIDTH_M` (30 m) and otherwise silently falls back to the lane default (3.5 m for a service road).
A first attempt with 64 m ways compiled to 3.5 m ways. Each strip is therefore two 30 m ways of one surface with
centre lines 29 m apart (1 m overlap, no seam). The feel-test skid pan has the same issue: it is declared 160 m
wide but compiled to a 3.5 m service edge, and only looks right because the ground on flat test areas is
tarmac. It was left unchanged.

## Verification
- `tests/playground-map.test.ts`: strips equal and ordered, inside the layout and clear of the ovals, ten 30 m
  edges in the shipped graph with the right surfaces, 12 stations.
- Full vitest 139 files / 1875 tests, tsc clean, build ok.
- Driven in the browser: sand and mud strips launch with the right paint and banner.
- Not hand-checked by the user: how each surface feels, and the gravel and dirt-road strips by eye.

# Quick 261104-vdb: playground map step 3

Add five equal surface strips (grass, sand, mud, gravel, dirt road) to `?map=playground` for slide and pivot
testing, in the free south-east area. No engine work: surface is per road way.

## Tasks
1. `tools/map-compiler/synthetic/playground-layout.ts`: five strips (x 860..1460, 59 m wide, 15 m gaps), each a
   road way per surface; a feeder from the spine to each way; stations on keys 8, 9, 0, -, = (all already
   supported by `src/debug/test-stations.ts`).
2. Regenerate: generate-playground, compile-map, convert-terrain, author-playground-routes; commit
   `public/maps/playground.*`.
3. Tests in `tests/playground-map.test.ts`; memory note.

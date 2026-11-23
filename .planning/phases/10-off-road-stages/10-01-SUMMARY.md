---
phase: 10-off-road-stages
plan: 01
subsystem: core
tags: [stages, parser, heading, schema]
requires: []
provides:
  - "src/core/stage.ts: Stage types, parseStageData, serializeStageData, classifyStageMedal, stageFromDraft, draftFromStage"
  - "src/core/heading.ts: bearingFromYaw, yawFromBearing"
  - "docs/schemas/stage.v1.md"
affects: [10-02, 10-05, 10-06]
tech-stack:
  added: []
  patterns: ["hand-rolled strict parser (no zod), array allowlist for vehicle class"]
key-files:
  created: [src/core/stage.ts, tests/stage.test.ts, docs/schemas/stage.v1.md]
  modified: [src/core/heading.ts, tests/heading.test.ts]
key-decisions:
  - "headingRad in stage files is YAW; converters added for BEARING consumers"
  - "Stage medals are explicit thresholds classified directly, never ace"
  - "0 stages allowed per file; 1..40 gates per stage"
requirements-completed: [MODE-04]
duration: ~15min
completed: 2026-11-23
---

# Phase 10 Plan 01: Stage file format Summary

Strict hand-rolled stage file parser/serializer with caps, extent checks and medal thresholds, plus YAW/BEARING heading converters and the schema doc.

## Tasks

1. Stage types, parser, serializer, drafts, classifier (TDD): cf7f546
2. YAW/BEARING converters and schema doc: 095ab91, test fix 5536d88

## Deviations from Plan

**1. [Rule 1 - Bug] Heading test branch-cut failure**
- Task 2's first commit (095ab91) contained a test comparing bearings near +-pi; fixed in 5536d88 by comparing cos/sin.

Otherwise the plan was executed as written. Tests run: stage (51), heading, layering all green (210 total); `tsc --noEmit` clean.

## Known Stubs

None.

## Self-Check: PASSED

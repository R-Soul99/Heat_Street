# Stage File Format v1

**Status:** Normative. Implemented by `src/core/stage.ts` (`parseStageData` / `serializeStageData`),
the single validation gate used by the game load, the dev-server PUT and the stage editor.
**Companions:** `tests/stage.test.ts`, `src/core/heading.ts`.

## File

`public/maps/<id>.stages.json`, one file per terrain area. All coordinates are local ENU metres
(X east, Z south) in the same frame as the terrain area.

```json
{
  "schemaVersion": 1,
  "areaId": "demo-hills",
  "stages": [
    {
      "id": "ridge-run",
      "name": "Ridge Run",
      "start": { "x": 0, "z": 0, "headingRad": 1.0 },
      "gates": [{ "id": "g1", "x": 10, "z": 10, "headingRad": 0.5, "widthM": 20 }],
      "finish": { "x": 30, "z": 30, "headingRad": 0.2, "widthM": 25 },
      "medals": { "goldSec": 60, "silverSec": 70, "bronzeSec": 80, "vehicle": "rwd" }
    }
  ]
}
```

## Rules

- `schemaVersion` must be `1`. `areaId` matches `/^[a-z0-9-]{1,64}$/`.
- 0 to 20 stages (an empty file is valid so the editor can delete the last stage).
- Stage `id` and gate `id` match `/^[a-z0-9-]{1,40}$/`. Stage ids are unique per file; gate ids
  are unique within one stage (the same gate id may appear in different stages).
- `name` is trimmed and must be 1 to 60 characters.
- Each stage has 1 to 40 ordered gates, a `start` and a `finish`.
- All numbers must be finite. `x` and `z` of every start, gate and finish must lie inside the
  terrain extent (inclusive) and satisfy `|x|, |z| <= 100000`.
- `widthM` of gates and finish is within 8 to 60 (editor default 20).
- `medals` is optional. When present: `0 < goldSec < silverSec < bronzeSec`, and `vehicle` is one
  of the known vehicle class ids (allowlist). Medal classification compares the run time against
  these thresholds directly (`classifyStageMedal`); it never yields "ace".
- There is no y: height comes from the terrain (no y is ever read or written).
- Unknown keys are ignored on parse and dropped on save. Failures throw an Error whose message
  starts with `parseStageData: <label>: `.

## Heading convention

`headingRad` is YAW, the `VehiclePose` convention: world forward = `(-sin h, -cos h)`. This is the
same convention terrain start points and `resetVehicle` use. Convert with `bearingFromYaw` /
`yawFromBearing` in `src/core/heading.ts` when a module speaks BEARING (`atan2(forwardZ, forwardX)`,
used by race-state, the minimap and `headingFromRotation`).

## Gate counting

Gates are counted strictly in order. A gate counts when the car crosses its line in the forward
direction (along the gate's heading) within `widthM` of the gate centre. Then the finish is
crossed the same way (decision D-03).

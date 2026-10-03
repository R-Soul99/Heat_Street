# Quick 261003-pgl: Fixed isometric-style camera rig (debug toggle)

Branch: quick/261003-pgl-fixed-iso-camera (forked from local HEAD, not origin/main — local main carries unpushed phase-07 work).

## Tasks
1. camera-math.ts: pure `fixedIsoOffset(headingRad, pitchRad, armLengthM)` + `FIXED_ISO` constants (FOV 22, pitch 50, heading north = PI since map is ENU with Z south, arm ~110 m).
2. helicopter-camera.ts: `createFixedIsoCameraRig` (third CameraRig, kind "fixed-iso"): no yaw follow, position follows target position only, damped with existing positionLambda, fixed FOV.
3. main.ts: build the rig; debug key `K` cycles helicopter -> fixed-iso -> helicopter. Default stays helicopter. `C` (helicopter<->chase) unchanged.
4. tests/camera-fixed-iso.test.ts: offset geometry.

Out of scope: occlusion, audio, FX, camera-tuning schema/persistence.

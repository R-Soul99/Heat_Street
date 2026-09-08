import { describe, expect, it } from "vitest";
import {
  type InputFrame,
  type InputSource,
  NEUTRAL,
  RecordingInput,
  ReplayInput,
} from "../src/core/input-tape";
import { SimClock } from "../src/core/sim-clock";

/** A deterministic stand-in for the Phase 2 keyboard/gamepad source. */
class ScriptedInput implements InputSource {
  calls = 0;

  sampleForTick(tick: number): InputFrame {
    this.calls++;
    return {
      steer: Math.sin(tick * 0.1),
      throttle: (tick % 7) / 6,
      brake: tick % 13 === 0 ? 1 : 0,
      handbrake: tick % 17 === 0,
    };
  }
}

/** Records a full tape of `ticks` frames by sampling every index in order. */
function recordTape(ticks: number): readonly InputFrame[] {
  const recorder = new RecordingInput(new ScriptedInput());
  for (let t = 0; t < ticks; t++) {
    recorder.sampleForTick(t);
  }
  return recorder.frames();
}

/**
 * Replays a tape through a real SimClock driven at `fps`, collecting the frames
 * actually consumed by the fixed ticks. Mirrors the loop's tick-index maths
 * (`clock.tick - steps + s`), because `stepsFor` has already advanced `tick`.
 */
function consumeAtFps(tape: readonly InputFrame[], fps: number, seconds: number): InputFrame[] {
  const clock = new SimClock();
  clock.start(0);
  const replay = new ReplayInput(tape);
  const consumed: InputFrame[] = [];
  for (let f = 1; f <= fps * seconds; f++) {
    const nowMs = (f / fps) * 1000;
    const steps = clock.stepsFor(nowMs);
    for (let s = 0; s < steps; s++) {
      consumed.push(replay.sampleForTick(clock.tick - steps + s));
    }
  }
  return consumed;
}

describe("NEUTRAL", () => {
  it("is the all-zero frame", () => {
    expect(NEUTRAL).toEqual({ steer: 0, throttle: 0, brake: 0, handbrake: false });
  });

  it("is frozen, so a shared reference cannot be mutated by a consumer", () => {
    expect(Object.isFrozen(NEUTRAL)).toBe(true);
    expect(() => {
      (NEUTRAL as { steer: number }).steer = 1;
    }).toThrow(TypeError);
  });
});

describe("RecordingInput", () => {
  it("delegates to the live source and stores the frame at index tick", () => {
    const live = new ScriptedInput();
    const recorder = new RecordingInput(live);
    const frame = recorder.sampleForTick(0);
    expect(live.calls).toBe(1);
    expect(recorder.frames()).toHaveLength(1);
    expect(recorder.frames()[0]).toEqual(frame);
  });

  it("is idempotent per tick: a repeated sample returns the same frame reference", () => {
    const live = new ScriptedInput();
    const recorder = new RecordingInput(live);
    for (let t = 0; t <= 7; t++) {
      recorder.sampleForTick(t);
    }
    const callsAfterFirstPass = live.calls;
    const lengthAfterFirstPass = recorder.frames().length;

    const first = recorder.sampleForTick(7);
    const second = recorder.sampleForTick(7);

    expect(second).toBe(first);
    expect(live.calls).toBe(callsAfterFirstPass);
    expect(recorder.frames()).toHaveLength(lengthAfterFirstPass);
  });

  it("fills skipped ticks with NEUTRAL rather than shifting the tape", () => {
    const recorder = new RecordingInput(new ScriptedInput());
    recorder.sampleForTick(0);
    recorder.sampleForTick(1);
    recorder.sampleForTick(2);
    const atFive = recorder.sampleForTick(5);

    const frames = recorder.frames();
    expect(frames).toHaveLength(6);
    expect(frames[3]).toBe(NEUTRAL);
    expect(frames[4]).toBe(NEUTRAL);
    expect(frames[5]).toBe(atFive);
  });

  it("returns a snapshot from frames() that cannot mutate the recorder", () => {
    const recorder = new RecordingInput(new ScriptedInput());
    recorder.sampleForTick(0);
    const snapshot = recorder.frames() as InputFrame[];
    snapshot.push(NEUTRAL);
    snapshot[0] = NEUTRAL;

    expect(recorder.frames()).toHaveLength(1);
    expect(recorder.frames()[0]).not.toBe(NEUTRAL);
  });
});

describe("ReplayInput", () => {
  it("returns the recorded frame for in-range ticks", () => {
    const tape = recordTape(4);
    const replay = new ReplayInput(tape);
    for (let t = 0; t < 4; t++) {
      expect(replay.sampleForTick(t)).toBe(tape[t]);
    }
  });

  it("returns NEUTRAL past the end of the tape and for negative ticks", () => {
    const replay = new ReplayInput(recordTape(4));
    expect(replay.sampleForTick(4)).toBe(NEUTRAL);
    expect(replay.sampleForTick(9999)).toBe(NEUTRAL);
    expect(replay.sampleForTick(-1)).toBe(NEUTRAL);
  });
});

describe("input tape round trip", () => {
  it("replays a recorded 120-frame input tape deep-equal to the original", () => {
    const tape = recordTape(120);
    const replay = new ReplayInput(tape);
    const replayed: InputFrame[] = [];
    for (let t = 0; t < 120; t++) {
      replayed.push(replay.sampleForTick(t));
    }
    expect(replayed).toEqual([...tape]);
  });

  it("consumes an identical input tape sequence at 30 fps and at 144 fps (SC1)", () => {
    const tape = recordTape(120);
    const atThirty = consumeAtFps(tape, 30, 2);
    const atOneFortyFour = consumeAtFps(tape, 144, 2);

    expect(atThirty).toHaveLength(120);
    expect(atOneFortyFour).toHaveLength(120);
    expect(atOneFortyFour).toEqual(atThirty);
    expect(atThirty).toEqual([...tape]);
  });
});

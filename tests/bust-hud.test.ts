import { describe, expect, it } from "vitest";
import { RIGHT_CAR_DELAY_SEC, rightCarHint } from "../src/hud/bust-hud";

describe("rightCarHint", () => {
  it("is blank on its wheels, counts down while flipped, then prompts for P", () => {
    expect(RIGHT_CAR_DELAY_SEC).toBe(10);
    expect(rightCarHint(0)).toBe("");
    expect(rightCarHint(0.2)).toBe("RIGHT CAR IN 10");
    expect(rightCarHint(4.5)).toBe("RIGHT CAR IN 6");
    expect(rightCarHint(9.99)).toBe("RIGHT CAR IN 1");
    expect(rightCarHint(10)).toBe("PRESS P TO RIGHT THE CAR");
    expect(rightCarHint(40)).toBe("PRESS P TO RIGHT THE CAR");
  });
});

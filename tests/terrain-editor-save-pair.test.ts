import { describe, expect, it } from "vitest";
import { putTerrainPair } from "../tools/terrain-editor/save-pair.ts";

describe("putTerrainPair (WR-06)", () => {
  it("writes the bin first, then the sidecar", async () => {
    const order: string[] = [];
    await putTerrainPair(
      async (kind) => {
        order.push(kind);
      },
      new Uint8Array(1),
      "{}",
    );
    expect(order).toEqual(["bin", "json"]);
  });

  it("a bin failure writes nothing else and says nothing changed", async () => {
    const order: string[] = [];
    const run = putTerrainPair(
      async (kind) => {
        order.push(kind);
        throw new Error("disk full");
      },
      new Uint8Array(1),
      "{}",
    );
    await expect(run).rejects.toThrow(/binary was not saved, nothing changed.*disk full/);
    expect(order).toEqual(["bin"]);
  });

  it("a sidecar failure names the half that failed and the mismatch", async () => {
    const run = putTerrainPair(
      async (kind) => {
        if (kind === "json") throw new Error("terrain-save: bad graph");
      },
      new Uint8Array(1),
      "{}",
    );
    await expect(run).rejects.toThrow(/binary WAS saved but the sidecar.*NOT.*bad graph/);
  });
});

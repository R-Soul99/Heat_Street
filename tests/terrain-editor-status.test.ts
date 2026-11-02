import { describe, expect, it } from "vitest";
import editorSource from "../tools/terrain-editor/editor.ts?raw";

/**
 * WR-06: the sculpt page's status line echoes file content (sidecar parse
 * errors quote areaId / groundSurface / object kinds) and server error bodies,
 * so it must be built from text nodes, never HTML.
 */
describe("terrain editor status line (WR-06)", () => {
  it("never writes the status element through innerHTML", () => {
    expect(editorSource).not.toMatch(/\$\("status"\)\.innerHTML/);
    expect(editorSource).toMatch(/\.replaceChildren\(/);
  });

  it("only uses innerHTML with template data from the static SURFACE_TYPES list", () => {
    const lines = editorSource.split("\n").filter((l) => /innerHTML\s*=/.test(l));
    for (const line of lines) {
      expect(line).toMatch(/innerHTML = (""|SURFACE_TYPES\.map\()/);
    }
  });
});

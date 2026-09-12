import { describe, expect, it } from "vitest";
import {
  applySkinClasses,
  CAMERA_SKINS,
  type CameraSkin,
  createCameraSkin,
  type SkinClassList,
} from "../src/render/camera/camera-skin";
// Source-level presentation-only proof, reusing tests/layering.test.ts's
// `?raw` idiom for a single file rather than the whole-tree glob it uses —
// this test cares about exactly one file.
import cameraSkinSource from "../src/render/camera/camera-skin.ts?raw";

/**
 * Runs under `environment: "node"` (vitest.config.ts) and must never
 * construct a real DOM element — every fake below is hand-built, mirroring
 * `tests/debug-gate.test.ts`'s Node-safe fake style.
 */

/** Hand-built `classList`-shaped fake backed by a `Set`. */
function makeFakeClassList(): SkinClassList & { has(token: string): boolean } {
  const tokens = new Set<string>();
  return {
    add(token: string): void {
      tokens.add(token);
    },
    remove(token: string): void {
      tokens.delete(token);
    },
    has(token: string): boolean {
      return tokens.has(token);
    },
  };
}

/** Hand-built chrome-element-shaped fake: the only surface `createCameraSkin` writes text to. */
function makeFakeChrome(): { textContent: string | null } {
  return { textContent: null };
}

describe("CAMERA_SKINS", () => {
  it('is exactly ["police", "sports"]', () => {
    expect(CAMERA_SKINS).toEqual(["police", "sports"]);
  });
});

describe("applySkinClasses", () => {
  it('leaves exactly skin-police present and skin-sports absent for "police"', () => {
    const classList = makeFakeClassList();
    applySkinClasses("police", classList);
    expect(classList.has("skin-police")).toBe(true);
    expect(classList.has("skin-sports")).toBe(false);
  });

  it('leaves exactly skin-sports present and skin-police absent for "sports" (the mirror)', () => {
    const classList = makeFakeClassList();
    applySkinClasses("sports", classList);
    expect(classList.has("skin-sports")).toBe(true);
    expect(classList.has("skin-police")).toBe(false);
  });

  it("calling applySkinClasses twice with the same skin is idempotent — exactly one class remains", () => {
    const classList = makeFakeClassList();
    applySkinClasses("police", classList);
    applySkinClasses("police", classList);
    expect(classList.has("skin-police")).toBe(true);
    expect(classList.has("skin-sports")).toBe(false);
  });

  it("switching police -> sports -> police leaves exactly one skin class at every step", () => {
    const classList = makeFakeClassList();

    applySkinClasses("police", classList);
    expect(classList.has("skin-police")).toBe(true);
    expect(classList.has("skin-sports")).toBe(false);

    applySkinClasses("sports", classList);
    expect(classList.has("skin-police")).toBe(false);
    expect(classList.has("skin-sports")).toBe(true);

    applySkinClasses("police", classList);
    expect(classList.has("skin-police")).toBe(true);
    expect(classList.has("skin-sports")).toBe(false);
  });
});

describe("createCameraSkin", () => {
  it("exercised only through an injected fake element pair — never document", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    expect(() => createCameraSkin(classList, chrome, "police")).not.toThrow();
  });

  it("cycle() returns the next skin and wraps around; current() tracks it", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    const switcher = createCameraSkin(classList, chrome, "police");
    expect(switcher.current()).toBe("police");

    const next = switcher.cycle();
    expect(next).toBe("sports");
    expect(switcher.current()).toBe("sports");

    const wrapped = switcher.cycle();
    expect(wrapped).toBe("police");
    expect(switcher.current()).toBe("police");
  });

  it("construction applies the initial skin class and chrome label", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    createCameraSkin(classList, chrome, "police");
    expect(classList.has("skin-police")).toBe(true);
    expect(chrome.textContent).toBe("● LIVE");
  });

  it("set() applies the new skin class, clears the old one, and updates the chrome label", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    const switcher = createCameraSkin(classList, chrome, "police");

    switcher.set("sports");
    expect(classList.has("skin-sports")).toBe(true);
    expect(classList.has("skin-police")).toBe(false);
    expect(chrome.textContent).toBe("◆ BROADCAST");
  });

  it("dispose() removes both skin classes and blanks the chrome label", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    const switcher = createCameraSkin(classList, chrome, "sports");

    switcher.dispose();
    expect(classList.has("skin-police")).toBe(false);
    expect(classList.has("skin-sports")).toBe(false);
    expect(chrome.textContent).toBeNull();
  });

  it("defaults to the first CAMERA_SKINS entry when no initial skin is given", () => {
    const classList = makeFakeClassList();
    const chrome = makeFakeChrome();
    const switcher = createCameraSkin(classList, chrome);
    expect(switcher.current()).toBe(CAMERA_SKINS[0] satisfies CameraSkin);
  });
});

describe("camera-skin.ts — presentation only (CAM-03), source-level proof", () => {
  /** Mirrors tests/layering.test.ts's isCommentLine idiom exactly. */
  function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
  }

  it("no non-comment line references any camera-rig-shaped identifier", () => {
    // The doc comment is deliberately excluded from this check (via
    // isCommentLine, same as tests/layering.test.ts) — it must be free to
    // NAME the things it may not touch ("never distance, damping or
    // targeting") without tripping the very rule it documents.
    const FORBIDDEN =
      /\b(camera|fov|updateProjectionMatrix|quaternion|lookAt|position|distance|Lambda|CameraRig|CameraTarget)\b/;
    const lines = cameraSkinSource.split("\n");
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (FORBIDDEN.test(lines[i])) {
        hits.push(`${i + 1}: ${lines[i].trim()}`);
      }
    }
    expect(hits.join("\n")).toBe("");
  });
});

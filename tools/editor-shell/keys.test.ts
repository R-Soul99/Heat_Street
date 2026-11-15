import { describe, expect, it } from "vitest";
import {
  adjustDirection,
  type Binding,
  isTextEntryFocused,
  resolveShortcut,
  STANDARD_BINDINGS,
} from "./keys";

const free = { textFocused: false, dialogOpen: false };
const bindings: Binding[] = [
  ...STANDARD_BINDINGS,
  { id: "tool.select", code: "KeyV", label: "V" },
  { id: "toggle", code: "KeyG", noRepeat: true, label: "G" },
];
const k = (code: string, extra: object = {}) => ({ code, key: code, ...extra });

describe("resolveShortcut", () => {
  it("maps standard bindings", () => {
    expect(resolveShortcut(k("KeyZ", { ctrlKey: true }), bindings, free)).toBe("undo");
    expect(resolveShortcut(k("KeyZ", { ctrlKey: true, shiftKey: true }), bindings, free)).toBe(
      "redo",
    );
    expect(resolveShortcut(k("KeyY", { ctrlKey: true }), bindings, free)).toBe("redo");
    expect(resolveShortcut(k("KeyS", { ctrlKey: true }), bindings, free)).toBe("save");
    expect(resolveShortcut(k("KeyS", { metaKey: true }), bindings, free)).toBe("save");
    expect(resolveShortcut(k("KeyV"), bindings, free)).toBe("tool.select");
  });
  it("is blocked by text focus or dialog, except Escape", () => {
    expect(
      resolveShortcut(k("KeyV"), bindings, { textFocused: true, dialogOpen: false }),
    ).toBeUndefined();
    expect(
      resolveShortcut(k("KeyV"), bindings, { textFocused: false, dialogOpen: true }),
    ).toBeUndefined();
    expect(resolveShortcut(k("Escape"), bindings, { textFocused: true, dialogOpen: true })).toBe(
      "escape",
    );
  });
  it("ignores Alt and composition", () => {
    expect(resolveShortcut(k("KeyV", { altKey: true }), bindings, free)).toBeUndefined();
    expect(resolveShortcut(k("KeyV", { isComposing: true }), bindings, free)).toBeUndefined();
  });
  it("honours noRepeat", () => {
    expect(resolveShortcut(k("KeyG", { repeat: true }), bindings, free)).toBeUndefined();
    expect(resolveShortcut(k("KeyG"), bindings, free)).toBe("toggle");
  });
  it("requires exact modifiers", () => {
    expect(resolveShortcut(k("KeyV", { ctrlKey: true }), bindings, free)).toBeUndefined();
  });
});

describe("adjustDirection", () => {
  it("maps brackets and arrows", () => {
    expect(adjustDirection({ code: "BracketRight", key: "]" })).toEqual({ dir: 1, coarse: false });
    expect(adjustDirection({ code: "BracketLeft", key: "[" })).toEqual({ dir: -1, coarse: false });
    expect(adjustDirection({ code: "x", key: "ArrowUp" })?.dir).toBe(1);
    expect(adjustDirection({ code: "x", key: "ArrowRight" })?.dir).toBe(1);
    expect(adjustDirection({ code: "x", key: "ArrowDown" })?.dir).toBe(-1);
    expect(adjustDirection({ code: "x", key: "ArrowLeft" })?.dir).toBe(-1);
  });
  it("Shift+bracket is coarse even when key becomes { or }", () => {
    expect(adjustDirection({ code: "BracketRight", key: "}", shiftKey: true })).toEqual({
      dir: 1,
      coarse: true,
    });
    expect(adjustDirection({ code: "BracketLeft", key: "{", shiftKey: true })).toEqual({
      dir: -1,
      coarse: true,
    });
    expect(adjustDirection({ code: "BracketLeft", key: "[", altKey: true })).toBeUndefined();
  });
  it("shift is coarse; ctrl+arrow reserved", () => {
    expect(adjustDirection({ code: "x", key: "ArrowUp", shiftKey: true })).toEqual({
      dir: 1,
      coarse: true,
    });
    expect(adjustDirection({ code: "x", key: "ArrowUp", ctrlKey: true })).toBeUndefined();
    expect(adjustDirection({ code: "KeyA", key: "a" })).toBeUndefined();
  });
});

describe("isTextEntryFocused", () => {
  it("detects typing targets", () => {
    expect(isTextEntryFocused(null)).toBe(false);
    expect(isTextEntryFocused({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryFocused({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTextEntryFocused({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTextEntryFocused({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryFocused({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntryFocused({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryFocused({ tagName: "SELECT" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  type Binding,
  isTextEntry,
  isValueControl,
  type KeyEventLike,
  resolveShortcut,
  shortcutLabel,
} from "./keys";

const ev = (o: Partial<KeyEventLike> & { code: string }): KeyEventLike => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});
const ctx = { textEntry: false, valueControl: false, dialogOpen: false };
const b = (o: Partial<Binding> & { code: string }): Binding => ({
  label: "x",
  description: "x",
  run: () => {},
  ...o,
});

describe("isTextEntry", () => {
  it("classifies inputs", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true);
    for (const t of ["checkbox", "range", "button", "file"]) {
      expect(isTextEntry({ tagName: "INPUT", type: t })).toBe(false);
    }
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("isValueControl", () => {
  it("classifies", () => {
    expect(isValueControl({ tagName: "SELECT" })).toBe(true);
    expect(isValueControl({ tagName: "INPUT", type: "range" })).toBe(true);
    expect(isValueControl({ tagName: "SPAN", closest: () => ({}) })).toBe(true);
    expect(isValueControl({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isValueControl(null)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("requires ctrl state to match", () => {
    const z = b({ code: "KeyZ", ctrl: true });
    expect(resolveShortcut(ev({ code: "KeyZ", ctrlKey: true }), [z], ctx)).toBe(z);
    expect(
      resolveShortcut(ev({ code: "KeyZ", ctrlKey: true }), [b({ code: "KeyZ" })], ctx),
    ).toBeNull();
    expect(resolveShortcut(ev({ code: "KeyZ", metaKey: true }), [z], ctx)).toBe(z);
  });
  it("handles shift", () => {
    const z = b({ code: "KeyZ", ctrl: true });
    const zs = b({ code: "KeyZ", ctrl: true, shift: true });
    const e = ev({ code: "KeyZ", ctrlKey: true, shiftKey: true });
    expect(resolveShortcut(e, [z], ctx)).toBeNull();
    expect(resolveShortcut(e, [zs], ctx)).toBe(zs);
    const any = b({ code: "BracketRight", shift: "any" });
    expect(resolveShortcut(ev({ code: "BracketRight" }), [any], ctx)).toBe(any);
    expect(resolveShortcut(ev({ code: "BracketRight", shiftKey: true }), [any], ctx)).toBe(any);
  });
  it("ignores alt, dialogs, composing", () => {
    const s = b({ code: "KeyS", ctrl: true, allowInTextEntry: true });
    expect(resolveShortcut(ev({ code: "KeyS", ctrlKey: true, altKey: true }), [s], ctx)).toBeNull();
    expect(
      resolveShortcut(ev({ code: "KeyS", ctrlKey: true }), [s], { ...ctx, dialogOpen: true }),
    ).toBeNull();
    expect(
      resolveShortcut(ev({ code: "KeyS", ctrlKey: true, isComposing: true }), [s], ctx),
    ).toBeNull();
  });
  it("text entry only allows flagged bindings", () => {
    const s = b({ code: "KeyS", ctrl: true, allowInTextEntry: true });
    const h = b({ code: "KeyH" });
    const c = { ...ctx, textEntry: true };
    expect(resolveShortcut(ev({ code: "KeyS", ctrlKey: true }), [s], c)).toBe(s);
    expect(resolveShortcut(ev({ code: "KeyH" }), [h], c)).toBeNull();
  });
  it("value control skips arrows only", () => {
    const up = b({ code: "ArrowUp" });
    const h = b({ code: "KeyH" });
    const c = { ...ctx, valueControl: true };
    expect(resolveShortcut(ev({ code: "ArrowUp" }), [up], c)).toBeNull();
    expect(resolveShortcut(ev({ code: "KeyH" }), [h], c)).toBe(h);
  });
  it("disabled binding falls through to the next match", () => {
    const off = b({ code: "KeyH", enabled: () => false });
    const on = b({ code: "KeyH" });
    expect(resolveShortcut(ev({ code: "KeyH" }), [off, on], ctx)).toBe(on);
  });
});

describe("shortcutLabel", () => {
  it("formats", () => {
    expect(shortcutLabel(b({ code: "KeyZ", ctrl: true, shift: true }))).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel(b({ code: "BracketLeft" }))).toBe("[");
    expect(shortcutLabel(b({ code: "BracketRight", shift: true }))).toBe("Shift+]");
    expect(shortcutLabel(b({ code: "Digit1" }))).toBe("1");
    expect(shortcutLabel(b({ code: "ArrowUp" }))).toBe("Up");
    expect(shortcutLabel(b({ code: "Delete" }))).toBe("Delete");
    expect(shortcutLabel(b({ code: "KeyH" }))).toBe("H");
  });
});

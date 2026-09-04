import { describe, expect, it } from "vitest";
import {
  SHORTCUT_HINTS,
  WIDGET_ACTIONS,
  isEditableTarget,
  isFeedbackModeShortcut,
  isVisibilityToggleShortcut,
  matchGlobalChord,
  matchPanelKey,
  shortcutBadge,
} from "./shortcuts";

function key(init: KeyboardEventInit & { code?: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

const chord = (extra: KeyboardEventInit & { code?: string }) => key({ ctrlKey: true, shiftKey: true, ...extra });

describe("matchGlobalChord", () => {
  it("maps each punctuation chord to its action", () => {
    expect(matchGlobalChord(chord({ code: "Comma", key: "," }))).toBe("feedback-mode");
    expect(matchGlobalChord(chord({ code: "Period", key: "." }))).toBe("toggle-widget");
    expect(matchGlobalChord(chord({ code: "Semicolon", key: ";" }))).toBe("feedback-list");
    expect(matchGlobalChord(chord({ code: "Quote", key: "'" }))).toBe("settings");
    expect(matchGlobalChord(chord({ code: "Backslash", key: "\\" }))).toBe("shortcuts");
  });

  it("accepts Cmd on macOS as well as Ctrl", () => {
    expect(matchGlobalChord(key({ metaKey: true, shiftKey: true, code: "Comma", key: "<" }))).toBe("feedback-mode");
  });

  it("still matches when a Korean IME reports the key as Process", () => {
    expect(matchGlobalChord(chord({ code: "Semicolon", key: "Process" }))).toBe("feedback-list");
  });

  it("matches on the shifted character when the physical code is unknown", () => {
    expect(matchGlobalChord(chord({ key: ">" }))).toBe("toggle-widget");
    expect(matchGlobalChord(chord({ key: '"' }))).toBe("settings");
  });

  it("ignores the key without both modifiers, and with Alt", () => {
    expect(matchGlobalChord(key({ ctrlKey: true, code: "Comma", key: "," }))).toBeNull();
    expect(matchGlobalChord(key({ shiftKey: true, code: "Comma", key: "<" }))).toBeNull();
    expect(matchGlobalChord(chord({ altKey: true, code: "Comma", key: "," }))).toBeNull();
  });

  it("keeps the two original helpers working exactly as before", () => {
    expect(isFeedbackModeShortcut(chord({ code: "Comma", key: "," }))).toBe(true);
    expect(isFeedbackModeShortcut(chord({ code: "Period", key: "." }))).toBe(false);
    expect(isVisibilityToggleShortcut(chord({ code: "Period", key: "." }))).toBe(true);
    expect(isVisibilityToggleShortcut(key({ ctrlKey: true, code: "Period", key: "." }))).toBe(false);
  });
});

describe("matchPanelKey", () => {
  it("maps a bare letter to its action, whatever the case", () => {
    expect(matchPanelKey(key({ key: "f" }))).toEqual({ id: "feedback-mode" });
    expect(matchPanelKey(key({ key: "c" }))).toEqual({ id: "copy-all" });
    expect(matchPanelKey(key({ key: "e" }))).toEqual({ id: "export-all" });
    expect(matchPanelKey(key({ key: "l" }))).toEqual({ id: "feedback-list" });
    expect(matchPanelKey(key({ key: "s" }))).toEqual({ id: "settings" });
    expect(matchPanelKey(key({ key: "m" }))).toEqual({ id: "toggle-markers" });
    expect(matchPanelKey(key({ key: "d" }))).toEqual({ id: "toggle-hide-done" });
    expect(matchPanelKey(key({ key: "h" }))).toEqual({ id: "toggle-widget" });
    expect(matchPanelKey(key({ key: "Escape" }))).toEqual({ id: "close" });
  });

  it("treats Backspace and Delete alike for the destructive action", () => {
    expect(matchPanelKey(key({ key: "Backspace" }))).toEqual({ id: "clear-all" });
    expect(matchPanelKey(key({ key: "Delete" }))).toEqual({ id: "clear-all" });
  });

  it("turns a digit into a marker colour index", () => {
    expect(matchPanelKey(key({ key: "1" }))).toEqual({ id: "marker-color", index: 0 });
    expect(matchPanelKey(key({ key: "6" }))).toEqual({ id: "marker-color", index: 5 });
    expect(matchPanelKey(key({ key: "7" }))).toBeNull();
  });

  it("allows Shift only for ?, since that is how ? is typed", () => {
    expect(matchPanelKey(key({ key: "?", shiftKey: true }))).toEqual({ id: "shortcuts" });
    expect(matchPanelKey(key({ key: "F", shiftKey: true }))).toBeNull();
  });

  it("refuses anything with a modifier, so the host's Ctrl+C is left alone", () => {
    expect(matchPanelKey(key({ key: "c", ctrlKey: true }))).toBeNull();
    expect(matchPanelKey(key({ key: "c", metaKey: true }))).toBeNull();
    expect(matchPanelKey(key({ key: "c", altKey: true }))).toBeNull();
  });

  it("returns null for keys that mean nothing", () => {
    expect(matchPanelKey(key({ key: "x" }))).toBeNull();
    expect(matchPanelKey(key({ key: "ArrowDown" }))).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("is true for the elements that accept typing", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not compute isContentEditable from the attribute; set it the way the DOM would.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(editable)).toBe(true);
  });

  it("is false for a button, the body, and no target at all", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("the registry", () => {
  it("gives every action a way in from the keyboard", () => {
    for (const action of WIDGET_ACTIONS) {
      expect(action.chord || action.key, action.id).toBeTruthy();
    }
  });

  it("never binds a global chord to a letter, because browsers own those", () => {
    for (const action of WIDGET_ACTIONS) {
      if (action.chord) expect(action.chord.label).toMatch(/^[^a-z0-9]$/i);
    }
  });

  it("gives no two actions the same panel key", () => {
    const seen = new Map<string, string>();
    for (const action of WIDGET_ACTIONS) {
      for (const k of action.key?.keys ?? []) {
        expect(seen.get(k), `${k} already used by ${seen.get(k)}`).toBeUndefined();
        seen.set(k, action.id);
      }
    }
  });

  it("keeps local-only actions out of the hosted hint list", () => {
    const labels = SHORTCUT_HINTS.map((hint) => hint.label);
    expect(labels).not.toContain("전체 복사");
    expect(labels).not.toContain("전체 피드백 삭제");
    expect(labels).toContain("피드백 모드 켜기/끄기");
  });

  it("prefers the chord for a badge, since it works from anywhere", () => {
    expect(shortcutBadge("settings")).toBe("⌃⇧'");
    expect(shortcutBadge("copy-all")).toBe("C");
    expect(shortcutBadge("clear-all")).toBe("⌫");
  });
});

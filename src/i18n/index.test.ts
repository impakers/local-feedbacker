import { describe, expect, it } from "vitest";
import { getMessages, resolveLanguage } from "./index";

describe("local feedback localization", () => {
  it.each(["en", "es", "zh-CN", "ko"] as const)("has prompt labels for %s", (language) => {
    expect(getMessages(language).confirmedSource).toBeTruthy();
  });

  it("falls back to English for unsupported locales", () => {
    expect(resolveLanguage("fr-CA")).toBe("en");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings";

describe("screenshot capture setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps screenshot capture enabled for existing users without the new field", () => {
    localStorage.setItem("impakers-debug-settings", JSON.stringify({ markerColor: "#ef4444" }));

    expect(loadSettings().captureEnabled).toBe(true);
  });

  it("persists an explicit screenshot capture preference", () => {
    saveSettings({
      markerColor: "#6366f1",
      markersVisible: true,
      hideDoneMarkers: false,
      showOnlyMine: false,
      captureEnabled: false,
    });

    expect(loadSettings().captureEnabled).toBe(false);
  });
});

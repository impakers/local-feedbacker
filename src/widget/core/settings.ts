// =============================================================================
// @impakers/debug — Widget Settings (localStorage via StorageClient)
// =============================================================================
import { storage, KEYS } from "./storage";

export interface DebugSettings {
  readonly markerColor: string;
  readonly markersVisible: boolean;
  readonly hideDoneMarkers: boolean;
  readonly showOnlyMine: boolean;
  /** Whether submitted feedback includes a screenshot. */
  readonly captureEnabled: boolean;
}

const DEFAULTS: Readonly<DebugSettings> = {
  markerColor: "#6366f1",
  markersVisible: true,
  hideDoneMarkers: false,
  showOnlyMine: false,
  captureEnabled: true,
};

export function loadSettings(): DebugSettings {
  const stored = storage.get(KEYS.SETTINGS);
  if (!stored) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<DebugSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: DebugSettings): void {
  storage.set(KEYS.SETTINGS, JSON.stringify(settings));
}

export const MARKER_COLORS = [
  { id: "indigo", label: "인디고", value: "#6366f1" },
  { id: "blue", label: "블루", value: "#3b82f6" },
  { id: "red", label: "레드", value: "#ef4444" },
  { id: "green", label: "그린", value: "#16a34a" },
  { id: "orange", label: "오렌지", value: "#f97316" },
  { id: "pink", label: "핑크", value: "#ec4899" },
] as const;

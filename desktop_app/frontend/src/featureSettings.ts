/** Local feature toggles for generation capabilities and plans. */

export interface FeatureSettings {
  /** Explicit plan id from GET /api/v1/capabilities, or null for the default pandas Plan. */
  planId: string | null;
  /** Allow chart/plot questions (visualization_spec is an optional Artifact, not a Plan). */
  enableVisualization: boolean;
  /** Allow data-transformation requests. */
  enableTransformation: boolean;
}

const STORAGE_KEY = "nolain_feature_settings";

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  planId: null,
  enableVisualization: true,
  enableTransformation: true,
};

export function loadFeatureSettings(): FeatureSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FEATURE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FeatureSettings>;
    return {
      planId: parsed.planId ?? DEFAULT_FEATURE_SETTINGS.planId,
      enableVisualization: parsed.enableVisualization ?? DEFAULT_FEATURE_SETTINGS.enableVisualization,
      enableTransformation: parsed.enableTransformation ?? DEFAULT_FEATURE_SETTINGS.enableTransformation,
    };
  } catch {
    return { ...DEFAULT_FEATURE_SETTINGS };
  }
}

export function saveFeatureSettings(settings: FeatureSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Human-readable labels for data_analysis plan ids. */
export function planLabel(planId: string): string {
  const labels: Record<string, string> = {
    "data_analysis/pandas": "Pandas (code → optional DAG → validate)",
    "data_analysis/ibis": "Ibis (placeholder)",
  };
  return labels[planId] ?? planId;
}

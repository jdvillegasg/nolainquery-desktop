/** Local BYOK inference settings. Nolain API keys stay in App.tsx. */

export type InferenceMode = "platform" | "byok";

export interface InferenceSettings {
  mode: InferenceMode;
  openRouterKey: string;
}

const MODE_STORAGE_KEY = "nolain_inference_mode";
const LLM_KEY_STORAGE_KEY = "nolain_openrouter_api_key";

export const DEFAULT_INFERENCE_SETTINGS: InferenceSettings = {
  mode: "platform",
  openRouterKey: "",
};

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

export function loadInferenceSettings(): InferenceSettings {
  try {
    const modeRaw = localStorage.getItem(MODE_STORAGE_KEY);
    const mode: InferenceMode = modeRaw === "byok" ? "byok" : "platform";
    const openRouterKey = localStorage.getItem(LLM_KEY_STORAGE_KEY) ?? "";
    return { mode, openRouterKey };
  } catch {
    return { ...DEFAULT_INFERENCE_SETTINGS };
  }
}

export function saveInferenceSettings(settings: InferenceSettings): void {
  localStorage.setItem(MODE_STORAGE_KEY, settings.mode);
  localStorage.setItem(LLM_KEY_STORAGE_KEY, settings.openRouterKey);
}

export function activeLlmCredential(): string | null {
  const settings = loadInferenceSettings();
  if (settings.mode !== "byok") return null;
  const key = settings.openRouterKey.trim();
  return key || null;
}

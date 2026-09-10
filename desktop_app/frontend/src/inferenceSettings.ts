/** Local OpenRouter key for BYOK inference. Nolain API keys stay in App.tsx. */

export interface InferenceSettings {
  openRouterKey: string;
}

const LLM_KEY_STORAGE_KEY = "nolain_openrouter_api_key";
const MODE_STORAGE_KEY = "nolain_inference_mode";

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

export function loadInferenceSettings(): InferenceSettings {
  try {
    const openRouterKey = localStorage.getItem(LLM_KEY_STORAGE_KEY) ?? "";
    // Desktop builds are BYOK-only; normalize legacy platform mode on read.
    if (localStorage.getItem(MODE_STORAGE_KEY) !== "byok") {
      localStorage.setItem(MODE_STORAGE_KEY, "byok");
    }
    return { openRouterKey };
  } catch {
    return { openRouterKey: "" };
  }
}

export function saveInferenceSettings(settings: InferenceSettings): void {
  localStorage.setItem(MODE_STORAGE_KEY, "byok");
  localStorage.setItem(LLM_KEY_STORAGE_KEY, settings.openRouterKey);
}

export function activeLlmCredential(): string | null {
  const key = loadInferenceSettings().openRouterKey.trim();
  return key || null;
}

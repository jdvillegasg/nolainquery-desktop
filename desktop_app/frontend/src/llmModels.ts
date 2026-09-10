import { fetchLlmModels, type LlmModelOption } from "./lib/cloudApi";

let cachedApiKey: string | null = null;
let cachedModels: LlmModelOption[] | null = null;
let cachedDefaultModelId: string | null = null;
let inflight: Promise<LlmModelOption[]> | null = null;

export async function loadLlmModels(apiKey: string): Promise<LlmModelOption[]> {
  if (cachedModels && cachedApiKey === apiKey) return cachedModels;
  if (inflight && cachedApiKey === apiKey) return inflight;

  cachedApiKey = apiKey;
  cachedModels = null;
  cachedDefaultModelId = null;

  inflight = fetchLlmModels(apiKey)
    .then((response) => {
      cachedModels = response.models;
      cachedDefaultModelId = response.default_model_id;
      return response.models;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getCachedLlmModels(): LlmModelOption[] {
  return cachedModels ?? [];
}

export function getDefaultLlmModelId(models: LlmModelOption[]): string | null {
  if (cachedDefaultModelId) return cachedDefaultModelId;
  return models.find((model) => model.default)?.id ?? models[0]?.id ?? null;
}

export function isStaleThreadLlmModelId(
  threadModelId: string | null | undefined,
  models: LlmModelOption[],
): boolean {
  return Boolean(
    threadModelId && !models.some((model) => model.id === threadModelId),
  );
}

export function resolveThreadLlmModelId(
  threadModelId: string | null | undefined,
  models: LlmModelOption[],
): string | null {
  if (threadModelId && models.some((model) => model.id === threadModelId)) {
    return threadModelId;
  }
  return getDefaultLlmModelId(models);
}

export function llmModelLabel(modelId: string | null, models: LlmModelOption[]): string {
  if (!modelId) return "Default model";
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}

export function resetLlmModelCache(): void {
  cachedApiKey = null;
  cachedModels = null;
  cachedDefaultModelId = null;
  inflight = null;
}

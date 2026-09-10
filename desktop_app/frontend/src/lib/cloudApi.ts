import { activeLlmCredential } from "../inferenceSettings";

export const CLOUD_API =
  import.meta.env.VITE_CLOUD_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export const SIDECAR_API =
  import.meta.env.VITE_SIDECAR_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8001";
const SIDECAR_TOKEN = import.meta.env.VITE_SIDECAR_TOKEN?.trim() || "";

export function sidecarFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (SIDECAR_TOKEN) headers.set("X-Nolain-Sidecar-Token", SIDECAR_TOKEN);
  return fetch(input, { ...init, headers });
}

export const PORTAL_URL =
  import.meta.env.VITE_PORTAL_URL?.replace(/\/$/, "") || "https://nolainquery.com";

export interface InferenceModeInfo {
  id: string;
  label: string;
  requires_credits: boolean;
}

export interface ApiKeyStatus {
  tier: string;
  masked_key: string;
  credit_balance: number | null;
  can_consume: boolean;
  is_active: boolean;
  label: string | null;
  byok_enabled?: boolean;
  inference_modes?: InferenceModeInfo[];
}

export class CloudApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CloudApiError";
  }
}

export function cloudAuthHeaders(
  apiKey: string,
  options?: { includeLlmCredential?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = { "X-API-Key": apiKey };
  if (options?.includeLlmCredential !== false) {
    const credential = activeLlmCredential();
    if (credential) headers["X-LLM-Credential"] = credential;
  }
  return headers;
}

export async function fetchApiKeyStatus(apiKey: string): Promise<ApiKeyStatus> {
  const response = await fetch(`${CLOUD_API}/api/auth/key-status`, {
    headers: cloudAuthHeaders(apiKey, { includeLlmCredential: false }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch (_err) {
      // ignore
    }
    throw new CloudApiError(response.status, detail);
  }

  return (await response.json()) as ApiKeyStatus;
}

export interface CapabilityPlanInfo {
  plan_id: string;
  selectable: boolean;
  default?: boolean;
  implemented?: boolean;
  engine?: string;
  stages: string[];
  optional_stages?: string[];
  optional_artifacts?: string[];
  terminal_artifact_kinds: string[];
}

export interface CapabilityInfo {
  id: string;
  enabled: boolean;
  plans: CapabilityPlanInfo[];
}

export interface LlmModelOption {
  id: string;
  label: string;
  openrouter_model: string;
  default?: boolean;
}

export interface LlmModelsResponse {
  provider: string;
  default_model_id: string;
  models: LlmModelOption[];
  byok_enabled?: boolean;
  inference_modes?: InferenceModeInfo[];
}

export async function fetchLlmModels(apiKey: string): Promise<LlmModelsResponse> {
  const response = await fetch(`${CLOUD_API}/api/v1/llm/models`, {
    headers: cloudAuthHeaders(apiKey),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch (_err) {
      // ignore
    }
    throw new CloudApiError(response.status, detail);
  }

  return (await response.json()) as LlmModelsResponse;
}

export async function fetchCapabilities(apiKey: string): Promise<CapabilityInfo[]> {
  const response = await fetch(`${CLOUD_API}/api/v1/capabilities`, {
    headers: cloudAuthHeaders(apiKey),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch (_err) {
      // ignore
    }
    throw new CloudApiError(response.status, detail);
  }

  const data = (await response.json()) as { capabilities: CapabilityInfo[] };
  return data.capabilities ?? [];
}

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import "./App.css";
import DashboardCrafter from "./DashboardCrafter";
import DAGEditor, { AppDAGFile, DAGData, PythonCellOutput, ConversationMsg, AmbiguousConcept } from "./DAGEditor";
import {
  QueryThread,
  createEmptyThread,
  DEFAULT_VISIBLE_THREADS,
  formatThreadTime,
  loadThreadsForFile,
  persistThreadsForFile,
  snapshotConversationArtifact,
  threadStorageKey,
  threadTitleFromMessages,
} from "./queryThreads";
import { parsePandasSectionCodes } from "./pythonNotebook";
import {
  AnswerPayload,
  composeAnswer,
  translateError,
  answerToPlainText,
  buildAnswerCopyText,
  resultToCsv,
  applySynthesisCrossCheck,
} from "./answerComposer";
import { generationStepLabelFromDagStatus } from "./generationProgress";
import {
  attachLocalUsageToMessage,
  persistLocalUsageFromTaskPoll,
  usageForTaskId,
  type QueryUsage,
} from "./usageMetrics";
import SettingsView from "./views/settings/SettingsView";
import { activeLlmCredential } from "./inferenceSettings";
import { loadFeatureSettings } from "./featureSettings";
import { loadLlmModels, resetLlmModelCache, resolveThreadLlmModelId } from "./llmModels";
import PinnedCanvas from "./PinnedCanvas";
import {
  canPinKind,
  createPinnedItem,
  loadPinnedItems,
  persistPinnedItems,
  type PinnedArtifactKind,
  type PinnedItem,
} from "./pinnedArtifacts";
import {
  CLOUD_API,
  SIDECAR_API,
  sidecarFetch,
  fetchApiKeyStatus,
  cloudAuthHeaders,
  type ApiKeyStatus,
  type LlmModelOption,
  CloudApiError,
} from "./lib/cloudApi";
import {
  parseCanvasManifestFromPoll,
  slotForKind,
  type CanvasManifest,
} from "./canvasManifest";
import HomeView from "./views/home/HomeView";
import QueryStatusDots from "./views/query/QueryStatusDots";
import type { InsightsData } from "./views/home/types";
import {
  activeMaterializedPath,
  activeTable,
  buildCloudWorkbookMetadata,
  datasetDisplayLabel,
  openWorkbook,
  type WorkbookCatalog,
} from "./lib/workbook";

function isAppDAGFile(obj: unknown): obj is AppDAGFile {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'name' in obj &&
    'dag' in obj &&
    typeof (obj as AppDAGFile).version === 'string' &&
    isRawDag((obj as AppDAGFile).dag)
  );
}

function isRawDag(obj: unknown): obj is DAGData {
  return !!obj && typeof obj === 'object' && Array.isArray((obj as DAGData).nodes) && typeof (obj as DAGData).output_node === 'string';
}

// ── Types ─────────────────────────────────────────────────────────────────────
type MainView = "home" | "query" | "settings" | "dashboard" | "pinned";

// ── Local storage keys ────────────────────────────────────────────────────────
const API_KEY_STORAGE_KEY = "nolain_api_key";
const RECENT_FILES_STORAGE_KEY = "nolain_recent_files";
const MAX_RECENT_FILES = 10;
const MAX_STORED_ARTIFACTS = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchHealth(
  url: string,
  requester: typeof fetch = fetch,
): Promise<{ ok: boolean; body: any | null }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await requester(url, { method: 'GET', signal: controller.signal });
    let body: any | null = null;
    try {
      body = await response.json();
    } catch {
      // An HTTP success still proves the endpoint is reachable.
    }
    return { ok: response.ok, body };
  } catch {
    return { ok: false, body: null };
  } finally {
    window.clearTimeout(timeout);
  }
}

function loadApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}
function saveApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}
function loadRecentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function addRecentFile(path: string): string[] {
  const existing = loadRecentFiles().filter((p) => p !== path);
  const updated = [path, ...existing].slice(0, MAX_RECENT_FILES);
  localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function looksLikeVisualizationQuery(text: string): boolean {
  return /\b(chart|plot|graph|visuali[sz]|bar chart|line chart|pie chart|histogram|scatter)\b/i.test(text);
}

function looksLikeTransformationQuery(text: string): boolean {
  return /\b(clean|dedupe|dedup|normalize|reshape|transform|pivot|unpivot|remove duplicates|export copy)\b/i.test(text);
}

function blockedByFeatureSettings(message: string): string | null {
  const settings = loadFeatureSettings();
  if (!settings.enableVisualization && looksLikeVisualizationQuery(message)) {
    return "Visualization requests are disabled in Settings → Capabilities & plans. Enable “Allow visualization requests” or rephrase as a table/analysis question.";
  }
  if (!settings.enableTransformation && looksLikeTransformationQuery(message)) {
    return "Transformation requests are disabled in Settings → Capabilities & plans. Enable “Allow transformation requests” or ask for a descriptive analysis instead.";
  }
  return null;
}
// ── Navigation Icons ──────────────────────────────────────────────────────────
const IconHome = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <path d="M1 7L7 1L13 7V13H9V9H5V13H1V7Z"/>
  </svg>
);
const IconData = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <rect x="1" y="1" width="5" height="5"/>
    <rect x="8" y="1" width="5" height="5"/>
    <rect x="1" y="8" width="5" height="5"/>
    <rect x="8" y="8" width="5" height="5"/>
  </svg>
);
const IconQuery = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <rect x="1" y="1" width="12" height="12"/>
    <path d="M4 5L6.5 7L4 9"/>
    <path d="M7.5 9H10"/>
  </svg>
);
const IconPinned = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    <path d="M4.5 1.5H9.5L8 6.5L10.5 12L7 10L3.5 12L6 6.5L4.5 1.5Z"/>
  </svg>
);
const IconSettings = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="7" cy="7" r="2.2" />
    <path d="M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1" />
  </svg>
);
const IconRename = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
    <path d="M9.5 1.5L12.5 4.5L5 12H2V9L9.5 1.5Z" />
  </svg>
);
const IconDelete = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
    <path d="M2 4H12" />
    <path d="M5.5 4V2.5H8.5V4" />
    <path d="M3.5 4L4 12H10L10.5 4" />
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────
function App() {
  const [query, setQuery] = useState("");
  const [filePath, setFilePath] = useState("");
  const [workbookCatalog, setWorkbookCatalog] = useState<WorkbookCatalog | null>(null);
  const [workbookOpenError, setWorkbookOpenError] = useState<string | null>(null);
  const [workbookOpening, setWorkbookOpening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mainView, setMainView] = useState<MainView>("home");
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [generationStep, setGenerationStep] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [generationRuntimeStatus, setGenerationRuntimeStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [engineStatus, setEngineStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [datasetRowCount, setDatasetRowCount] = useState<number | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const [highlightCellIndex, setHighlightCellIndex] = useState<number | null>(null);
  const [pendingClarifications, setPendingClarifications] = useState<
    { term: string; chosen_interpretation: string }[] | null
  >(null);

  // ── DAG Editor states ─────────────────────────────────────────────────────
  const [dagData, setDagData] = useState<DAGData | null>(null);
  const [dagName, setDagName] = useState<string | null>(null);
  const [pythonCode, setPythonCode] = useState<string | null>(null);
  const [dagMode, setDagMode] = useState<'dag' | 'code' | 'dashboard'>('dag');
  const [compileDag, setCompileDag] = useState(true);
  const [includeVisualization, setIncludeVisualization] = useState(true);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelId, setLlmModelId] = useState<string | null>(null);
  const [canvasManifest, setCanvasManifest] = useState<CanvasManifest | null>(null);
  const [includeVisualizationRequested, setIncludeVisualizationRequested] = useState(true);
  const [pythonCellOutputs, setPythonCellOutputs] = useState<Record<number, PythonCellOutput>>({});
  const [pythonExecLoadingStep, setPythonExecLoadingStep] = useState<number | null>(null);
  // Ref instead of state: sequential cell runs need the latest session ID
  // synchronously — React state won't flush between awaits.
  const pythonSessionIdRef = useRef<string | null>(null);

  const queryInFlightRef = useRef(false);
  const queryAbortRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);

  // ── Conversation state ────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMsg[]>([]);
  const [queryThreads, setQueryThreads] = useState<QueryThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [clarificationConcepts, setClarificationConcepts] = useState<AmbiguousConcept[] | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [pendingQueryMessageId, setPendingQueryMessageId] = useState<string | null>(null);
  const [activeArtifactMessageId, setActiveArtifactMessageId] = useState<string | null>(null);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const loadedThreadKeyRef = useRef("");

  const threadStoragePath = useMemo(
    () => threadStorageKey(filePath, workbookCatalog),
    [filePath, workbookCatalog],
  );

  const resetDagExecution = useCallback(() => {}, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const resetPythonExecution = useCallback(() => {
    pythonSessionIdRef.current = null;
    setPythonCellOutputs({});
    setPythonExecLoadingStep(null);
  }, []);

  const applyWorkbookCatalog = useCallback((catalog: WorkbookCatalog) => {
    setWorkbookCatalog(catalog);
    setWorkbookOpenError(null);
    setFilePath(activeMaterializedPath(catalog));
    setRecentFiles(addRecentFile(catalog.source_path));
    setSessionId(null);
  }, []);

  const openDatasetFromPath = useCallback(async (
    sourcePath: string,
    options?: {
      activeTableId?: string;
      activeSheetName?: string;
      forceIncludeSheets?: string[];
    },
  ) => {
    setWorkbookOpening(true);
    setWorkbookOpenError(null);
    try {
      const catalog = await openWorkbook(sourcePath, options);
      applyWorkbookCatalog(catalog);
    } catch (err: unknown) {
      setWorkbookCatalog(null);
      setFilePath("");
      setWorkbookOpenError(
        err instanceof Error ? err.message : "Could not open dataset",
      );
    } finally {
      setWorkbookOpening(false);
    }
  }, [applyWorkbookCatalog]);

  const applyThreadToWorkspace = useCallback((thread: QueryThread) => {
    setSessionId(thread.sessionId);
    setConversationMessages(thread.conversationMessages);
    setQuery(thread.query);
    setDagData(thread.dagData);
    setDagName(thread.dagName);
    setPythonCode(thread.pythonCode);
    setDagMode(thread.compileDag === false && thread.dagMode === 'dag' ? 'code' : thread.dagMode);
    setCompileDag(thread.compileDag ?? true);
    setIncludeVisualization(thread.includeVisualization ?? true);
    setIncludeVisualizationRequested(thread.includeVisualization ?? true);
    setLlmModelId(thread.llmModelId ?? null);
    setClarificationConcepts(thread.clarificationConcepts ?? null);
    setPendingQuery(thread.pendingQuery ?? null);
    setPendingQueryMessageId(thread.pendingQueryMessageId ?? null);
    setPendingClarifications(null);
    setHighlightNodeId(null);
    setHighlightCellIndex(null);
    resetPythonExecution();
    const latestArtifactMessage = [...thread.conversationMessages]
      .reverse()
      .find((message) => message.artifact);
    setActiveArtifactMessageId(latestArtifactMessage?.id ?? null);
  }, [resetPythonExecution]);

  const resetQueryWorkspace = useCallback(() => {
    applyThreadToWorkspace(createEmptyThread());
    setDagData(null);
    setDagName(null);
    setPythonCode(null);
    setDagMode('dag');
  }, [applyThreadToWorkspace]);

  const handleClearDAG = useCallback(() => {
    setDagData(null);
    setDagName(null);
    setPythonCode(null);
    setDagMode('dag');
    resetDagExecution();
    resetPythonExecution();
  }, [resetDagExecution, resetPythonExecution]);

  const loadDagFromParsed = useCallback((parsed: unknown, _sourcePath: string | null) => {
    if (isAppDAGFile(parsed)) {
      setDagName(parsed.name);
      setDagData(parsed.dag);
      setPythonCode(parsed.python_code ?? null);
      setDagMode('dag');
    } else if (isRawDag(parsed)) {
      setDagName(null);
      setDagData(parsed);
      setPythonCode(null);
      setDagMode('dag');
    } else {
      throw new Error('Unrecognized JSON structure. Expected an AppDAGFile ({ name, version, dag }) or a raw DAGData ({ graph_id, nodes, output_node }).');
    }
    resetDagExecution();
    resetPythonExecution();
  }, [resetDagExecution, resetPythonExecution]);

  // ── API Key state ─────────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>(loadApiKey);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [usageRevision, setUsageRevision] = useState(0);

  const refreshApiKeyStatus = useCallback(async (key: string, options?: { silent?: boolean }) => {
    const trimmed = key.trim();
    if (!trimmed) {
      setApiKeyStatus(null);
      setApiKeyError(null);
      return;
    }
    if (!options?.silent) {
      setApiKeyValidating(true);
    }
    setApiKeyError(null);
    try {
      const status = await fetchApiKeyStatus(trimmed);
      setApiKeyStatus(status);
    } catch (err) {
      setApiKeyStatus(null);
      setApiKeyError(
        err instanceof CloudApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not validate API key.",
      );
    } finally {
      if (!options?.silent) {
        setApiKeyValidating(false);
      }
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      void refreshApiKeyStatus(apiKey);
    }
  }, [apiKey, refreshApiKeyStatus]);

  useEffect(() => {
    if (!apiKey) {
      resetLlmModelCache();
      setLlmModels([]);
      return;
    }
    resetLlmModelCache();
    let cancelled = false;
    void loadLlmModels(apiKey)
      .then((models) => {
        if (!cancelled) setLlmModels(models);
      })
      .catch(() => {
        if (!cancelled) setLlmModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (llmModels.length === 0 || !llmModelId) return;
    if (!llmModels.some((model) => model.id === llmModelId)) {
      setLlmModelId(null);
    }
  }, [llmModels, llmModelId]);

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyDraft.trim();
    saveApiKey(trimmed);
    setApiKey(trimmed);
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
    await refreshApiKeyStatus(trimmed);
  };

  const handleOpenDAG = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "DAG Files", extensions: ["json"] }],
      });
      if (!selected || typeof selected !== "string") return;
      const content = await readTextFile(selected);
      loadDagFromParsed(JSON.parse(content), selected);
    } catch (err: any) {
      console.error(err?.message ?? "Failed to open DAG file");
    }
  }, [loadDagFromParsed]);

  const handleJSONUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    if (!input.files?.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        loadDagFromParsed(JSON.parse(content), null);
      } catch (err: any) {
        console.error(err?.message ?? 'Failed to parse JSON for DAG');
      }
      input.value = '';
    };
    reader.readAsText(file);
  };

  // ── Export DAG to disk ────────────────────────────────────────────────────
  const handleExportDAG = useCallback(async (dag: DAGData, name: string, code?: string | null) => {
    try {
      const savePath = await save({
        filters: [{ name: "DAG Files", extensions: ["json"] }],
        defaultPath: `${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.dag.json`,
      });
      if (!savePath) return;
      const file: AppDAGFile = {
        name,
        version: '1',
        dag,
        ...(code ? { python_code: code } : {}),
      };
      await writeTextFile(savePath, JSON.stringify(file, null, 2));
    } catch (err: any) {
      console.error(err?.message ?? "Failed to save DAG file");
    }
  }, []);

  // ── Load or create query threads when the dataset identity changes ───────
  useEffect(() => {
    if (!filePath) {
      loadedThreadKeyRef.current = "";
      return;
    }
    const threadKey = threadStorageKey(filePath, workbookCatalog);
    if (loadedThreadKeyRef.current === threadKey) return;
    loadedThreadKeyRef.current = threadKey;

    let loaded = loadThreadsForFile(threadKey);
    // Migrate threads saved under materialized paths before source-path keys.
    if (loaded.length === 0 && filePath !== threadKey) {
      loaded = loadThreadsForFile(filePath);
      if (loaded.length > 0) {
        persistThreadsForFile(threadKey, loaded);
      }
    }

    const threads = loaded.length > 0 ? loaded : [createEmptyThread()];
    const preservedId = activeThreadIdRef.current;
    const active = preservedId && threads.some((thread) => thread.id === preservedId)
      ? threads.find((thread) => thread.id === preservedId)!
      : threads[0];
    setQueryThreads(threads);
    setActiveThreadId(active.id);
    applyThreadToWorkspace(active);
    setShowAllThreads(false);
    setRenamingThreadId(null);
    setDatasetRowCount(null);
    setHighlightNodeId(null);
    setHighlightCellIndex(null);
    setPinnedItems(loadPinnedItems(threadKey));
  }, [filePath, workbookCatalog, applyThreadToWorkspace]);

  useEffect(() => {
    persistPinnedItems(filePath, pinnedItems);
  }, [filePath, pinnedItems]);

  // ── Persist active thread snapshot ────────────────────────────────────────
  useEffect(() => {
    if (!activeThreadId) return;
    setQueryThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === activeThreadId);
      if (idx === -1) return prev;
      const current = prev[idx];
      const nextThread: QueryThread = {
        ...current,
        sessionId,
        conversationMessages,
        dagData,
        dagName,
        pythonCode,
        dagMode,
        compileDag,
        includeVisualization,
        llmModelId,
        query,
        clarificationConcepts,
        pendingQuery,
        pendingQueryMessageId,
        title: current.titleEdited
          ? current.title
          : threadTitleFromMessages(conversationMessages, current.title),
        updatedAt: Date.now(),
      };
      if (
        current.sessionId === nextThread.sessionId
        && current.conversationMessages === nextThread.conversationMessages
        && current.dagData === nextThread.dagData
        && current.dagName === nextThread.dagName
        && current.pythonCode === nextThread.pythonCode
        && current.dagMode === nextThread.dagMode
        && current.compileDag === nextThread.compileDag
        && current.includeVisualization === nextThread.includeVisualization
        && current.llmModelId === nextThread.llmModelId
        && current.query === nextThread.query
        && current.clarificationConcepts === nextThread.clarificationConcepts
        && current.pendingQuery === nextThread.pendingQuery
        && current.pendingQueryMessageId === nextThread.pendingQueryMessageId
        && current.title === nextThread.title
      ) {
        return prev;
      }
      const next = [...prev];
      next[idx] = nextThread;
      persistThreadsForFile(threadStoragePath, next);
      return next;
    });
  }, [
    activeThreadId,
    sessionId,
    conversationMessages,
    dagData,
    dagName,
    pythonCode,
    dagMode,
    compileDag,
    includeVisualization,
    llmModelId,
    query,
    clarificationConcepts,
    pendingQuery,
    pendingQueryMessageId,
    threadStoragePath,
  ]);

  // ── Load insights when filePath changes ───────────────────────────────────
  useEffect(() => {
    if (!filePath) {
      setInsights(null);
      setInsightsError(null);
      return;
    }
    setInsightsLoading(true);
    setInsightsError(null);
    sidecarFetch(
      `${SIDECAR_API}/insights_data?source_path=${encodeURIComponent(filePath)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "success") {
          setInsights(data.insights);
        } else {
          setInsights(null);
          setInsightsError(data.detail || "Could not load executive insights for this file.");
        }
      })
      .catch(() => {
        setInsights(null);
        setInsightsError("Could not load executive insights — is the local data engine running?");
      })
      .finally(() => setInsightsLoading(false));
  }, [filePath]);

  // ── Cloud API health check ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${CLOUD_API}/health`, { method: 'GET', signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (!cancelled) {
          setApiStatus(res.ok ? 'ok' : 'error');
          const services = data?.services;
          setGenerationRuntimeStatus(
            res.ok && services?.redis?.ok === true && services?.celery?.ok === true
              ? 'ok'
              : 'error',
          );
        }
      } catch {
        if (!cancelled) {
          setApiStatus('error');
          setGenerationRuntimeStatus('error');
        }
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Local engine health check ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await sidecarFetch(`${SIDECAR_API}/health`, { method: 'GET', signal: AbortSignal.timeout(3000) });
        if (!cancelled) setEngineStatus(res.ok ? 'ok' : 'error');
      } catch {
        if (!cancelled) setEngineStatus('error');
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // A status badge is allowed to become stale. Message submission is not: verify
  // both local services immediately before rejecting a user request.
  const refreshServiceHealth = useCallback(async () => {
    const [cloud, engine] = await Promise.all([
      fetchHealth(`${CLOUD_API}/health`),
      fetchHealth(`${SIDECAR_API}/health`, sidecarFetch),
    ]);
    const services = cloud.body?.services;
    const runtimeOk = cloud.ok
      && services?.redis?.ok === true
      && services?.celery?.ok === true;
    setApiStatus(cloud.ok ? 'ok' : 'error');
    setGenerationRuntimeStatus(runtimeOk ? 'ok' : 'error');
    setEngineStatus(engine.ok ? 'ok' : 'error');
    return { cloudOk: cloud.ok, runtimeOk, engineOk: engine.ok };
  }, []);

  // ── Execute DAG from visualizer ───────────────────────────────────────────
  const handleRunDAG = async (dag: DAGData) => {
    if (!filePath) {
      return;
    }
    try {
      const execResponse = await sidecarFetch(
        `${SIDECAR_API}/execute_dag?engine=pandas&source_path=` + encodeURIComponent(filePath),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dag),
        }
      );
      const execData = await execResponse.json();
      if (execData.status !== "success") throw new Error(execData.detail || "Execution failed");
      addConversationMsg({
        role: 'assistant',
        content: `DAG execution completed: ${JSON.stringify(execData.result)}`,
        type: 'text',
        timestamp: Date.now(),
      });
    } catch (err: any) {
      addConversationMsg({
        role: 'assistant',
        content: translateError(err.message || "An unexpected error occurred"),
        type: 'error',
        timestamp: Date.now(),
      });
    }
  };

  // ── Execute Python code (notebook cell) ───────────────────────────────────
  const handleRunPython = async (
    code: string,
    stepIndex: number,
    options?: { resetSession?: boolean },
  ): Promise<boolean> => {
    if (!filePath) {
      setPythonCellOutputs((prev) => ({
        ...prev,
        [stepIndex]: { status: 'error', error: 'No file selected. Go to the Home tab and open a data file first.' },
      }));
      return false;
    }

    const resetSession = options?.resetSession ?? false;
    setPythonExecLoadingStep(stepIndex);
    setPythonCellOutputs((prev) => {
      const next: Record<number, PythonCellOutput> = resetSession
        ? { [stepIndex]: { status: 'loading' } }
        : { ...prev, [stepIndex]: { status: 'loading' } };
      if (!resetSession) {
        for (const key of Object.keys(next)) {
          if (Number(key) > stepIndex) delete next[Number(key)];
        }
      }
      return next;
    });

    const startTime = Date.now();
    try {
      const form = new FormData();
      form.append('code', code);
      form.append('source_path', filePath);
      // Read from ref so sequential cell runs always see the
      // session ID written by the previous cell, even before React state flushes.
      const currentSessionId = pythonSessionIdRef.current;
      if (currentSessionId) form.append('session_id', currentSessionId);
      form.append('reset_session', resetSession ? 'true' : 'false');
      const res = await sidecarFetch(`${SIDECAR_API}/execute_pandas`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        const detail = typeof data.detail === 'string'
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
            : data.detail
              ? String(data.detail)
              : 'Execution failed';
        throw new Error(detail);
      }
      if (data.session_id) {
        pythonSessionIdRef.current = data.session_id;
      }
      setPythonCellOutputs((prev) => ({
        ...prev,
        [stepIndex]: {
          status: 'success',
          result: data.result,
          variables: data.variables ?? undefined,
          stdout: typeof data.stdout === 'string' ? data.stdout : undefined,
          time: (Date.now() - startTime) / 1000,
        },
      }));
      return true;
    } catch (err: any) {
      setPythonCellOutputs((prev) => ({
        ...prev,
        [stepIndex]: {
          status: 'error',
          error: err.message || 'An unexpected error occurred',
        },
      }));
      return false;
    } finally {
      setPythonExecLoadingStep(null);
    }
  };

  const invalidatePythonOutputsFrom = (fromIndex: number) => {
    setPythonCellOutputs((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (Number(key) >= fromIndex) delete next[Number(key)];
      }
      return next;
    });
  };

  const handleRunPythonFrom = async (
    cellCodes: string[],
    fromIndex: number,
  ): Promise<boolean> => {
    for (let i = fromIndex; i < cellCodes.length; i++) {
      const snippet = cellCodes[i]?.trim();
      if (!snippet) continue;
      const ok = await handleRunPython(snippet, i, { resetSession: i === 0 });
      if (!ok) return false;
    }
    return true;
  };

  const handleRunAllPythonCells = async (cellCodes: string[]): Promise<boolean> => {
    return handleRunPythonFrom(cellCodes, 0);
  };


  // ── Fetch column metadata from sidecar ───────────────────────────────────
  const fetchMetadata = async (signal: AbortSignal): Promise<Record<string, any>> => {
    try {
      const res = await fetch(
        `${SIDECAR_API}/data_summary?source_path=${encodeURIComponent(filePath)}`,
        { signal }
      );
      const data = await res.json();
      if (data.status === 'success' && data.summary) {
        const active = workbookCatalog ? activeTable(workbookCatalog) : undefined;
        const totalRows =
          data.summary.total_rows ??
          data.summary.total_rows_read ??
          active?.row_count ??
          null;
        if (typeof totalRows === 'number') setDatasetRowCount(totalRows);
        const workbook = buildCloudWorkbookMetadata(workbookCatalog);
        return {
          available_columns: data.summary.available_columns ?? [],
          column_semantics: data.summary.column_semantics ?? {},
          total_rows: totalRows,
          total_rows_read: data.summary.total_rows_read,
          ...(workbookCatalog?.source_kind
            ? { source_kind: workbookCatalog.source_kind }
            : {}),
          ...(workbook ? { workbook } : {}),
        };
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
    }
    return {};
  };

  // ── Ensure a session exists (lazily created) ──────────────────────────────
  const ensureSession = async (
    metadata: Record<string, any>,
    signal: AbortSignal
  ): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await fetch(`${CLOUD_API}/api/v1/conversation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cloudAuthHeaders(apiKey) },
      body: JSON.stringify({ metadata }),
      signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create session');
    setSessionId(data.session_id);
    return data.session_id;
  };

  // ── Poll task status until done ───────────────────────────────────────────
  const pollTaskStatus = async (taskId: string, signal: AbortSignal): Promise<any> => {
    for (let attempt = 0; attempt < 80; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const statusRes = await fetch(
        `${CLOUD_API}/api/v1/get_task_status/${taskId}`,
        { headers: cloudAuthHeaders(apiKey), signal }
      );
      const statusData = await statusRes.json();
      if (!statusRes.ok) {
        throw new Error(statusData.detail || `Could not check generation status (${statusRes.status})`);
      }

      persistLocalUsageFromTaskPoll(taskId, statusData);

      const done = statusData.dag_status === 'success' || statusData.status === 'success';
      const failed = statusData.dag_status === 'failed' || statusData.status === 'failed';
      const cancelled = statusData.dag_status === 'cancelled' || statusData.status === 'cancelled';

      if (done) return statusData;
      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      // Return with a marker instead of throwing so callers can still use pandas_code
      if (failed) return { ...statusData, _compilationFailed: true };

      setGenerationStep(generationStepLabelFromDagStatus(statusData.dag_status));
    }

    // Polling timed out — fetch the latest server state one final time.
    // If any artifact is available (pandas_code or graph), return it as a failed result
    // rather than discarding the work done so far.
    try {
      const finalRes = await fetch(
        `${CLOUD_API}/api/v1/get_task_status/${taskId}`,
        { headers: cloudAuthHeaders(apiKey), signal }
      );
      const finalData = await finalRes.json();
      persistLocalUsageFromTaskPoll(taskId, finalData);
      const hasPandasCode = !!(finalData.pandas_code ?? finalData.python_code);
      const hasGraph = isRawDag(finalData.graph);
      if (hasPandasCode || hasGraph) {
        return {
          ...finalData,
          _compilationFailed: true,
          last_compiler_error: finalData.last_compiler_error || 'The DAG could not be fully compiled',
        };
      }
    } catch {
      // ignore — fall through to the generic error
    }

    return {
      _compilationFailed: true,
      last_compiler_error: 'The DAG could not be generated. Please try rephrasing your question.',
    };
  };

  // ── Execute DAG via local sidecar ─────────────────────────────────────────
  const executeDAGLocally = async (
    dagGraph: any,
    signal: AbortSignal,
    options?: { fullExport?: boolean },
  ): Promise<{
    result: any;
    time: number | null;
    resultTotalRows: number | null;
    resultTruncated: boolean;
  }> => {
    const execRes = await fetch(
      `${SIDECAR_API}/execute_dag?engine=pandas&source_path=${encodeURIComponent(filePath)}&full_export=${options?.fullExport ? 'true' : 'false'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dagGraph),
        signal,
      }
    );
    const execData = await execRes.json();
    if (execData.status !== 'success') throw new Error(execData.detail || 'Execution failed');
    return {
      result: execData.result,
      time: execData.execution_time ?? (execData.time_ms ? execData.time_ms / 1000 : null),
      resultTotalRows: typeof execData.result_total_rows === 'number' ? execData.result_total_rows : null,
      resultTruncated: execData.result_truncated === true,
    };
  };

  // ── Add a message to the conversation thread ──────────────────────────────
  const addConversationMsg = (msg: ConversationMsg, targetThreadId = activeThreadIdRef.current) => {
    const next = { ...msg, id: msg.id ?? crypto.randomUUID() };
    if (targetThreadId) {
      setQueryThreads((prev) => {
        const index = prev.findIndex((thread) => thread.id === targetThreadId);
        if (index === -1) return prev;
        const threads = [...prev];
        const thread = threads[index];
        threads[index] = {
          ...thread,
          conversationMessages: [...thread.conversationMessages, next],
          title: thread.titleEdited
            ? thread.title
            : threadTitleFromMessages([...thread.conversationMessages, next], thread.title),
          updatedAt: Date.now(),
        };
        persistThreadsForFile(threadStoragePath, threads);
        return threads;
      });
    }
    if (targetThreadId === activeThreadIdRef.current) {
      setConversationMessages((prev) => [...prev, next]);
    }
    return next.id;
  };

  const storedArtifactCount = conversationMessages.filter((message) => !!message.artifact).length;
  const conversationLimitReached = storedArtifactCount >= MAX_STORED_ARTIFACTS;

  // ── Notify server of local execution result ───────────────────────────────
  const notifyExecutionResult = async (
    sid: string,
    dag: any,
    execResult: any | null,
    execError: string | null,
    pandasCode?: string | null,
  ): Promise<{ status?: string; task_id?: string } | null> => {
    try {
      const res = await fetch(`${CLOUD_API}/api/v1/conversation/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cloudAuthHeaders(apiKey) },
        body: JSON.stringify({
          session_id: sid,
          dag,
          exec_result: execResult,
          exec_error: execError,
          ...(pandasCode ? { pandas_code: pandasCode } : {}),
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // ── Execute Pandas code via local sidecar, updating cell outputs ──────────
  const executePandasLocally = async (
    pandasCode: string,
    signal: AbortSignal,
    options?: { silent?: boolean; fullExport?: boolean },
  ): Promise<{
    result: any;
    time: number | null;
    warnings: string[];
    resultTotalRows: number | null;
    resultTruncated: boolean;
  }> => {
    const silent = options?.silent ?? false;
    const sectionCodes = parsePandasSectionCodes(pandasCode);
    const lastExecutableIndex = sectionCodes.reduce(
      (last, section, index) => section.trim() ? index : last,
      -1,
    );
    let sessionId: string | null = null;
    let lastResult: any = null;
    let resultTotalRows: number | null = null;
    let resultTruncated = false;
    let totalTime = 0;
    const warnings: string[] = [];

    if (!silent) {
      setPythonCellOutputs({});
      pythonSessionIdRef.current = null;
    }

    for (let i = 0; i < sectionCodes.length; i++) {
      const code = sectionCodes[i].trim();
      if (!code) continue;

      if (!silent) {
        setPythonCellOutputs(prev => ({ ...prev, [i]: { status: 'loading' } }));
        setPythonExecLoadingStep(i);
      }

      const startTime = Date.now();
      try {
        const form = new FormData();
        form.append('code', code);
        form.append('source_path', filePath);
        if (sessionId) form.append('session_id', sessionId);
        form.append('reset_session', i === 0 ? 'true' : 'false');
        form.append(
          'full_export',
          options?.fullExport && i === lastExecutableIndex ? 'true' : 'false',
        );

      const res = await sidecarFetch(`${SIDECAR_API}/execute_pandas`, {
          method: 'POST',
          body: form,
          signal,
        });
        const data = await res.json();

        if (!res.ok || data.status !== 'success') {
          const detail = typeof data.detail === 'string' ? data.detail : 'Execution failed';
          if (!silent) {
            setPythonCellOutputs(prev => ({ ...prev, [i]: { status: 'error', error: detail } }));
            setPythonExecLoadingStep(null);
          }
          throw new Error(detail);
        }

        if (data.session_id) {
          sessionId = data.session_id;
          if (!silent) pythonSessionIdRef.current = data.session_id;
        }

        if (Array.isArray(data.warnings)) {
          for (const w of data.warnings) {
            const msg = typeof w === 'string' ? w : w?.message;
            if (msg) warnings.push(String(msg));
          }
        }

        const cellTime = (Date.now() - startTime) / 1000;
        totalTime += cellTime;
        lastResult = data.result;
        resultTotalRows = typeof data.result_total_rows === 'number' ? data.result_total_rows : null;
        resultTruncated = data.result_truncated === true;

        if (!silent) {
          setPythonCellOutputs(prev => ({
            ...prev,
            [i]: {
              status: 'success',
              result: data.result,
              variables: data.variables ?? undefined,
              stdout: typeof data.stdout === 'string' ? data.stdout : undefined,
              time: cellTime,
            },
          }));
        }
      } catch (err: any) {
        if (!silent) setPythonExecLoadingStep(null);
        throw err;
      }
    }

    if (!silent) setPythonExecLoadingStep(null);
    return { result: lastResult, time: totalTime, warnings, resultTotalRows, resultTruncated };
  };

  const selectConversationArtifact = useCallback(async (message: ConversationMsg) => {
    const artifact = message.artifact;
    if (!artifact) return;
    resetDagExecution();
    resetPythonExecution();
    const dagSnapshot = snapshotConversationArtifact(artifact).dagData;
    setDagData(dagSnapshot);
    setDagName(artifact.dagName);
    setPythonCode(artifact.pythonCode);
    setDagMode(dagSnapshot ? 'dag' : 'code');
    setHighlightNodeId(null);
    setHighlightCellIndex(null);
    setActiveArtifactMessageId(message.id ?? null);
    if (artifact.visualizationSpec) setDagMode('dashboard');
    if (artifact.pythonCode && filePath) {
      try {
        await executePandasLocally(artifact.pythonCode, new AbortController().signal);
      } catch {
        // Code remains visible even if re-execution fails.
      }
    }
  }, [filePath, resetDagExecution, resetPythonExecution]);

  const pushAssistantAnswer = (
    answer: AnswerPayload,
    artifact?: ConversationMsg["artifact"],
    questionMessageId?: string | null,
    usage?: QueryUsage | null,
    turnTimestamp: number = Date.now(),
    targetThreadId?: string | null,
  ): string => {
    const assistantId = addConversationMsg({
      role: 'assistant',
      content: answerToPlainText(answer),
      type: answer.outcome === 'couldnt_compute' ? 'error' : 'generation',
      timestamp: turnTimestamp,
      answer,
      artifact: artifact ? snapshotConversationArtifact(artifact) : undefined,
      questionMessageId: questionMessageId ?? undefined,
      usage: usage ?? undefined,
    }, targetThreadId);
    if (artifact) setActiveArtifactMessageId(assistantId);
    return assistantId;
  };

  const enhanceAnswerWithSynthesis = async (
    answer: AnswerPayload,
    question: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<AnswerPayload> => {
    if (answer.outcome === 'couldnt_compute') return answer;
    const crossCheckPending = !!answer.crossCheckPending;
    try {
      const computedAnswer =
        answer.synthesisResultSummary?.trim()
        ?? (answer.resultItems ?? []).join('\n');
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort);
      const timer = window.setTimeout(() => controller.abort(), 12_000);
      const effectiveModelId = resolveThreadLlmModelId(llmModelId, llmModels);
      const res = await fetch(`${CLOUD_API}/api/v1/conversation/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cloudAuthHeaders(apiKey) },
        body: JSON.stringify({
          session_id: sessionId,
          question,
          result_summary: computedAnswer,
          outcome: answer.outcome,
          recipe_labels: answer.recipe?.map((s) => s.label) ?? [],
          assumptions: answer.assumptions ?? [],
          dag_result_summary: answer.dagSynthesisResultSummary ?? null,
          cross_check_requested: crossCheckPending,
          ...(effectiveModelId ? { model: effectiveModelId } : {}),
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (!res.ok) {
        return crossCheckPending
          ? applySynthesisCrossCheck(answer, { cross_check_agree: null })
          : answer;
      }
      const data = await res.json();
      const narrative = data?.narrative;
      if (!narrative || typeof narrative !== 'object') {
        return crossCheckPending
          ? applySynthesisCrossCheck(answer, { cross_check_agree: null })
          : answer;
      }
      let next: AnswerPayload = crossCheckPending
        ? applySynthesisCrossCheck(answer, narrative)
        : { ...answer };
      if (
        computedAnswer.trim()
        && typeof narrative.answer_headline === 'string'
        && narrative.answer_headline.trim()
      ) {
        next.headline = narrative.answer_headline.trim();
      }
      if (typeof narrative.useful_for === 'string' && narrative.useful_for.trim()) {
        next.usefulFor = narrative.useful_for.trim();
      }
      if (typeof narrative.caveat === 'string' && narrative.caveat.trim()) {
        next.caveats = [...(next.caveats ?? []), narrative.caveat.trim()];
      }
      next.copyText = buildAnswerCopyText(next);
      return next;
    } catch {
      return crossCheckPending
        ? applySynthesisCrossCheck(answer, { cross_check_agree: null })
        : answer;
    }
  };

  // ── Core: run through conversation pipeline after getting a task_id ───────
  const runGenerationPipeline = async (
    taskId: string,
    questionLabel: string,
    sid: string,
    signal: AbortSignal,
    questionMessageId?: string | null,
    artifactKind: 'analysis' | 'visualization' | 'transformation' = 'analysis',
    ownerThreadId: string | null = activeThreadIdRef.current,
  ) => {
    try {
    setGenerationStep(generationStepLabelFromDagStatus('queued'));
    const dagResult = await pollTaskStatus(taskId, signal);
    persistLocalUsageFromTaskPoll(taskId, dagResult);
    const queryUsage = usageForTaskId(taskId);
    setUsageRevision((n) => n + 1);

    const attachUsageToTurn = (assistantMessageId: string, turnTimestamp: number) => {
      const linked =
        attachLocalUsageToMessage(taskId, assistantMessageId, turnTimestamp) ?? queryUsage;
      if (linked) {
        setConversationMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? { ...m, usage: linked } : m)),
        );
      }
      setUsageRevision((n) => n + 1);
      return linked;
    };

    const compilationFailed = !!dagResult._compilationFailed;
    const compilationError: string | null = compilationFailed
      ? (dagResult.last_compiler_error || dagResult.detail || 'DAG compilation failed on the server')
      : null;
    const pandasGenerationFailed = compilationFailed && !!dagResult.last_pandas_error;

    const resolvedPythonCode: string | undefined =
      dagResult.pandas_code ?? dagResult.python_code ?? undefined;
    const visualizationSpec = dagResult.visualization_spec ?? undefined;
    const canvasManifest = parseCanvasManifestFromPoll(dagResult);
    setCanvasManifest(canvasManifest);
    const dagArtifactSlot = slotForKind(canvasManifest, 'dag');
    const dagArtifactFailed = dagArtifactSlot?.status === 'failed';
    const dagArtifactFailureReason = dagArtifactSlot?.reason ?? null;

    // If compilation failed and there is no pandas code or valid graph to fall back to, show error and stop
    if (compilationFailed && !resolvedPythonCode && !isRawDag(dagResult.graph)) {
      const answer = composeAnswer({
        question: questionLabel,
        dagValue: null,
        dagError: compilationError,
        pandasValue: null,
        pandasError: 'No executable code was produced',
        hasPandasCode: false,
        hasValidGraph: false,
        compilationFailed: true,
        compilationError,
        dag: null,
        pandasCode: null,
        clarifications: pendingClarifications,
        rowCount: datasetRowCount,
      });
      const turnTs = Date.now();
      const assistantId = pushAssistantAnswer(
        answer,
        undefined,
        questionMessageId,
        queryUsage,
        turnTs,
        ownerThreadId,
      );
      attachUsageToTurn(assistantId, turnTs);
      return;
    }

    // Load into editor. Pandas-only success (compile_dag disabled) has no graph.
    const hasValidGraph = isRawDag(dagResult.graph);
    setGenerationStep(hasValidGraph ? 'Loading DAG…' : 'Loading code…');

    if (hasValidGraph && ownerThreadId === activeThreadIdRef.current) {
      const dagFile: AppDAGFile = {
        name: questionLabel,
        version: '1',
        dag: dagResult.graph,
        ...(resolvedPythonCode ? { python_code: resolvedPythonCode } : {}),
      };
      loadDagFromParsed(dagFile, null);
    } else if (resolvedPythonCode && ownerThreadId === activeThreadIdRef.current) {
      resetDagExecution();
      resetPythonExecution();
      setDagData(null);
      setDagName(questionLabel);
      setPythonCode(resolvedPythonCode);
    }

    setGenerationStep('Executing…');

    let dagValue: any = null;
    let dagResultTotalRows: number | null = null;
    let dagError: string | null = compilationFailed ? compilationError : null;
    let pandasValue: any = null;
    let pandasResultTotalRows: number | null = null;
    let pandasError: string | null = null;
    let pandasWarnings: string[] = [];

    if (!compilationFailed && hasValidGraph) {
      try {
        const { result, resultTotalRows } = await executeDAGLocally(dagResult.graph, signal);
        dagValue = result;
        dagResultTotalRows = resultTotalRows;
      } catch (execErr: any) {
        dagError = execErr.message || 'Execution failed';
      }
    }

    if (resolvedPythonCode && !pandasGenerationFailed) {
      try {
        const { result, warnings, resultTotalRows } = await executePandasLocally(resolvedPythonCode, signal, {
          silent: ownerThreadId !== activeThreadIdRef.current,
        });
        pandasValue = result;
        pandasResultTotalRows = resultTotalRows;
        pandasWarnings = warnings;
      } catch (execErr: any) {
        pandasError = (execErr as any).message || 'Execution failed';
      }
    }

    if (pandasError && resolvedPythonCode) {
      setGenerationStep('Repairing generated code…');
      const repair = await notifyExecutionResult(
        sid,
        dagResult.graph ?? null,
        dagValue,
        pandasError,
        resolvedPythonCode,
      );
      if (repair?.status === 'repairing' && repair.task_id) {
        activeTaskIdRef.current = repair.task_id;
        await runGenerationPipeline(
          repair.task_id,
          questionLabel,
          sid,
          signal,
          questionMessageId,
          artifactKind,
          ownerThreadId,
        );
        return;
      }
    }

    if (resolvedPythonCode && ownerThreadId === activeThreadIdRef.current) {
      // Code steps drive the answer; open the graph first when it exists but failed verification.
      setDagMode(hasValidGraph && !!dagError ? 'dag' : 'code');
    }

    let answer = composeAnswer({
      question: questionLabel,
      dagValue,
      dagError,
      pandasValue,
      pandasError,
      hasPandasCode: !!resolvedPythonCode,
      hasValidGraph,
      compilationFailed,
      compilationError,
      dag: hasValidGraph ? dagResult.graph : null,
      pandasCode: resolvedPythonCode ?? null,
      clarifications: pendingClarifications,
      rowCount: datasetRowCount,
      resultRowCount: !pandasError && resolvedPythonCode
        ? pandasResultTotalRows
        : dagResultTotalRows,
      pandasWarnings,
      pandasExecuted: !!(resolvedPythonCode && !pandasGenerationFailed),
      dagExecuted: !compilationFailed && hasValidGraph,
      computationGraphRequested: compileDag,
      dagArtifactFailed,
      dagArtifactFailureReason,
    });

    setGenerationStep('Framing answer…');
    answer = await enhanceAnswerWithSynthesis(answer, questionLabel, sid, signal);
    const turnTs = Date.now();
    const artifact = hasValidGraph || !!resolvedPythonCode
      ? {
          dagData: hasValidGraph ? dagResult.graph : null,
          dagName: questionLabel,
          pythonCode: resolvedPythonCode ?? null,
          query: questionLabel,
          kind: visualizationSpec ? 'visualization' as const : artifactKind,
          resultPreview: visualizationSpec ? (pandasValue ?? dagValue) : undefined,
          visualizationSpec,
        }
      : undefined;
    const assistantId = pushAssistantAnswer(
      answer,
      artifact,
      questionMessageId,
      queryUsage,
      turnTs,
      ownerThreadId,
    );
    attachUsageToTurn(assistantId, turnTs);
    if (
      visualizationSpec
      && ownerThreadId === activeThreadIdRef.current
    ) {
      setDagMode('dashboard');
    }
    setPendingClarifications(null);

    await notifyExecutionResult(sid, dagResult.graph ?? null, dagValue ?? pandasValue, dagError ?? pandasError, resolvedPythonCode);
    } finally {
      if (apiKey) {
        void refreshApiKeyStatus(apiKey, { silent: true });
      }
    }
  };

  const handleCancelQuery = useCallback(async () => {
    const controller = queryAbortRef.current;
    if (!controller) return;

    const taskId = activeTaskIdRef.current;
    queryAbortRef.current = null;
    activeTaskIdRef.current = null;
    controller.abort();
    setGenerationStep('Stopping…');

    if (taskId) {
      try {
        await fetch(`${CLOUD_API}/api/v1/cancel_task/${taskId}`, {
          method: 'POST',
          headers: cloudAuthHeaders(apiKey),
        });
      } catch {
        // The local abort still stops polling and result application.
      }
    }

    addConversationMsg({
      role: 'assistant',
      content: 'Generation stopped.',
      type: 'text',
      timestamp: Date.now(),
    });
  }, [apiKey]);

  // ── Send a message to the conversation endpoint ───────────────────────────
  const handleSendMessage = async (
    message: string,
    clarifications?: { term: string; chosen_interpretation: string }[],
    existingQuestionMessageId?: string | null,
  ) => {
    if (!message.trim() && !clarifications?.length) return;
    if (conversationLimitReached) return;
    const ownerThreadId = activeThreadIdRef.current;

    if (!filePath) {
      const content = "No file selected. Go to the Home tab and open a data file first.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    if (!apiKey) {
      const content = "No API key configured. Go to Settings and paste your nolainquery API key.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    if (!activeLlmCredential()) {
      const content = "No OpenRouter key configured. Go to Settings, paste your OpenRouter key, and save inference settings.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    const health = await refreshServiceHealth();
    if (!health.engineOk) {
      const content = "The local data engine is unreachable. Restart the app, then try again.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    if (!health.cloudOk) {
      const content = "The cloud API is unreachable. Check that the server is running, then try again.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    if (!health.runtimeOk) {
      const content = "The cloud API is online, but Redis or the generation worker is unavailable. Start the cloud development stack, then try again.";
      addConversationMsg({ role: 'assistant', content, type: 'error', timestamp: Date.now() });
      return;
    }
    if (queryInFlightRef.current) return;

    const featureBlock = blockedByFeatureSettings(message.trim());
    if (featureBlock && !clarifications?.length) {
      addConversationMsg({ role: 'assistant', content: featureBlock, type: 'error', timestamp: Date.now() });
      return;
    }

    const abort = new AbortController();
    queryAbortRef.current = abort;
    activeTaskIdRef.current = null;
    queryInFlightRef.current = true;
    setLoading(true);
    setClarificationConcepts(null);
    setHighlightNodeId(null);
    setHighlightCellIndex(null);

    if (clarifications?.length) {
      setPendingClarifications(clarifications);
    }

    // Add user message to conversation thread and clear the input box
    const questionMessageId = existingQuestionMessageId ?? (
      !clarifications?.length ? crypto.randomUUID() : null
    );
    if (!clarifications?.length) {
      addConversationMsg({
        id: questionMessageId ?? undefined,
        role: 'user',
        content: message.trim(),
        type: 'text',
        timestamp: Date.now(),
      }, ownerThreadId);
      setQuery('');
    }

    try {
      setGenerationStep('Analyzing data…');
      const metadata = await fetchMetadata(abort.signal);
      if (!metadata.available_columns?.length && engineStatus !== 'ok') {
        throw new Error('Could not read dataset columns from the local data engine.');
      }

      const sid = await ensureSession(metadata, abort.signal);

      setGenerationStep('Thinking…');
      const featureSettings = loadFeatureSettings();
      const effectiveModelId = resolveThreadLlmModelId(llmModelId, llmModels);
      const messageBody: Record<string, unknown> = {
        session_id: sid,
        message: message.trim(),
        metadata,
        clarifications: clarifications ?? null,
        compile_dag: compileDag,
        include_visualization: includeVisualization,
      };
      if (effectiveModelId) {
        messageBody.model = effectiveModelId;
      }
      if (featureSettings.planId) {
        messageBody.plan_id = featureSettings.planId;
      }
      const msgRes = await fetch(`${CLOUD_API}/api/v1/conversation/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cloudAuthHeaders(apiKey) },
        body: JSON.stringify(messageBody),
        signal: abort.signal,
      });
      const msgData = await msgRes.json();
      if (!msgRes.ok) {
        const detail = typeof msgData.detail === 'string'
          ? msgData.detail
          : Array.isArray(msgData.detail)
            ? msgData.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
            : msgData.detail
              ? String(msgData.detail)
              : 'Request failed';
        throw new Error(detail);
      }

      if (msgData.type === 'text_response' || msgData.type === 'meta_answer') {
        addConversationMsg({
          role: 'assistant',
          content: msgData.content,
          type: 'text',
          timestamp: Date.now(),
        }, ownerThreadId);

      } else if (msgData.type === 'clarification') {
        setPendingQuery(message.trim());
        setPendingQueryMessageId(questionMessageId);
        setClarificationConcepts(msgData.concepts ?? []);
        addConversationMsg({
          role: 'assistant',
          content: 'clarification_request',
          type: 'clarification',
          timestamp: Date.now(),
        }, ownerThreadId);

      } else if (msgData.type === 'generation') {
        activeTaskIdRef.current = msgData.task_id;
        const vizRequested = includeVisualization;
        if (ownerThreadId === activeThreadIdRef.current) {
          setIncludeVisualizationRequested(vizRequested);
        }
        await runGenerationPipeline(
          msgData.task_id,
          message.trim(),
          sid,
          abort.signal,
          questionMessageId,
          vizRequested ? 'visualization' : 'analysis',
          ownerThreadId,
        );

      } else {
        throw new Error('Unexpected response type from conversation API');
      }

    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const errMsg = translateError(err.message || 'An unexpected error occurred');
      addConversationMsg({
        role: 'assistant',
        content: errMsg,
        type: 'error',
        timestamp: Date.now(),
      }, ownerThreadId);
    } finally {
      if (queryAbortRef.current === abort) queryAbortRef.current = null;
      activeTaskIdRef.current = null;
      queryInFlightRef.current = false;
      setLoading(false);
      setGenerationStep(null);
    }
  };

  // ── Called when user submits clarification choices ────────────────────────
  const handleClarify = async (choices: { term: string; chosen_interpretation: string }[]) => {
    const q = pendingQuery ?? query.trim();
    const questionMessageId = pendingQueryMessageId;
    setClarificationConcepts(null);
    setPendingQuery(null);
    setPendingQueryMessageId(null);
    await handleSendMessage(q, choices, questionMessageId);
  };

  const handleFollowStep = useCallback((message: ConversationMsg, step: { nodeId?: string; cellIndex?: number; source: 'dag' | 'code' }) => {
    const artifact = message.artifact;
    if (artifact && message.id !== activeArtifactMessageId) {
      const dagSnapshot = snapshotConversationArtifact(artifact).dagData;
      resetDagExecution();
      resetPythonExecution();
      setDagData(dagSnapshot);
      setDagName(artifact.dagName);
      setPythonCode(artifact.pythonCode);
      setActiveArtifactMessageId(message.id ?? null);
    }

    if (step.source === 'code' || typeof step.cellIndex === 'number') {
      setDagMode('code');
      setHighlightCellIndex(typeof step.cellIndex === 'number' ? step.cellIndex : 0);
      setHighlightNodeId(null);
      return;
    }
    if (step.nodeId) {
      setDagMode('dag');
      setHighlightNodeId(step.nodeId);
      setHighlightCellIndex(null);
    }
  }, [activeArtifactMessageId, resetDagExecution, resetPythonExecution]);

  const handleDownloadFullCsv = useCallback(async (
    message: ConversationMsg,
  ): Promise<'saved' | 'failed' | 'cancelled' | 'no-data' | 'no-file'> => {
    const artifact = message.artifact;
    if (!artifact) return 'no-data';
    if (!filePath) return 'no-file';

    try {
      if (artifact.kind === 'transformation') {
        if (!artifact.pythonCode) return 'no-data';
        const sourceExtension = filePath.split('.').pop()?.toLowerCase() || 'csv';
        const supportedExtension = ['csv', 'parquet', 'xlsx', 'xls'].includes(sourceExtension)
          ? sourceExtension
          : 'csv';
        const defaultName = `${(artifact.dagName || 'transformed-data')
          .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'transformed-data'}.${supportedExtension}`;
        const savePath = await save({
          filters: [{
            name: `${supportedExtension.toUpperCase()} Files`,
            extensions: [supportedExtension],
          }],
          defaultPath: defaultName,
        });
        if (!savePath) return 'cancelled';
        const response = await sidecarFetch(`${SIDECAR_API}/export_transformation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: artifact.pythonCode,
            source_path: filePath,
            destination_path: savePath,
          }),
        });
        if (!response.ok) return 'failed';
        return 'saved';
      }
      const controller = new AbortController();
      const result = artifact.pythonCode
        ? (await executePandasLocally(
            artifact.pythonCode,
            controller.signal,
            { silent: true, fullExport: true },
          )).result
        : artifact.dagData
          ? (await executeDAGLocally(
              artifact.dagData,
              controller.signal,
              { fullExport: true },
            )).result
          : null;
      const csv = resultToCsv(result);
      if (!csv) return 'no-data';

      const defaultName = `${(artifact.dagName || 'query-result').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'query-result'}.csv`;
      const savePath = await save({
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        defaultPath: defaultName,
      });
      if (!savePath) return 'cancelled';
      await writeTextFile(savePath, csv);
      return 'saved';
    } catch {
      return 'failed';
    }
  }, [filePath]);

  // ── Legacy alias so existing call-sites keep working ─────────────────────
  const handleExecute = (question = query) => handleSendMessage(question);

  const handleFileSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "Data Files",
          extensions: ["xlsx", "xls", "csv", "parquet"],
        }],
      });
      if (selected && typeof selected === "string") {
        await openDatasetFromPath(selected);
      }
    } catch (err) {
      console.error("Failed to open file dialog", err);
    }
  };

  const handleSelectWorkbookTable = async (tableId: string) => {
    if (!workbookCatalog || tableId === workbookCatalog.active_table_id) return;
    await openDatasetFromPath(workbookCatalog.source_path, { activeTableId: tableId });
  };

  const handleForceIncludeSheet = async (sheetName: string) => {
    if (!workbookCatalog) return;
    await openDatasetFromPath(workbookCatalog.source_path, {
      forceIncludeSheets: [sheetName],
      activeSheetName: sheetName,
    });
  };

  const handleAskAboutData = () => {
    setQuery("What are the most important patterns in this dataset?");
    setMainView("query");
  };

  const handleExploreData = () => {
    setMainView("dashboard");
  };

  const handleSelectRecentFile = (path: string) => {
    void openDatasetFromPath(path);
  };

  const handleNewQuery = () => {
    const newThread = createEmptyThread();
    setQueryThreads((prev) => {
      const next = [newThread, ...prev].slice(0, 30);
      persistThreadsForFile(threadStoragePath, next);
      return next;
    });
    setActiveThreadId(newThread.id);
    resetQueryWorkspace();
    setShowAllThreads(false);
    setRenamingThreadId(null);
    setMainView("query");
  };

  const handleSwitchQueryThread = (threadId: string) => {
    if (threadId === activeThreadId) return;
    const thread = queryThreads.find((t) => t.id === threadId);
    if (!thread) return;
    setActiveThreadId(threadId);
    applyThreadToWorkspace(thread);
    setRenamingThreadId(null);
    setMainView("query");
  };

  const handleStartRenameThread = (thread: QueryThread) => {
    setRenamingThreadId(thread.id);
    setRenameDraft(thread.title);
  };

  const handleCancelRenameThread = () => {
    setRenamingThreadId(null);
    setRenameDraft("");
  };

  const handleCommitRenameThread = (threadId: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      handleCancelRenameThread();
      return;
    }
    setQueryThreads((prev) => {
      const next = prev.map((t) =>
        t.id === threadId ? { ...t, title: trimmed, titleEdited: true } : t,
      );
      persistThreadsForFile(threadStoragePath, next);
      return next;
    });
    handleCancelRenameThread();
  };

  const handleDeleteQueryThread = (threadId: string) => {
    if (renamingThreadId === threadId) {
      handleCancelRenameThread();
    }

    const remaining = queryThreads.filter((t) => t.id !== threadId);
    if (remaining.length === 0) {
      const empty = createEmptyThread();
      persistThreadsForFile(threadStoragePath, [empty]);
      setQueryThreads([empty]);
      setActiveThreadId(empty.id);
      resetQueryWorkspace();
      return;
    }

    persistThreadsForFile(threadStoragePath, remaining);
    setQueryThreads(remaining);

    if (threadId === activeThreadId) {
      const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
      setActiveThreadId(sorted[0].id);
      applyThreadToWorkspace(sorted[0]);
    }
  };

  const sortedQueryThreads = [...queryThreads].sort((a, b) => b.updatedAt - a.updatedAt);
  const hasHiddenThreads = sortedQueryThreads.length > DEFAULT_VISIBLE_THREADS;
  const visibleQueryThreads = showAllThreads
    ? sortedQueryThreads
    : sortedQueryThreads.slice(0, DEFAULT_VISIBLE_THREADS);
  const activeConversationArtifact = (
    conversationMessages.find((message) => message.id === activeArtifactMessageId)?.artifact
    ?? [...conversationMessages]
      .reverse()
      .find((message) => message.artifact)?.artifact
  );

  const availablePins = useMemo(() => {
    const entries: Array<{
      id: string;
      threadId: string;
      label: string;
      artifact: NonNullable<ConversationMsg["artifact"]>;
      kinds: PinnedArtifactKind[];
    }> = [];

    queryThreads.forEach((thread) => {
      thread.conversationMessages.forEach((message) => {
        if (!message.artifact || !message.id) return;
        const kinds = (["dag", "code", "dashboard"] as const).filter((kind) =>
          canPinKind(kind, message.artifact),
        );
        if (kinds.length === 0) return;
        const query = message.artifact.query?.trim() || message.content.trim();
        entries.push({
          id: message.id,
          threadId: thread.id,
          label: query.length > 56 ? `${query.slice(0, 56)}…` : query || thread.title,
          artifact: message.artifact,
          kinds: [...kinds],
        });
      });
    });

    return entries;
  }, [queryThreads]);

  const handlePinArtifact = useCallback((
    kind: PinnedArtifactKind,
    artifact: NonNullable<ConversationMsg["artifact"]>,
    options?: {
      navigate?: boolean;
      threadId?: string;
      messageId?: string;
      title?: string;
    },
  ) => {
    setPinnedItems((prev) => [...prev, createPinnedItem(kind, artifact, prev, {
      threadId: options?.threadId,
      messageId: options?.messageId,
      title: options?.title,
    })]);
    if (options?.navigate !== false) {
      setMainView("pinned");
    }
  }, []);

  const handleOpenPinnedSource = useCallback((item: PinnedItem) => {
    if (item.threadId) {
      const thread = queryThreads.find((t) => t.id === item.threadId);
      if (thread) {
        setActiveThreadId(thread.id);
        applyThreadToWorkspace(thread);
        if (item.messageId) {
          const message = thread.conversationMessages.find((m) => m.id === item.messageId);
          if (message?.artifact) {
            void selectConversationArtifact(message);
          }
        }
        if (item.kind === "dag") setDagMode("dag");
        else if (item.kind === "code") setDagMode("code");
        else setDagMode("dashboard");
        setMainView("query");
        return;
      }
    }
    if (item.query) {
      setQuery(item.query);
      setMainView("query");
    }
  }, [queryThreads, applyThreadToWorkspace, selectConversationArtifact]);

  const handleAskAboutColumn = useCallback((column: string, tile?: { compareColumn?: string }) => {
    const question = tile?.compareColumn
      ? `How does ${column} relate to ${tile.compareColumn}? Summarize patterns, outliers, and what stands out.`
      : `Tell me about the ${column} column — distribution, outliers, missing values, and how it relates to the rest of the dataset.`;

    const newThread = createEmptyThread();
    newThread.query = question;
    newThread.title = question.length > 42 ? `${question.slice(0, 42)}…` : question;
    newThread.titleEdited = true;

    setQueryThreads((prev) => {
      const next = [newThread, ...prev].slice(0, 30);
      persistThreadsForFile(threadStoragePath, next);
      return next;
    });
    setActiveThreadId(newThread.id);
    applyThreadToWorkspace(newThread);
    setShowAllThreads(false);
    setRenamingThreadId(null);
    setMainView("query");
  }, [threadStoragePath, applyThreadToWorkspace]);

  const handlePinExploreTile = useCallback((artifact: NonNullable<ConversationMsg["artifact"]>) => {
    handlePinArtifact("dashboard", artifact, {
      navigate: true,
      title: artifact.visualizationSpec?.title,
    });
  }, [handlePinArtifact]);

  const handleCompileDagChange = useCallback((enabled: boolean) => {
    setCompileDag(enabled);
    if (!enabled && dagMode === 'dag') {
      setDagMode('code');
    }
  }, [dagMode]);

  const handleLlmModelChange = useCallback((modelId: string) => {
    setLlmModelId(modelId);
  }, []);

  const selectedLlmModelId = resolveThreadLlmModelId(llmModelId, llmModels);
  const datasetDisplayName = datasetDisplayLabel(workbookCatalog, filePath);

  const workspaceTitle = mainView === "home"
    ? "Dataset overview"
    : mainView === "dashboard"
      ? "Know your data"
      : mainView === "pinned"
        ? "Pinned"
        : mainView === "query"
          ? "Ask queries"
          : "Settings";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`app-container${mainView === "query" ? " app-container--query" : ""}`}>

      <aside className="workspace-sidebar">
        <div className="sidebar-brand">
          <img
            src="/nolain-logo-v2.svg"
            alt="Nolain Logo"
            width={208}
            height={192}
            className="sidebar-brand-logo"
          />
          <span className="brand-name sidebar-brand-name">
            <span>nolain</span>
            <span className="sidebar-brand-product">query</span>
          </span>
        </div>
        <div className="sidebar-dataset">
          <span className="sidebar-eyebrow">Active dataset</span>
          <span className={`sidebar-dataset-name${filePath ? '' : ' is-empty'}`}>
            {filePath ? datasetDisplayName : "No file selected"}
          </span>
          {filePath && datasetRowCount !== null && (
            <span className="sidebar-dataset-meta">{datasetRowCount.toLocaleString()} rows</span>
          )}
        </div>
        <nav className="sidebar-nav" aria-label="Workspace">
          <button
            className={`sidebar-nav-item ${mainView === "home" ? "active" : ""}`}
            onClick={() => setMainView("home")}
          >
            <IconHome />
            Home
          </button>
          <button
            className={`sidebar-nav-item ${mainView === "dashboard" ? "active" : ""}`}
            onClick={() => setMainView("dashboard")}
          >
            <IconData />
            Know Your Data
          </button>
          <button
            className={`sidebar-nav-item ${mainView === "pinned" ? "active" : ""}`}
            onClick={() => setMainView("pinned")}
          >
            <IconPinned />
            Pinned
          </button>
          <button
            className={`sidebar-nav-item ${mainView === "query" ? "active" : ""}`}
            onClick={() => setMainView("query")}
          >
            <IconQuery />
            Ask Queries
          </button>
        </nav>

        {mainView === "query" && (
          <div className="sidebar-query-panel" aria-label="Query conversations">
            <div className="sidebar-query-panel-header">
              <span className="sidebar-eyebrow">Recent chats</span>
              <button
                type="button"
                className="sidebar-new-query-btn"
                onClick={handleNewQuery}
              >
                New
              </button>
            </div>
            <div className="sidebar-thread-list" role="list">
              {sortedQueryThreads.length === 0 && (
                <div className="sidebar-thread-empty">Start a new query to begin.</div>
              )}
              {visibleQueryThreads.map((thread) => (
                <div
                  key={thread.id}
                  role="listitem"
                  className={`sidebar-thread-row${thread.id === activeThreadId ? " active" : ""}`}
                >
                  {renamingThreadId === thread.id ? (
                    <input
                      type="text"
                      className="sidebar-thread-rename-input"
                      value={renameDraft}
                      autoFocus
                      aria-label="Rename chat"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCommitRenameThread(thread.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleCancelRenameThread();
                        }
                      }}
                      onBlur={() => handleCommitRenameThread(thread.id)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`sidebar-thread-item${thread.id === activeThreadId ? " active" : ""}`}
                      onClick={() => handleSwitchQueryThread(thread.id)}
                    >
                      <span className="sidebar-thread-item-title">{thread.title}</span>
                      <span className="sidebar-thread-item-time">{formatThreadTime(thread.updatedAt)}</span>
                    </button>
                  )}
                  <div className="sidebar-thread-item-actions">
                    <button
                      type="button"
                      className="sidebar-thread-action-btn"
                      aria-label={`Rename ${thread.title}`}
                      onClick={() => handleStartRenameThread(thread)}
                    >
                      <IconRename />
                    </button>
                    <button
                      type="button"
                      className="sidebar-thread-action-btn sidebar-thread-action-btn--danger"
                      aria-label={`Delete ${thread.title}`}
                      onClick={() => handleDeleteQueryThread(thread.id)}
                    >
                      <IconDelete />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {hasHiddenThreads && (
              <button
                type="button"
                className="sidebar-show-more-btn"
                onClick={() => setShowAllThreads((v) => !v)}
                aria-expanded={showAllThreads}
              >
                {showAllThreads
                  ? "Show less"
                  : `Show ${sortedQueryThreads.length - DEFAULT_VISIBLE_THREADS} more`}
              </button>
            )}
          </div>
        )}

        <button
          className={`sidebar-nav-item sidebar-settings ${mainView === "settings" ? "active" : ""}`}
          onClick={() => setMainView("settings")}
        >
          <IconSettings />
          Settings
          {!apiKey && <span className="api-key-badge-missing" title="API key not set">!</span>}
        </button>
      </aside>

      <div className="workspace-shell">
        <header className="workspace-header">
          <div>
            <span className="workspace-eyebrow">Workspace</span>
            <h1>{workspaceTitle}</h1>
          </div>
          {mainView === "query" ? (
            <QueryStatusDots
              apiStatus={apiStatus}
              generationRuntimeStatus={generationRuntimeStatus}
              engineStatus={engineStatus}
            />
          ) : (
            <div className="workspace-header-context">
              {filePath ? <span>{datasetDisplayName}</span> : <span>Select a dataset to begin</span>}
              {filePath && <button className="workspace-change-file" onClick={handleFileSelect}>Change</button>}
            </div>
          )}
        </header>
        <main className={`main-content${mainView === "home" ? " main-content--home" : ""}${mainView === "query" ? " main-content--query" : ""}${mainView === "dashboard" ? " main-content--dashboard" : ""}${mainView === "pinned" ? " main-content--pinned" : ""}${mainView === "settings" ? " main-content--settings" : ""}`}>

        {/* ── Home ─────────────────────────────────────────────────────── */}
        <div className={`view-panel view-panel--home ${mainView === "home" ? "active" : ""}`}>
          <HomeView
            filePath={filePath}
            displayLabel={datasetDisplayName}
            workbookCatalog={workbookCatalog}
            recentFiles={recentFiles}
            insights={insights}
            insightsLoading={insightsLoading || workbookOpening}
            insightsError={workbookOpenError ?? insightsError}
            datasetRowCount={datasetRowCount}
            onFileSelect={handleFileSelect}
            onSelectRecentFile={handleSelectRecentFile}
            onSelectWorkbookTable={handleSelectWorkbookTable}
            onForceIncludeSheet={handleForceIncludeSheet}
            onAskAboutData={handleAskAboutData}
            onExploreData={handleExploreData}
          />
        </div>

        {/* ── Settings ─────────────────────────────────────────────────── */}
        <div className={`view-panel view-panel--block view-panel--settings ${mainView === "settings" ? "active" : ""}`}>
          <SettingsView
            apiKey={apiKey}
            apiKeyDraft={apiKeyDraft}
            onApiKeyDraftChange={setApiKeyDraft}
            apiKeyVisible={apiKeyVisible}
            onToggleApiKeyVisible={() => setApiKeyVisible((v) => !v)}
            apiKeyValidating={apiKeyValidating}
            apiKeyStatus={apiKeyStatus}
            apiKeyError={apiKeyError}
            apiKeySaved={apiKeySaved}
            onSaveApiKey={handleSaveApiKey}
            usageRevision={usageRevision}
            queryThreads={queryThreads}
          />
        </div>

        {/* ── Dashboard ──────────────────────────────────────────────────── */}
        <div
          className={`view-panel view-panel--block view-panel--dashboard ${mainView === "dashboard" ? "active" : ""}`}
        >
          <section className="dashboard-crafter-wrapper">
            <DashboardCrafter
              filePath={filePath}
              onOpenFile={handleFileSelect}
              onAskAboutColumn={handleAskAboutColumn}
              onPinTile={handlePinExploreTile}
            />
          </section>
        </div>

        {/* ── Pinned ─────────────────────────────────────────────────────── */}
        <div
          className={`view-panel view-panel--block view-panel--pinned ${mainView === "pinned" ? "active" : ""}`}
        >
          <section className="pinned-canvas-wrapper">
            <PinnedCanvas
              filePath={filePath}
              items={pinnedItems}
              onChange={setPinnedItems}
              availablePins={availablePins}
              onPin={(kind, artifact, options) => handlePinArtifact(kind, artifact, options)}
              onOpenSource={handleOpenPinnedSource}
              onAskQueries={() => setMainView("query")}
            />
          </section>
        </div>

        {/* ── DAG Editor (full-screen, renders on top when query tab active) ─── */}
        <DAGEditor
          key={activeThreadId ?? undefined}
          dag={dagData}
          dagName={dagName}
          code={pythonCode}
          mode={dagMode}
          query={query}
          setQuery={setQuery}
          onExecute={handleExecute}
          onRunDAG={handleRunDAG}
          loading={loading}
          generationStep={generationStep}
          apiStatus={apiStatus}
          generationRuntimeStatus={generationRuntimeStatus}
          onCancelQuery={handleCancelQuery}
          onOpenDAG={handleOpenDAG}
          onUpload={handleJSONUpload}
          onClearDAG={handleClearDAG}
          onModeChange={setDagMode}
          compileDag={compileDag}
          compileDagLocked={false}
          onCompileDagChange={handleCompileDagChange}
          includeVisualization={includeVisualization}
          includeVisualizationLocked
          onIncludeVisualizationChange={setIncludeVisualization}
          llmModelId={selectedLlmModelId}
          llmModels={llmModels}
          onLlmModelChange={handleLlmModelChange}
          visualizationArtifact={activeConversationArtifact ?? null}
          canvasManifest={canvasManifest}
          includeVisualizationRequested={includeVisualizationRequested}
          onExportDAG={handleExportDAG}
          onLoadExample={loadDagFromParsed}
          filePath={filePath}
          pythonCellOutputs={pythonCellOutputs}
          pythonExecLoadingStep={pythonExecLoadingStep}
          onRunPython={handleRunPython}
          onRunPythonFrom={handleRunPythonFrom}
          onRunAllPythonCells={handleRunAllPythonCells}
          onInvalidatePythonOutputsFrom={invalidatePythonOutputsFrom}
          visible={mainView === "query"}
          conversationMessages={conversationMessages}
          conversationLimitReached={conversationLimitReached}
          activeArtifactMessageId={activeArtifactMessageId}
          clarificationConcepts={clarificationConcepts}
          onClarify={handleClarify}
          onRephrase={() => {
            if (pendingQuery) {
              setQuery(pendingQuery);
            }
            setClarificationConcepts(null);
            setPendingQuery(null);
            setPendingQueryMessageId(null);
          }}
          engineStatus={engineStatus}
          highlightNodeId={highlightNodeId}
          highlightCellIndex={highlightCellIndex}
          onSelectArtifact={selectConversationArtifact}
          onFollowStep={handleFollowStep}
          onDownloadFullCsv={handleDownloadFullCsv}
          onPinArtifact={(kind, artifact) => handlePinArtifact(kind, artifact, {
            navigate: true,
            threadId: activeThreadId ?? undefined,
            messageId: activeArtifactMessageId ?? undefined,
          })}
        />

        </main>
      </div>
    </div>
  );
}

export default App;

import type {
  AmbiguousConcept,
  ConversationArtifact,
  ConversationMsg,
  DAGData,
  HistoryEntry,
} from "./DAGEditor";
import { usageForMessageId } from "./usageMetrics";

/** Deep-copy a DAG so workspace updates do not mutate saved turn artifacts. */
export function cloneDagData(dag: DAGData | null): DAGData | null {
  if (!dag) return null;
  return JSON.parse(JSON.stringify(dag)) as DAGData;
}

export function snapshotConversationArtifact(artifact: ConversationArtifact): ConversationArtifact {
  return {
    ...artifact,
    dagData: cloneDagData(artifact.dagData),
    pythonCode: artifact.pythonCode,
    visualizationSpec: artifact.visualizationSpec
      ? { ...artifact.visualizationSpec, y: [...artifact.visualizationSpec.y] }
      : undefined,
  };
}

export interface QueryThread {
  id: string;
  title: string;
  /** When true, title is not auto-updated from the first user message. */
  titleEdited?: boolean;
  sessionId: string | null;
  conversationMessages: ConversationMsg[];
  dagData: DAGData | null;
  dagName: string | null;
  pythonCode: string | null;
  dagMode: "dag" | "code" | "dashboard";
  /** When true, generation requests compile a computation graph for the Graph view. */
  compileDag: boolean;
  /** When true, generation requests a visualization_spec dashboard artifact. */
  includeVisualization: boolean;
  /** Catalog model id for OpenRouter-backed generation (null = server default). */
  llmModelId: string | null;
  query: string;
  /** Pending clarification UI state (not inferable from conversation messages alone). */
  clarificationConcepts?: AmbiguousConcept[] | null;
  pendingQuery?: string | null;
  pendingQueryMessageId?: string | null;
  createdAt: number;
  updatedAt: number;
}

const QUERY_THREADS_KEY = "nolain_query_threads";
export const MAX_THREADS = 30;
export const DEFAULT_VISIBLE_THREADS = 7;

function storageKey(filePath: string): string {
  return `${QUERY_THREADS_KEY}:${filePath || "__no_file__"}`;
}

/** Stable localStorage key: Excel workbooks share one thread list across sheets. */
export function threadStorageKey(
  filePath: string,
  workbookCatalog?: { source_path?: string } | null,
): string {
  if (workbookCatalog?.source_path) {
    return workbookCatalog.source_path;
  }
  return filePath || "__no_file__";
}

function migrateThread(thread: QueryThread): QueryThread {
  const conversationMessages = thread.conversationMessages.map((message) => {
    const withId = {
      ...message,
      id: message.id ?? crypto.randomUUID(),
    };
    if (withId.role === "assistant" && withId.id && !withId.usage) {
      const usage = usageForMessageId(withId.id);
      if (usage) return { ...withId, usage };
    }
    return withId;
  });
  const latestGeneratedMessage = [...conversationMessages]
    .reverse()
    .find((message) => message.type === "generation" || message.answer);

  // Older saved threads kept only one workspace artifact. Preserve that latest
  // artifact by associating it with its most recent generated answer.
  if (
    latestGeneratedMessage &&
    !latestGeneratedMessage.artifact &&
    (thread.dagData || thread.pythonCode)
  ) {
    latestGeneratedMessage.artifact = snapshotConversationArtifact({
      dagData: thread.dagData,
      dagName: thread.dagName,
      pythonCode: thread.pythonCode,
      query: latestGeneratedMessage.content,
    });
  }

  return {
    ...thread,
    compileDag: thread.compileDag ?? true,
    includeVisualization: thread.includeVisualization ?? true,
    llmModelId: thread.llmModelId ?? null,
    conversationMessages,
  };
}

export function loadThreadsForFile(filePath: string): QueryThread[] {
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    return raw ? (JSON.parse(raw) as QueryThread[]).map(migrateThread) : [];
  } catch {
    return [];
  }
}

export function persistThreadsForFile(filePath: string, threads: QueryThread[]): void {
  localStorage.setItem(storageKey(filePath), JSON.stringify(threads.slice(0, MAX_THREADS)));
}

export function createEmptyThread(title = "New query"): QueryThread {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    sessionId: null,
    conversationMessages: [],
    dagData: null,
    dagName: null,
    pythonCode: null,
    dagMode: "dag",
    compileDag: true,
    includeVisualization: true,
    llmModelId: null,
    query: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function threadTitleFromMessages(messages: ConversationMsg[], fallback = "New query"): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return fallback;
  const text = firstUser.content.trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export function formatThreadTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatHistoryTime(ts: number): string {
  return formatThreadTime(ts);
}

export type { HistoryEntry };

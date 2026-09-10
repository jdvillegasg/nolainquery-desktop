/**
 * Usage metrics — token counts and LLM time stored locally on the desktop.
 *
 * Canonical store: `nolain_local_usage_v1` (per turn, keyed by task + message id).
 * Query threads also carry `usage` on assistant messages when a turn completes.
 * Settings charts read merged local data; cloud is only the source at poll time.
 */

import type { ConversationMsg, QueryUsage } from "./DAGEditor";
import type { QueryThread } from "./queryThreads";

export type { QueryUsage };

export interface UsageRecord {
  id: string;
  timestamp: number;
  /** null when the turn predates token tracking. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Preferred LLM time, else wall-clock question→answer. */
  answerTimeSec: number | null;
  /** True when input or output token counts are stored for this turn. */
  hasTokenData: boolean;
  /** True when answerTimeSec came from persisted LLM timing (not wall clock). */
  usedLlmTime: boolean;
}

export type UsagePeriod = "1d" | "7d" | "30d";

export interface PeriodTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  queryCount: number;
  avgAnswerTimeSec: number | null;
}

export interface UsageSnapshot {
  lastQuery: UsageRecord | null;
  last5AvgAnswerTimeSec: number | null;
  byPeriod: Record<UsagePeriod, PeriodTotals>;
}

/** One bucket for charts (hour or day depending on period). */
export interface UsageTimeBucket {
  key: string;
  label: string;
  startMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  queryCount: number;
  avgAnswerTimeSec: number | null;
}

/** Cumulative token series for stacked area charts. */
export interface UsageCumulativeBucket {
  label: string;
  input: number;
  output: number;
  total: number;
}

const THREADS_PREFIX = "nolain_query_threads:";
const LEGACY_STORAGE_KEY = "nolain_usage_metrics";
const LOCAL_USAGE_STORAGE_KEY = "nolain_local_usage_v1";
const MAX_LOCAL_USAGE_ENTRIES = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One generation turn persisted in localStorage (desktop source of truth). */
export interface LocalUsageEntry {
  id: string;
  timestamp: number;
  taskId?: string;
  messageId?: string;
  inputTokens: number;
  outputTokens: number;
  llmTimeSec: number;
}

let localUsageMigrated = false;

function mergeQueryUsage(a: QueryUsage | null | undefined, b: QueryUsage | null | undefined): QueryUsage | null {
  if (!a && !b) return null;
  const left = a ?? { inputTokens: 0, outputTokens: 0, llmTimeSec: 0 };
  const right = b ?? { inputTokens: 0, outputTokens: 0, llmTimeSec: 0 };
  return {
    inputTokens: Math.max(left.inputTokens, right.inputTokens),
    outputTokens: Math.max(left.outputTokens, right.outputTokens),
    llmTimeSec: Math.max(left.llmTimeSec, right.llmTimeSec),
  };
}

function usageHasCounts(usage: QueryUsage | null | undefined): boolean {
  return !!usage && (usage.inputTokens > 0 || usage.outputTokens > 0);
}

function loadLocalUsageEntriesRaw(): LocalUsageEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_USAGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): LocalUsageEntry | null => {
        if (!row || typeof row.timestamp !== "number") return null;
        return {
          id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
          timestamp: row.timestamp,
          taskId: typeof row.taskId === "string" ? row.taskId : undefined,
          messageId: typeof row.messageId === "string" ? row.messageId : undefined,
          inputTokens: Number(row.inputTokens) || 0,
          outputTokens: Number(row.outputTokens) || 0,
          llmTimeSec: Number(row.llmTimeSec) || 0,
        };
      })
      .filter((row): row is LocalUsageEntry => !!row);
  } catch {
    return [];
  }
}

function saveLocalUsageEntries(entries: LocalUsageEntry[]): void {
  try {
    localStorage.setItem(
      LOCAL_USAGE_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_LOCAL_USAGE_ENTRIES)),
    );
  } catch {
    // non-fatal
  }
}

function migrateLegacyUsageIntoLocalStore(): void {
  if (localUsageMigrated) return;
  localUsageMigrated = true;
  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return;
    const parsed = JSON.parse(legacyRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const existing = loadLocalUsageEntriesRaw();
    const ids = new Set(existing.map((e) => e.id));
    for (const row of parsed) {
      if (!row || typeof row.timestamp !== "number") continue;
      const id = typeof row.id === "string" ? row.id : `legacy-${row.timestamp}`;
      if (ids.has(id)) continue;
      existing.push({
        id,
        timestamp: row.timestamp,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        llmTimeSec: Number(row.llmTimeSec) || 0,
      });
      ids.add(id);
    }
    saveLocalUsageEntries(existing.sort((a, b) => b.timestamp - a.timestamp));
  } catch {
    // ignore
  }
}

function loadLocalUsageEntries(): LocalUsageEntry[] {
  migrateLegacyUsageIntoLocalStore();
  return loadLocalUsageEntriesRaw().sort((a, b) => b.timestamp - a.timestamp);
}

interface LocalUsageIndex {
  byMessageId: Map<string, LocalUsageEntry>;
  byTaskId: Map<string, LocalUsageEntry>;
}

function buildLocalUsageIndex(): LocalUsageIndex {
  const byMessageId = new Map<string, LocalUsageEntry>();
  const byTaskId = new Map<string, LocalUsageEntry>();
  for (const entry of loadLocalUsageEntries()) {
    if (entry.messageId) {
      const prev = byMessageId.get(entry.messageId);
      byMessageId.set(entry.messageId, prev ? mergeLocalEntries(prev, entry) : entry);
    }
    if (entry.taskId) {
      const prev = byTaskId.get(entry.taskId);
      byTaskId.set(entry.taskId, prev ? mergeLocalEntries(prev, entry) : entry);
    }
  }
  return { byMessageId, byTaskId };
}

function mergeLocalEntries(a: LocalUsageEntry, b: LocalUsageEntry): LocalUsageEntry {
  return {
    id: a.id,
    timestamp: a.timestamp || b.timestamp,
    taskId: a.taskId ?? b.taskId,
    messageId: a.messageId ?? b.messageId,
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    llmTimeSec: Math.max(a.llmTimeSec, b.llmTimeSec),
  };
}

function upsertLocalUsageEntry(
  patch: Partial<LocalUsageEntry> & Pick<LocalUsageEntry, "inputTokens" | "outputTokens" | "llmTimeSec">,
): LocalUsageEntry {
  const list = loadLocalUsageEntriesRaw();
  let idx = -1;
  if (patch.taskId) idx = list.findIndex((e) => e.taskId === patch.taskId);
  if (idx < 0 && patch.messageId) idx = list.findIndex((e) => e.messageId === patch.messageId);
  if (idx < 0 && patch.id) idx = list.findIndex((e) => e.id === patch.id);

  const base: LocalUsageEntry =
    idx >= 0
      ? list[idx]
      : {
          id: patch.id ?? crypto.randomUUID(),
          timestamp: patch.timestamp ?? Date.now(),
          taskId: patch.taskId,
          messageId: patch.messageId,
          inputTokens: 0,
          outputTokens: 0,
          llmTimeSec: 0,
        };

  const next: LocalUsageEntry = {
    ...base,
    ...patch,
    inputTokens: Math.max(base.inputTokens, patch.inputTokens),
    outputTokens: Math.max(base.outputTokens, patch.outputTokens),
    llmTimeSec: Math.max(base.llmTimeSec, patch.llmTimeSec),
    taskId: patch.taskId ?? base.taskId,
    messageId: patch.messageId ?? base.messageId,
    timestamp: patch.timestamp ?? base.timestamp,
  };

  if (idx >= 0) list[idx] = next;
  else list.unshift(next);

  saveLocalUsageEntries(list.sort((a, b) => b.timestamp - a.timestamp));
  return next;
}

/** Lookup persisted usage for an assistant message (Settings + thread backfill). */
export function usageForMessageId(messageId: string | undefined): QueryUsage | null {
  if (!messageId) return null;
  const entry = buildLocalUsageIndex().byMessageId.get(messageId);
  if (!entry) return null;
  if (entry.inputTokens <= 0 && entry.outputTokens <= 0 && entry.llmTimeSec <= 0) return null;
  return {
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    llmTimeSec: entry.llmTimeSec,
  };
}

/** Latest persisted usage for an in-flight or completed generation task. */
export function usageForTaskId(taskId: string | undefined): QueryUsage | null {
  if (!taskId) return null;
  const entry = buildLocalUsageIndex().byTaskId.get(taskId);
  if (!entry) return null;
  if (entry.inputTokens <= 0 && entry.outputTokens <= 0 && entry.llmTimeSec <= 0) return null;
  return {
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    llmTimeSec: entry.llmTimeSec,
  };
}

/** Update local store from a generation poll (cumulative totals from the server). */
export function persistLocalUsageFromTaskPoll(taskId: string, status: unknown): QueryUsage | null {
  const extracted = extractUsageFromTaskStatus(status);
  if (!extracted) return usageForTaskId(taskId);
  upsertLocalUsageEntry({
    taskId,
    inputTokens: extracted.inputTokens,
    outputTokens: extracted.outputTokens,
    llmTimeSec: extracted.llmTimeSec,
    timestamp: Date.now(),
  });
  return extracted;
}

/** Link a completed turn to its assistant message and optional wall-clock timestamp. */
export function attachLocalUsageToMessage(
  taskId: string,
  messageId: string,
  turnTimestamp?: number,
): QueryUsage | null {
  const index = buildLocalUsageIndex();
  const fromTask = index.byTaskId.get(taskId);
  const usage = mergeQueryUsage(
    fromTask
      ? {
          inputTokens: fromTask.inputTokens,
          outputTokens: fromTask.outputTokens,
          llmTimeSec: fromTask.llmTimeSec,
        }
      : null,
    usageForTaskId(taskId),
  );
  if (!usage) return null;
  upsertLocalUsageEntry({
    taskId,
    messageId,
    timestamp: turnTimestamp ?? fromTask?.timestamp ?? Date.now(),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    llmTimeSec: usage.llmTimeSec,
  });
  return usage;
}

function localEntryToRecord(entry: LocalUsageEntry): UsageRecord | null {
  const hasTokenCounts = entry.inputTokens > 0 || entry.outputTokens > 0;
  const hasLlmTime = entry.llmTimeSec > 0;
  if (!hasTokenCounts && !hasLlmTime) return null;
  return {
    id: entry.messageId ?? entry.id,
    timestamp: entry.timestamp,
    inputTokens: hasTokenCounts ? entry.inputTokens : null,
    outputTokens: hasTokenCounts ? entry.outputTokens : null,
    answerTimeSec: hasLlmTime ? entry.llmTimeSec : null,
    hasTokenData: hasTokenCounts,
    usedLlmTime: hasLlmTime,
  };
}

const PERIOD_MS: Record<UsagePeriod, number> = {
  "1d": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

function emptyTotals(): PeriodTotals {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    queryCount: 0,
    avgAnswerTimeSec: null,
  };
}

function isUsageMessage(message: ConversationMsg): boolean {
  if (message.role !== "assistant") return false;
  if (message.type === "generation") return true;
  if (message.type === "error" && message.answer) return true;
  if (message.artifact) return true;
  return false;
}

function findQuestionTimestamp(
  messages: ConversationMsg[],
  assistant: ConversationMsg,
  assistantIndex: number,
): number | null {
  if (assistant.questionMessageId) {
    const matched = messages.find((m) => m.id === assistant.questionMessageId);
    if (matched?.timestamp) return matched.timestamp;
  }
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].timestamp;
  }
  return null;
}

function recordFromAssistant(
  messages: ConversationMsg[],
  assistant: ConversationMsg,
  assistantIndex: number,
  localIndex: LocalUsageIndex,
): UsageRecord | null {
  if (!isUsageMessage(assistant) || !assistant.timestamp) return null;

  const fromLocal = assistant.id ? localIndex.byMessageId.get(assistant.id) : undefined;
  const usage = mergeQueryUsage(
    assistant.usage,
    fromLocal
      ? {
          inputTokens: fromLocal.inputTokens,
          outputTokens: fromLocal.outputTokens,
          llmTimeSec: fromLocal.llmTimeSec,
        }
      : null,
  );

  const hasTokenCounts = usageHasCounts(usage);
  const usedLlmTime = !!(usage && usage.llmTimeSec > 0);

  let answerTimeSec: number | null = null;
  if (usedLlmTime) {
    answerTimeSec = usage!.llmTimeSec;
  } else {
    const questionTs = findQuestionTimestamp(messages, assistant, assistantIndex);
    if (questionTs != null && assistant.timestamp > questionTs) {
      answerTimeSec = (assistant.timestamp - questionTs) / 1000;
    }
  }

  if (!hasTokenCounts && answerTimeSec == null) return null;

  return {
    id: assistant.id ?? `${assistant.timestamp}`,
    timestamp: assistant.timestamp,
    inputTokens: hasTokenCounts ? usage!.inputTokens : null,
    outputTokens: hasTokenCounts ? usage!.outputTokens : null,
    answerTimeSec,
    hasTokenData: hasTokenCounts,
    usedLlmTime,
  };
}

function collectFromThread(thread: QueryThread, localIndex: LocalUsageIndex): UsageRecord[] {
  const records: UsageRecord[] = [];
  const messages = thread.conversationMessages ?? [];
  messages.forEach((message, index) => {
    const record = recordFromAssistant(messages, message, index, localIndex);
    if (record) records.push(record);
  });
  return records;
}

function loadAllThreadsFromStorage(): QueryThread[] {
  const threads: QueryThread[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(THREADS_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const thread of parsed) {
        if (thread && Array.isArray(thread.conversationMessages)) {
          threads.push(thread as QueryThread);
        }
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return threads;
}

/** Legacy standalone records written before usage was attached to messages. */
function loadLegacyUsageRecords(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r): UsageRecord | null => {
        if (!r || typeof r.timestamp !== "number") return null;
        const inputTokens = typeof r.inputTokens === "number" ? r.inputTokens : null;
        const outputTokens = typeof r.outputTokens === "number" ? r.outputTokens : null;
        const answerTimeSec =
          typeof r.llmTimeSec === "number"
            ? r.llmTimeSec
            : typeof r.answerTimeSec === "number"
              ? r.answerTimeSec
              : null;
        const hasTokenData = (inputTokens ?? 0) > 0 || (outputTokens ?? 0) > 0;
        if (!hasTokenData && !(answerTimeSec && answerTimeSec > 0)) return null;
        return {
          id: typeof r.id === "string" ? r.id : `legacy-${r.timestamp}`,
          timestamp: r.timestamp,
          inputTokens,
          outputTokens,
          answerTimeSec,
          hasTokenData,
          usedLlmTime: !!(answerTimeSec && answerTimeSec > 0 && (typeof r.llmTimeSec === "number")),
        };
      })
      .filter((r): r is UsageRecord => !!r);
  } catch {
    return [];
  }
}

export function collectUsageRecords(
  liveThreads?: QueryThread[],
): UsageRecord[] {
  const localIndex = buildLocalUsageIndex();
  const byId = new Map<string, UsageRecord>();

  const add = (record: UsageRecord) => {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      return;
    }
    byId.set(record.id, {
      ...existing,
      inputTokens: existing.hasTokenData ? existing.inputTokens : record.inputTokens,
      outputTokens: existing.hasTokenData ? existing.outputTokens : record.outputTokens,
      hasTokenData: existing.hasTokenData || record.hasTokenData,
      answerTimeSec: existing.answerTimeSec ?? record.answerTimeSec,
      usedLlmTime: existing.usedLlmTime || record.usedLlmTime,
    });
  };

  for (const thread of loadAllThreadsFromStorage()) {
    for (const record of collectFromThread(thread, localIndex)) add(record);
  }
  if (liveThreads) {
    for (const thread of liveThreads) {
      for (const record of collectFromThread(thread, localIndex)) add(record);
    }
  }
  for (const record of loadLegacyUsageRecords()) add(record);

  for (const entry of loadLocalUsageEntries()) {
    const record = localEntryToRecord(entry);
    if (record) add(record);
  }

  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/** Extract token / LLM time fields from a get_task_status response. */
export function extractUsageFromTaskStatus(status: unknown): QueryUsage | null {
  if (!status || typeof status !== "object") return null;
  const s = status as Record<string, unknown>;
  const inputTokens = Number(s.input_tokens ?? 0) || 0;
  const outputTokens = Number(s.output_tokens ?? 0) || 0;
  const llmTimeSec = Number(s.total_llm_time ?? 0) || 0;
  if (inputTokens <= 0 && outputTokens <= 0 && llmTimeSec <= 0) return null;
  return { inputTokens, outputTokens, llmTimeSec };
}

/** @deprecated Prefer persistLocalUsageFromTaskPoll + attachLocalUsageToMessage */
export function recordUsageFromTaskStatus(status: unknown, taskId?: string): QueryUsage | null {
  const extracted = extractUsageFromTaskStatus(status);
  if (!extracted) return null;
  if (taskId) {
    upsertLocalUsageEntry({
      taskId,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      llmTimeSec: extracted.llmTimeSec,
      timestamp: Date.now(),
    });
  } else {
    upsertLocalUsageEntry({
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      llmTimeSec: extracted.llmTimeSec,
      timestamp: Date.now(),
    });
  }
  return extracted;
}

function sumPeriod(records: UsageRecord[], period: UsagePeriod, now: number): PeriodTotals {
  const cutoff = now - PERIOD_MS[period];
  const inPeriod = records.filter((r) => r.timestamp >= cutoff);
  if (inPeriod.length === 0) return emptyTotals();

  let inputTokens = 0;
  let outputTokens = 0;
  let tokenSamples = 0;
  let timeSum = 0;
  let timeSamples = 0;

  for (const r of inPeriod) {
    if (r.hasTokenData) {
      inputTokens += r.inputTokens ?? 0;
      outputTokens += r.outputTokens ?? 0;
      tokenSamples += 1;
    }
    if (r.answerTimeSec != null && r.answerTimeSec > 0) {
      timeSum += r.answerTimeSec;
      timeSamples += 1;
    }
  }

  return {
    inputTokens: tokenSamples > 0 ? inputTokens : null,
    outputTokens: tokenSamples > 0 ? outputTokens : null,
    totalTokens: tokenSamples > 0 ? inputTokens + outputTokens : null,
    queryCount: inPeriod.length,
    avgAnswerTimeSec: timeSamples > 0 ? timeSum / timeSamples : null,
  };
}

export function getUsageSnapshot(liveThreads?: QueryThread[]): UsageSnapshot {
  const records = collectUsageRecords(liveThreads);
  const now = Date.now();
  const lastQuery = records[0] ?? null;
  const last5 = records.slice(0, 5).filter((r) => r.answerTimeSec != null && r.answerTimeSec > 0);
  const last5AvgAnswerTimeSec =
    last5.length === 0
      ? null
      : last5.reduce((sum, r) => sum + (r.answerTimeSec ?? 0), 0) / last5.length;

  return {
    lastQuery,
    last5AvgAnswerTimeSec,
    byPeriod: {
      "1d": sumPeriod(records, "1d", now),
      "7d": sumPeriod(records, "7d", now),
      "30d": sumPeriod(records, "30d", now),
    },
  };
}

export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}

export function formatLlmTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export const PERIOD_LABELS: Record<UsagePeriod, string> = {
  "1d": "Day",
  "7d": "Week",
  "30d": "Month",
};

const HOUR_MS = 60 * 60 * 1000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatBucketLabel(startMs: number, period: UsagePeriod): string {
  const d = new Date(startMs);
  if (period === "1d") {
    return d.toLocaleTimeString([], { hour: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function bucketStartsForPeriod(period: UsagePeriod, now: number): number[] {
  if (period === "1d") {
    const endHour = Math.floor(now / HOUR_MS) * HOUR_MS;
    return Array.from({ length: 24 }, (_, i) => endHour - (23 - i) * HOUR_MS);
  }
  const todayStart = startOfLocalDay(now);
  const days = period === "7d" ? 7 : 30;
  return Array.from({ length: days }, (_, i) => todayStart - (days - 1 - i) * DAY_MS);
}

function bucketStartForRecord(ts: number, period: UsagePeriod): number {
  if (period === "1d") {
    return Math.floor(ts / HOUR_MS) * HOUR_MS;
  }
  return startOfLocalDay(ts);
}

export function buildUsageTimeSeries(
  records: UsageRecord[],
  period: UsagePeriod,
  now: number = Date.now(),
): UsageTimeBucket[] {
  const starts = bucketStartsForPeriod(period, now);
  const map = new Map<number, UsageTimeBucket>();

  for (const startMs of starts) {
    map.set(startMs, {
      key: String(startMs),
      label: formatBucketLabel(startMs, period),
      startMs,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      queryCount: 0,
      avgAnswerTimeSec: null,
    });
  }

  const cutoff = starts[0] ?? now - PERIOD_MS[period];
  const inPeriod = records.filter((r) => r.timestamp >= cutoff);

  const timeSums = new Map<number, { sum: number; n: number }>();

  for (const r of inPeriod) {
    const bStart = bucketStartForRecord(r.timestamp, period);
    let bucket = map.get(bStart);
    if (!bucket) {
      bucket = {
        key: String(bStart),
        label: formatBucketLabel(bStart, period),
        startMs: bStart,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        queryCount: 0,
        avgAnswerTimeSec: null,
      };
      map.set(bStart, bucket);
    }
    bucket.queryCount += 1;
    if (r.hasTokenData) {
      bucket.inputTokens += r.inputTokens ?? 0;
      bucket.outputTokens += r.outputTokens ?? 0;
      bucket.totalTokens = bucket.inputTokens + bucket.outputTokens;
    }
    if (r.answerTimeSec != null && r.answerTimeSec > 0) {
      const prev = timeSums.get(bStart) ?? { sum: 0, n: 0 };
      timeSums.set(bStart, { sum: prev.sum + r.answerTimeSec, n: prev.n + 1 });
    }
  }

  for (const [startMs, { sum, n }] of timeSums) {
    const bucket = map.get(startMs);
    if (bucket && n > 0) bucket.avgAnswerTimeSec = sum / n;
  }

  return [...map.values()].sort((a, b) => a.startMs - b.startMs);
}

export function toCumulativeTokenSeries(
  buckets: UsageTimeBucket[],
): UsageCumulativeBucket[] {
  let cumIn = 0;
  let cumOut = 0;
  return buckets.map((b) => {
    cumIn += b.inputTokens;
    cumOut += b.outputTokens;
    return {
      label: b.label,
      input: cumIn,
      output: cumOut,
      total: cumIn + cumOut,
    };
  });
}

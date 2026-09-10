import type { ConversationArtifact } from "./DAGEditor";
import { snapshotConversationArtifact } from "./queryThreads";

export type PinnedArtifactKind = "dag" | "code" | "dashboard";

export interface PinnedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PinnedLayoutMode = "grid" | "freeform";

export interface PinnedItem {
  id: string;
  kind: PinnedArtifactKind;
  title: string;
  query: string;
  artifact: ConversationArtifact;
  pinnedAt: number;
  layout: PinnedLayout;
  /** Query thread that produced this pin, when pinned from Ask Queries. */
  threadId?: string;
  /** Conversation message id for the artifact, when available. */
  messageId?: string;
}

const PINNED_LAYOUT_MODE_KEY = "nolain_pinned_layout_mode";

export const PINNED_MIN_WIDTH = 280;
export const PINNED_MIN_HEIGHT = 200;
export const PINNED_DEFAULT_WIDTH = 560;
export const PINNED_DEFAULT_HEIGHT = 420;
export const PINNED_CANVAS_GAP = 10;

const PINNED_STORAGE_KEY = "nolain_pinned_artifacts";

function storageKey(filePath: string): string {
  return `${PINNED_STORAGE_KEY}:${filePath || "__no_file__"}`;
}

export function loadPinnedLayoutMode(): PinnedLayoutMode {
  try {
    const raw = localStorage.getItem(PINNED_LAYOUT_MODE_KEY);
    return raw === "freeform" ? "freeform" : "grid";
  } catch {
    return "grid";
  }
}

export function persistPinnedLayoutMode(mode: PinnedLayoutMode): void {
  localStorage.setItem(PINNED_LAYOUT_MODE_KEY, mode);
}

export function loadPinnedItems(filePath: string): PinnedItem[] {
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    if (!raw) return [];
    return (JSON.parse(raw) as PinnedItem[]).map((item) => ({
      ...item,
      artifact: snapshotConversationArtifact(item.artifact),
    }));
  } catch {
    return [];
  }
}

export function persistPinnedItems(filePath: string, items: PinnedItem[]): void {
  localStorage.setItem(storageKey(filePath), JSON.stringify(items));
}

export function pinnedKindLabel(kind: PinnedArtifactKind): string {
  if (kind === "dag") return "Graph";
  if (kind === "code") return "Code";
  return "Dashboard";
}

export function canPinKind(
  kind: PinnedArtifactKind,
  artifact: ConversationArtifact | null | undefined,
): boolean {
  if (!artifact) return false;
  if (kind === "dag") return !!artifact.dagData?.nodes?.length;
  if (kind === "code") return !!artifact.pythonCode?.trim();
  return artifact.kind === "visualization" && !!artifact.visualizationSpec;
}

export function defaultPinnedTitle(
  kind: PinnedArtifactKind,
  artifact: ConversationArtifact,
): string {
  if (kind === "dashboard") return artifact.visualizationSpec?.title ?? "Visualization";
  if (artifact.dagName?.trim()) return artifact.dagName.trim();
  const query = artifact.query?.trim();
  if (query) return query.length > 48 ? `${query.slice(0, 48)}…` : query;
  return pinnedKindLabel(kind);
}

export function nextPinnedLayout(items: PinnedItem[]): PinnedLayout {
  const width = PINNED_DEFAULT_WIDTH;
  const height = PINNED_DEFAULT_HEIGHT;
  const gap = PINNED_CANVAS_GAP;

  if (items.length === 0) {
    return { x: gap, y: gap, width, height };
  }

  const maxY = Math.max(...items.map((item) => item.layout.y + item.layout.height));
  const rowCandidates = items.filter(
    (item) => item.layout.y + item.layout.height <= maxY + 1 && item.layout.y >= maxY - height,
  );
  const rightmost = rowCandidates.reduce(
    (best, item) => {
      const edge = item.layout.x + item.layout.width;
      return edge > best.edge ? { edge, y: item.layout.y } : best;
    },
    { edge: gap, y: maxY },
  );

  const nextX = rightmost.edge + gap;
  const canvasWidth = 3200;
  if (nextX + width + gap <= canvasWidth) {
    return { x: nextX, y: rightmost.y, width, height };
  }

  return { x: gap, y: maxY + gap, width, height };
}

export function createPinnedItem(
  kind: PinnedArtifactKind,
  artifact: ConversationArtifact,
  existing: PinnedItem[],
  options?: {
    title?: string;
    threadId?: string;
    messageId?: string;
  },
): PinnedItem {
  return {
    id: crypto.randomUUID(),
    kind,
    title: options?.title?.trim() || defaultPinnedTitle(kind, artifact),
    query: artifact.query ?? "",
    artifact: snapshotConversationArtifact(artifact),
    pinnedAt: Date.now(),
    layout: nextPinnedLayout(existing),
    threadId: options?.threadId,
    messageId: options?.messageId,
  };
}

export function clampPinnedLayout(layout: PinnedLayout): PinnedLayout {
  return {
    ...layout,
    width: Math.max(PINNED_MIN_WIDTH, layout.width),
    height: Math.max(PINNED_MIN_HEIGHT, layout.height),
    x: Math.max(PINNED_CANVAS_GAP, layout.x),
    y: Math.max(PINNED_CANVAS_GAP, layout.y),
  };
}

export function canvasHeightForItems(items: PinnedItem[], minHeight = 600): number {
  if (items.length === 0) return minHeight;
  const bottom = Math.max(...items.map((item) => item.layout.y + item.layout.height));
  return Math.max(minHeight, bottom + PINNED_CANVAS_GAP * 2);
}

export type ArtifactSlotStatus =
  | "not_requested"
  | "pending"
  | "ready"
  | "failed"
  | "skipped";

export interface ArtifactSlot {
  kind: string;
  status: ArtifactSlotStatus;
  reason?: string | null;
}

export interface CanvasManifest {
  requestedArtifactKinds: string[];
  slots: ArtifactSlot[];
}

export function parseCanvasManifestFromPoll(data: Record<string, unknown>): CanvasManifest {
  const requestedArtifactKinds = Array.isArray(data.requested_artifact_kinds)
    ? (data.requested_artifact_kinds as string[])
    : [];

  const slots: ArtifactSlot[] = Array.isArray(data.artifact_slots)
    ? (data.artifact_slots as Array<Record<string, unknown>>).map((slot) => ({
        kind: String(slot.kind ?? ""),
        status: (slot.status as ArtifactSlotStatus) ?? "pending",
        reason: typeof slot.reason === "string" ? slot.reason : null,
      }))
    : [];

  return { requestedArtifactKinds, slots };
}

export function slotForKind(
  manifest: CanvasManifest | null | undefined,
  kind: string,
): ArtifactSlot | null {
  if (!manifest) return null;
  return manifest.slots.find((slot) => slot.kind === kind) ?? null;
}

export function dashboardEmptyMessage(
  manifest: CanvasManifest | null | undefined,
  includeVisualizationRequested: boolean,
): string {
  const slot = slotForKind(manifest, "visualization_spec");
  if (slot?.status === "failed" && slot.reason) {
    return `Visualization could not be computed: ${slot.reason}`;
  }
  if (slot?.status === "pending") {
    return "Generating visualization…";
  }
  if (slot?.status === "skipped") {
    return slot.reason ?? "Visualization was not produced for this query.";
  }
  if (!includeVisualizationRequested || slot?.status === "not_requested") {
    return "This query did not request a visualization. Ask for a chart or plot to generate a dashboard.";
  }
  return "Run a chart or plot request from Ask Queries to open its rendered artifact here.";
}

import { useEffect, useMemo } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./DAGEditor.css";
import {
  buildDagFlowElements,
  CANVAS_FIT_VIEW,
  dagNodeTypes,
  type DAGData,
} from "./DAGEditor";

function FitViewOnLoad({ dagKey }: { dagKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitView({ ...CANVAS_FIT_VIEW, duration: 0 });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [dagKey, fitView]);
  return null;
}

function PinnedDagFlow({ dagData }: { dagData: DAGData }) {
  const dagKey = useMemo(() => JSON.stringify(dagData), [dagData]);
  const { nodes, edges } = useMemo(
    () => buildDagFlowElements(dagData, { names: [], types: {} }, { readOnly: true }),
    [dagData],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={dagNodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag
      zoomOnScroll
      minZoom={0.2}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
    >
      <FitViewOnLoad dagKey={dagKey} />
      <Background color="rgba(0,0,0,0.08)" gap={18} size={0.5} />
    </ReactFlow>
  );
}

export default function PinnedDagPreview({ dagData }: { dagData: DAGData | null }) {
  if (!dagData?.nodes?.length) {
    return (
      <div className="pinned-card-empty">
        <span>No graph data</span>
      </div>
    );
  }

  return (
    <div className="pinned-dag-preview">
      <ReactFlowProvider>
        <PinnedDagFlow dagData={dagData} />
      </ReactFlowProvider>
    </div>
  );
}

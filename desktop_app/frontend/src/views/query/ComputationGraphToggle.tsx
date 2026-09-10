import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ComputationGraphToggleProps {
  compileDag: boolean;
  compileDagLocked?: boolean;
  loading?: boolean;
  onChange?: (enabled: boolean) => void;
}

export function ComputationGraphToggle({
  compileDag,
  compileDagLocked = false,
  loading = false,
  onChange,
}: ComputationGraphToggleProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const showTip = () => {
    if (compileDagLocked) return;
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({ x: r.left + r.width / 2, y: r.top });
  };

  const hideTip = () => setTipPos(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="switch"
        className={`dag-computation-graph-toggle${compileDag ? ' active' : ''}`}
        onClick={() => onChange?.(!compileDag)}
        disabled={compileDagLocked || loading}
        aria-checked={compileDag}
        aria-describedby={tipPos ? 'computation-graph-tooltip' : undefined}
        title={
          compileDagLocked
            ? 'Graph compilation is fixed by the selected execution plan in Settings'
            : undefined
        }
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
      >
        <span className="dag-computation-graph-toggle-label">Computation graph</span>
        <span className="dag-computation-graph-switch" aria-hidden="true">
          <span className="dag-computation-graph-switch-thumb" />
        </span>
      </button>
      {tipPos && !compileDagLocked && createPortal(
        <div
          id="computation-graph-tooltip"
          className="dag-computation-graph-tooltip"
          style={{ left: tipPos.x, top: tipPos.y }}
          role="tooltip"
        >
          <span className="dag-computation-graph-tooltip-beta">✨ BETA</span>
          <p className="dag-computation-graph-tooltip-body">
            When enabled, nolainquery also compiles a visual calculation graph alongside your
            Pandas code. Open the Graph tab to see each step and dependency, edit
            operations, run the graph locally, and pin it as evidence when you need to
            trace where an answer came from.
          </p>
          <p className="dag-computation-graph-tooltip-foot">
            As a rule of thumb, enabling this uses on average about 10× more credits than
            leaving it off.
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}

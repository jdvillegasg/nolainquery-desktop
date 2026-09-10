interface QueryStatusDotsProps {
  apiStatus?: "checking" | "ok" | "error";
  generationRuntimeStatus?: "checking" | "ok" | "error";
  engineStatus?: "checking" | "ok" | "error";
}

export default function QueryStatusDots({
  apiStatus = "checking",
  generationRuntimeStatus = "checking",
  engineStatus = "checking",
}: QueryStatusDotsProps) {
  return (
    <div className="dag-query-status-dots" aria-label="Service health">
      <span
        className={`dag-query-bar-api-dot dag-query-bar-api-dot--${apiStatus}`}
        title={
          apiStatus === "ok"
            ? "Cloud API connected"
            : apiStatus === "error"
              ? "Cloud API unreachable"
              : "Checking cloud API…"
        }
      />
      <span
        className={`dag-query-bar-api-dot dag-query-bar-api-dot--${generationRuntimeStatus}`}
        title={
          generationRuntimeStatus === "ok"
            ? "Generation worker connected"
            : generationRuntimeStatus === "error"
              ? "Generation worker unavailable"
              : "Checking generation worker…"
        }
      />
      <span
        className={`dag-query-bar-api-dot dag-query-bar-api-dot--${engineStatus}`}
        title={
          engineStatus === "ok"
            ? "Local data engine connected"
            : engineStatus === "error"
              ? "Local data engine unreachable"
              : "Checking local data engine…"
        }
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  DEFAULT_FEATURE_SETTINGS,
  loadFeatureSettings,
  planLabel,
  saveFeatureSettings,
  type FeatureSettings,
} from "./featureSettings";
import {
  fetchCapabilities,
  type CapabilityInfo,
  type CapabilityPlanInfo,
} from "./lib/cloudApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
interface SettingsFeaturesPanelProps {
  apiKey: string;
}

const AUTO_PLAN = "__auto__";

export default function SettingsFeaturesPanel({ apiKey }: SettingsFeaturesPanelProps) {
  const [settings, setSettings] = useState<FeatureSettings>(() => loadFeatureSettings());
  const [saved, setSaved] = useState(false);
  const [plans, setPlans] = useState<CapabilityPlanInfo[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!apiKey) {
      setPlans([]);
      setCatalogError(null);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    fetchCapabilities(apiKey)
      .then((caps: CapabilityInfo[]) => {
        if (cancelled) return;
        const dataAnalysis = caps.find((c) => c.id === "data_analysis");
        setPlans((dataAnalysis?.plans ?? []).filter((p) => p.selectable));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCatalogError(err instanceof Error ? err.message : "Could not load capabilities");
        setPlans([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const update = (patch: Partial<FeatureSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };

  const handleSave = () => {
    saveFeatureSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_FEATURE_SETTINGS });
    setSaved(false);
  };

  return (
    <Card className="min-[900px]:col-start-2 min-w-0">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Generation
          </span>
        </div>
        <CardTitle className="text-lg">Capabilities &amp; plans</CardTitle>
        <CardDescription>
          Control how the cloud API runs data analysis jobs. Settings are stored locally on this device.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3">
          <label
            className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
            htmlFor="plan-select"
          >
            Execution plan
          </label>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            Pandas is the implemented Plan. Ibis is listed as a placeholder. The Compile DAG toggle on the
            conversation panel chooses the optional DAG Artifact; it is not a separate Plan.
          </p>
          <Select
            value={settings.planId ?? AUTO_PLAN}
            onValueChange={(value) => update({ planId: value === AUTO_PLAN ? null : value })}
            disabled={!apiKey || catalogLoading}
          >
            <SelectTrigger id="plan-select" className="max-w-xl">
              <SelectValue placeholder="Automatic (recommended)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_PLAN}>Automatic (recommended)</SelectItem>
              {plans.map((plan) => (
                <SelectItem key={plan.plan_id} value={plan.plan_id}>
                  {planLabel(plan.plan_id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {catalogLoading && (
            <p className="text-sm text-[var(--color-muted-foreground)]">Loading plans from cloud API…</p>
          )}
          {catalogError && <p className="text-sm text-amber-700">{catalogError}</p>}
        </div>

        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-stone-600"
              checked={settings.enableVisualization}
              onChange={(e) => update({ enableVisualization: e.target.checked })}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-[var(--color-foreground)]">
                Allow visualization requests
              </span>
              <span className="block text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                When off, chart/plot questions receive a local notice instead of starting generation.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-stone-600"
              checked={settings.enableTransformation}
              onChange={(e) => update({ enableTransformation: e.target.checked })}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-[var(--color-foreground)]">
                Allow transformation requests
              </span>
              <span className="block text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                When off, clean/reshape/export-copy questions are blocked locally before generation.
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSave}>
            {saved ? "Saved" : "Save feature settings"}
          </Button>
          <Button type="button" variant="outline" onClick={handleReset}>
            Reset defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

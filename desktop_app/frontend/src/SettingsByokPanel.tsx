import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  OPENROUTER_KEYS_URL,
  loadInferenceSettings,
  saveInferenceSettings,
  type InferenceMode,
  type InferenceSettings,
} from "./inferenceSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiKeyStatus } from "@/lib/cloudApi";
import { cn } from "@/lib/utils";

interface SettingsByokPanelProps {
  apiKeyStatus: ApiKeyStatus | null;
}

export default function SettingsByokPanel({ apiKeyStatus }: SettingsByokPanelProps) {
  const [settings, setSettings] = useState<InferenceSettings>(() => loadInferenceSettings());
  const [keyVisible, setKeyVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  const byokAvailable = apiKeyStatus?.byok_enabled !== false;
  const byokReady = settings.mode === "byok" && settings.openRouterKey.trim().length > 0;

  const setMode = (mode: InferenceMode) => {
    setSettings((prev) => ({ ...prev, mode }));
    setSaved(false);
  };

  const handleSave = () => {
    saveInferenceSettings({
      mode: settings.mode,
      openRouterKey: settings.openRouterKey.trim(),
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        Model inference
      </p>
      <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Use nolainquery credits, or send your own{" "}
        <a
          href={OPENROUTER_KEYS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-foreground)] underline decoration-[var(--color-border)] underline-offset-2 transition-colors hover:decoration-stone-400"
        >
          OpenRouter API key
        </a>
        . Your nolainquery key is still required to use the app.
      </p>

      {!byokAvailable ? (
        <Badge variant="secondary">Bring-your-own-key is disabled on this server</Badge>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("platform")}
              className={cn(
                "cursor-pointer rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm transition-all duration-200 ease-out",
                settings.mode === "platform"
                  ? "border-stone-300 bg-stone-100 active:scale-[0.98]"
                  : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-stone-300 hover:bg-stone-100 hover:-translate-y-px active:scale-[0.98]",
              )}
            >
              <span className="block font-medium text-[var(--color-foreground)]">Nolain credits</span>
              <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                Server pays OpenRouter and deducts credits.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("byok")}
              className={cn(
                "cursor-pointer rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm transition-all duration-200 ease-out",
                settings.mode === "byok"
                  ? "border-stone-300 bg-stone-100 active:scale-[0.98]"
                  : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-stone-300 hover:bg-stone-100 hover:-translate-y-px active:scale-[0.98]",
              )}
            >
              <span className="block font-medium text-[var(--color-foreground)]">Your OpenRouter key</span>
              <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                You pay OpenRouter. nolainquery credits are not charged.
              </span>
            </button>
          </div>

          {settings.mode === "byok" && (
            <div className="space-y-2">
              <label
                className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
                htmlFor="openrouter-key-input"
              >
                OpenRouter API key
              </label>
              <div className="flex gap-2">
                <input
                  id="openrouter-key-input"
                  className={cn(
                    "h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-popover)] px-3",
                    "font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--color-foreground)] outline-none",
                    "transition-colors placeholder:text-[var(--color-muted-foreground)]",
                    "focus-visible:border-[var(--color-ring)] focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]",
                  )}
                  type={keyVisible ? "text" : "password"}
                  placeholder="sk-or-..."
                  value={settings.openRouterKey}
                  onChange={(e) => {
                    setSettings((prev) => ({ ...prev, openRouterKey: e.target.value }));
                    setSaved(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setKeyVisible((v) => !v)}
                  title={keyVisible ? "Hide key" : "Show key"}
                  aria-label={keyVisible ? "Hide key" : "Show key"}
                >
                  {keyVisible ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
                </Button>
              </div>
            </div>
          )}

          {settings.mode === "byok" && !byokReady && (
            <Badge variant="warning">
              Save an OpenRouter key, or queries will keep using nolainquery credits.
            </Badge>
          )}
          {byokReady && (
            <Badge variant="success">Using your OpenRouter key for model calls</Badge>
          )}
          {settings.mode === "platform" && (
            <Badge variant="secondary">Using nolainquery credits for model calls</Badge>
          )}

          <Button id="save-inference-btn" className="w-full sm:w-auto" onClick={handleSave}>
            {saved ? "Saved" : "Save inference settings"}
          </Button>
        </>
      )}
    </div>
  );
}

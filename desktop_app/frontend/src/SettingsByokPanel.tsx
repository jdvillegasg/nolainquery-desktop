import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  OPENROUTER_KEYS_URL,
  loadInferenceSettings,
  saveInferenceSettings,
  type InferenceSettings,
} from "./inferenceSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiKeyStatus } from "@/lib/cloudApi";

interface SettingsByokPanelProps {
  apiKeyStatus: ApiKeyStatus | null;
}

export default function SettingsByokPanel({ apiKeyStatus }: SettingsByokPanelProps) {
  const [settings, setSettings] = useState<InferenceSettings>(() => loadInferenceSettings());
  const [keyVisible, setKeyVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  const byokAvailable = apiKeyStatus?.byok_enabled !== false;
  const byokReady = settings.openRouterKey.trim().length > 0;

  const handleSave = () => {
    saveInferenceSettings({
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
        Model calls use your{" "}
        <a
          href={OPENROUTER_KEYS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-foreground)] underline decoration-[var(--color-border)] underline-offset-2 transition-colors hover:decoration-stone-400"
        >
          OpenRouter API key
        </a>
        . You pay OpenRouter directly. Your nolainquery key is still required to
        use the app.
      </p>

      {!byokAvailable ? (
        <Badge variant="secondary">Bring-your-own-key is disabled on this server</Badge>
      ) : (
        <>
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
                className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-popover)] px-3 font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--color-foreground)] outline-none transition-colors placeholder:text-[var(--color-muted-foreground)] focus-visible:border-[var(--color-ring)] focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
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

          {!byokReady ? (
            <Badge variant="warning">Save an OpenRouter key before asking queries.</Badge>
          ) : (
            <Badge variant="success">Using your OpenRouter key for model calls</Badge>
          )}

          <Button id="save-inference-btn" className="w-full sm:w-auto" onClick={handleSave}>
            {saved ? "Saved" : "Save inference settings"}
          </Button>
        </>
      )}
    </div>
  );
}

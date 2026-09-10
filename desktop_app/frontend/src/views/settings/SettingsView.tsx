import { Eye, EyeOff, KeyRound } from "lucide-react";
import SettingsUsagePanel from "../../SettingsUsagePanel";
import SettingsByokPanel from "../../SettingsByokPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PORTAL_URL, type ApiKeyStatus } from "@/lib/cloudApi";
import { cn } from "@/lib/utils";
import type { QueryThread } from "../../queryThreads";

export interface SettingsViewProps {
  apiKey: string;
  apiKeyDraft: string;
  onApiKeyDraftChange: (value: string) => void;
  apiKeyVisible: boolean;
  onToggleApiKeyVisible: () => void;
  apiKeyValidating: boolean;
  apiKeyStatus: ApiKeyStatus | null;
  apiKeyError: string | null;
  apiKeySaved: boolean;
  onSaveApiKey: () => void;
  usageRevision: number;
  queryThreads?: QueryThread[];
}

function ApiKeyStatusBadge({
  validating,
  status,
  error,
  hasSavedKey,
  draftEmpty,
}: {
  validating: boolean;
  status: ApiKeyStatus | null;
  error: string | null;
  hasSavedKey: boolean;
  draftEmpty: boolean;
}) {
  if (validating) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-stone-400" />
        Validating key…
      </Badge>
    );
  }

  if (status) {
    return (
      <Badge variant="success" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {`Key active (${status.masked_key}) · ${status.tier} tier`}
      </Badge>
    );
  }

  if (error) {
    return (
      <Badge variant="warning" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {error}
      </Badge>
    );
  }

  if (hasSavedKey) {
    return (
      <Badge variant="success" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Key saved
      </Badge>
    );
  }

  if (draftEmpty) {
    return (
      <Badge variant="warning" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-amber-500" />
        No API key set. Queries will be blocked.
      </Badge>
    );
  }

  return null;
}

export default function SettingsView({
  apiKey,
  apiKeyDraft,
  onApiKeyDraftChange,
  apiKeyVisible,
  onToggleApiKeyVisible,
  apiKeyValidating,
  apiKeyStatus,
  apiKeyError,
  apiKeySaved,
  onSaveApiKey,
  usageRevision,
  queryThreads,
}: SettingsViewProps) {
  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col font-[family-name:var(--font-nav)] text-[var(--color-foreground)]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-1 min-h-0 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pb-10 pt-1">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Configuration
              </span>
            </div>
            <CardTitle className="text-lg">Settings</CardTitle>
            <CardDescription>Manage your nolainquery account configuration.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-3">
              <label
                className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
                htmlFor="api-key-input"
              >
                API Key
              </label>
              <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                Paste the key you generated on the{" "}
                <a
                  href={`${PORTAL_URL}/account`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-foreground)] underline decoration-[var(--color-border)] underline-offset-2 transition-colors hover:decoration-stone-400"
                >
                  nolainquery website
                </a>
                . It is stored locally on your machine and never shared.
              </p>

              <div className="flex gap-2">
                <input
                  id="api-key-input"
                  className={cn(
                    "h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-popover)] px-3",
                    "font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--color-foreground)] outline-none",
                    "transition-colors placeholder:text-[var(--color-muted-foreground)]",
                    "focus-visible:border-[var(--color-ring)] focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]",
                  )}
                  type={apiKeyVisible ? "text" : "password"}
                  placeholder="sk-..."
                  value={apiKeyDraft}
                  onChange={(e) => onApiKeyDraftChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSaveApiKey()}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onToggleApiKeyVisible}
                  title={apiKeyVisible ? "Hide key" : "Show key"}
                  aria-label={apiKeyVisible ? "Hide key" : "Show key"}
                >
                  {apiKeyVisible ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
                </Button>
              </div>

              <ApiKeyStatusBadge
                validating={apiKeyValidating}
                status={apiKeyStatus}
                error={apiKeyError}
                hasSavedKey={Boolean(apiKey && !apiKeyValidating && !apiKeyStatus && !apiKeyError)}
                draftEmpty={!apiKey && apiKeyDraft === ""}
              />

              <Button id="save-api-key-btn" className="w-full sm:w-auto" onClick={onSaveApiKey}>
                {apiKeySaved ? "Saved" : "Save API Key"}
              </Button>
            </div>

            <hr className="border-[var(--color-border)]" />

            <SettingsByokPanel apiKeyStatus={apiKeyStatus} />

            <hr className="border-[var(--color-border)]" />

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                How to get an API key
              </p>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                <li>
                  Visit{" "}
                  <a
                    href="https://nolainquery.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-foreground)] underline decoration-[var(--color-border)] underline-offset-2 transition-colors hover:decoration-stone-400"
                  >
                    nolainquery.com
                  </a>{" "}
                  and sign in.
                </li>
                <li>
                  Go to <strong className="font-medium text-[var(--color-foreground)]">Account → API Keys</strong> and
                  create a key.
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        <SettingsUsagePanel revision={usageRevision} queryThreads={queryThreads} />
      </div>
    </div>
  );
}

"use client";

import { Check, CloudOff, Link2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { cn } from "@/lib/utils";

/** The sync state, in words. Shown only when it needs the user's attention. */
export function SyncBanner() {
  const sync = useStore((s) => s.sync);
  if (sync.status === "synced" || sync.status === "loading" || (sync.status === "syncing" && sync.pending === 0)) return null;
  const waiting = sync.pending > 0 ? ` ${sync.pending} change${sync.pending === 1 ? " is" : "s are"} waiting to be sent.` : "";
  if (sync.status === "syncing") {
    return (
      <div role="status" className="no-print flex items-center gap-2 rounded-xl border bg-muted px-4 py-2.5 text-sm">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> Saving to the shared workspace…
      </div>
    );
  }
  return (
    <div role="status" data-sync={sync.status} className="no-print flex items-start gap-2 rounded-xl border border-st-hold-dot/50 bg-st-hold-bg px-4 py-2.5 text-sm text-st-hold">
      <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong className="font-semibold">{sync.message ?? "Not syncing. Changes are saved on this device only"}.</strong>
        {sync.status === "offline" ? ` We'll keep trying.${waiting}` : waiting}
      </span>
    </div>
  );
}

/** A small, calm status for the header, with a button to copy the link. */
export function ShareButton() {
  const id = useStore((s) => s.workspaceId);
  const sync = useStore((s) => s.sync);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/w/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link to share the workspace:", url);
    }
  }

  const state = sync.status === "synced" ? "Synced" : sync.status === "offline" || sync.status === "error" || sync.status === "missing" ? "Not syncing" : "Saving…";
  return (
    <div className="flex items-center gap-1">
      <span
        className={cn("hidden items-center gap-1.5 px-2 text-xs md:inline-flex", sync.status === "synced" ? "text-muted-foreground" : "text-st-hold")}
        data-testid="sync-state"
      >
        <span aria-hidden className={cn("size-1.5 rounded-full", sync.status === "synced" ? "bg-st-approved-dot" : "bg-st-hold-dot")} /> {state}
      </span>
      <Button variant="ghost" size="sm" onClick={() => void copy()}>
        {copied ? <Check /> : <Link2 />} <span className="hidden sm:inline">{copied ? "Link copied" : "Copy share link"}</span>
      </Button>
    </div>
  );
}

const TOAST_MS = 9000;

/** What other viewers just changed, and any change that couldn't be saved. */
export function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), TOAST_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="no-print fixed bottom-4 left-4 right-4 z-50 flex max-w-md flex-col gap-2 sm:right-auto" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("flex items-start gap-2 rounded-xl border bg-card p-3 text-sm shadow-lg", t.kind === "problem" && "border-destructive/40")}>
          <p className="flex-1">{t.text}</p>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

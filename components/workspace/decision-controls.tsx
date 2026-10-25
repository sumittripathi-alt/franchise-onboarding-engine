"use client";

import { Lock, MessageSquareWarning, PenLine, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { FactPatch, HumanOverride } from "@/lib/engine/types";
import { FLOORS, LANGUAGES, SPACE_AVAILABLE } from "@/lib/policy/allowedValues";
import { previewChange, type ChangeSpec, type Preview } from "@/lib/state/session";
import { useStore } from "@/lib/state/store";
import { STATUS_META, type DecisionRecord, type Status } from "@/lib/types";
import { formatDate } from "@/lib/planner/dates";
import { useWorkspace } from "./context";

const field = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

// ---------- Give a new fact ----------

/** Update what we know about an applicant. Changes auto-commit with a diff and an Undo (SPEC §8.2, G5.1). */
export function FactForm({ d, defaultOpen }: { d: DecisionRecord; defaultOpen: boolean }) {
  const { appByKey } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const a = appByKey.get(d.appKey);
  const [open, setOpen] = useState(defaultOpen);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [withdraw, setWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!a) return null;

  const set = (k: string, v: string) => setVals((x) => ({ ...x, [k]: v }));
  const cur = {
    spaceAvailable: a.spaceAvailable.value ?? "",
    floor: a.floor.value ?? "",
    spaceSqft: a.spaceSqft.value === null ? "" : String(a.spaceSqft.value),
    investmentLakh: a.investmentLakh.value === null ? "" : String(a.investmentLakh.value),
    experienceYears: a.experienceYears.value === null ? "" : String(a.experienceYears.value),
    targetLaunchMonths: a.targetLaunchMonths.value === null ? "" : String(a.targetLaunchMonths.value),
    language: a.language.value ?? "",
  };
  const val = (k: keyof typeof cur) => vals[k] ?? cur[k];

  function apply() {
    setError(null);
    if (withdraw) {
      const out = commit({ source: "manual", description: `${d.appId} withdrew`, facts: [{ target: "application", key: d.appKey, field: "withdrawn", value: true }], directKeys: [d.appKey] });
      if (!out.ok) setError(out.message);
      return;
    }
    const facts: FactPatch[] = [];
    const parts: string[] = [];
    const text: [keyof typeof cur, string, "text"][] = [
      ["spaceAvailable", "space", "text"],
      ["floor", "floor", "text"],
      ["language", "preferred language", "text"],
    ];
    for (const [k, label] of text) {
      const v = val(k);
      if (v !== cur[k] && v !== "") {
        facts.push({ target: "application", key: d.appKey, field: k, value: v });
        parts.push(`${label} → ${v}`);
      }
    }
    const nums: [keyof typeof cur, string, boolean][] = [
      ["spaceSqft", "space size (sq ft)", false],
      ["investmentLakh", "investment (₹ lakh)", true],
      ["experienceYears", "experience (years)", false],
      ["targetLaunchMonths", "target launch (months)", true],
    ];
    for (const [k, label, positive] of nums) {
      const raw = val(k).trim();
      if (raw === cur[k]) continue;
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || (positive && n <= 0)) {
        setError(`${label} needs a ${positive ? "positive " : ""}number.`);
        return;
      }
      facts.push({ target: "application", key: d.appKey, field: k as never, value: n });
      parts.push(`${label} → ${n}`);
    }
    const note = (vals.note ?? "").trim();
    if (note) {
      facts.push({ target: "application", key: d.appKey, field: "notes", value: note });
      parts.push("note added");
    }
    if (facts.length === 0) {
      setError("Change at least one thing first.");
      return;
    }
    // A found space with no stated size stays unknown, which becomes the condition "confirm size" (G5.2).
    const out = commit({ source: "manual", description: `${d.appId}: ${parts.join(", ")}`, facts, directKeys: [d.appKey] });
    if (out.ok) {
      setVals({});
      setOpen(false);
    } else setError(out.message);
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded-xl border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
        <PenLine aria-hidden className="size-4 text-accent-brand" /> Give a new fact about {d.appId}
      </summary>
      <div className="space-y-3 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">Change only what is new. The decisions are worked out again and you see what moved, with an Undo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            Space available
            <select className={field} value={val("spaceAvailable")} onChange={(e) => set("spaceAvailable", e.target.value)}>
              <option value="">Not stated</option>
              {SPACE_AVAILABLE.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Floor
            <select className={field} value={val("floor")} onChange={(e) => set("floor", e.target.value)}>
              <option value="">Not stated</option>
              {FLOORS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          {([["spaceSqft", "Space size (sq ft)"], ["investmentLakh", "Investment (₹ lakh)"], ["experienceYears", "Experience (years)"], ["targetLaunchMonths", "Target launch (months)"]] as const).map(([k, label]) => (
            <label key={k} className="space-y-1 text-xs font-medium">
              {label}
              <input className={field} inputMode="decimal" value={val(k)} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <label className="space-y-1 text-xs font-medium">
            Preferred language
            <select className={field} value={val("language")} onChange={(e) => set("language", e.target.value)}>
              <option value="">Not stated</option>
              {LANGUAGES.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Add a note
            <input className={field} value={vals.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder="Anything else they told you" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} className="size-4" />
          {d.appId} has withdrawn
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={apply}>Apply and show what changed</Button>
      </div>
    </details>
  );
}

// ---------- Sent to partner (locks) ----------

export function SentControl({ d }: { d: DecisionRecord }) {
  const { result, settings } = useWorkspace();
  const commit = useStore((s) => s.commit);
  if (d.locked) return <Pill tone="info"><Lock aria-hidden className="mr-1 size-3" /> Sent to partner on {formatDate(d.locked.date)}</Pill>;
  if ((d.status !== "APPROVED" && d.status !== "CONDITIONAL") || !d.pin) return null;
  const t = result.territories.find((x) => x.id === d.slotTerritoryId);
  if (!t) return null;
  return (
    <Button
      variant="outline"
      onClick={() =>
        commit({
          source: "lock",
          description: `Marked ${d.appId} as sent to the partner`,
          locks: [{ appKey: d.appKey, status: d.status, pin: d.pin!, territoryKey: t.key, date: settings.today }],
          directKeys: [d.appKey],
        })
      }
    >
      <Lock /> Mark as sent to partner
    </Button>
  );
}

// ---------- Human override ----------

const OVERRIDE_STATUSES: Exclude<Status, "REDIRECT">[] = ["APPROVED", "CONDITIONAL", "HOLD", "WAITLIST", "REJECT"];

export function OverrideButton({ d }: { d: DecisionRecord }) {
  const { session } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Exclude<Status, "REDIRECT">>(OVERRIDE_STATUSES.find((s) => s !== d.status) ?? "WAITLIST");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = (confirmed?: string[]): ChangeSpec => {
    const o: HumanOverride = { appKey: d.appKey, status, reason: reason.trim(), time: new Date().toISOString(), ...(confirmed ? { confirmedBumps: confirmed } : {}) };
    return { source: "override", description: `Override: ${d.appId} set to ${STATUS_META[status].label}. Reason: ${reason.trim()}`, overrides: [o], directKeys: [d.appKey] };
  }

  function review() {
    setError(null);
    if (reason.trim().length < 5) {
      setError("Give a reason, so the override can be explained later.");
      return;
    }
    const p = previewChange(session, spec(), new Date().toISOString());
    const blocked = p.rejected.find((r) => r.appKey === d.appKey);
    if (blocked) {
      setPreview(null);
      setError(blocked.message);
      return;
    }
    if (p.pending.length === 0) {
      apply([]);
      return;
    }
    setPreview(p);
  }

  function apply(confirmed: string[]) {
    const out = commit(spec(confirmed));
    if (out.ok) {
      setOpen(false);
      setPreview(null);
      setReason("");
    } else setError(out.message);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ShieldAlert /> Override
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Override the decision for {d.appId}</DialogTitle>
            <DialogDescription>A person is overruling the rules. It is logged and labelled &ldquo;Human override&rdquo; everywhere. One store per pin still applies.</DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm font-medium">
            New decision
            <select className={field} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPreview(null); }}>
              {OVERRIDE_STATUSES.map((s) => (
                <option key={s} value={s} disabled={s === d.status && false}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Reason (required)
            <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="Why the rules are wrong here" maxLength={400} />
          </label>
          {preview && (
            <div role="alert" className="rounded-lg border border-st-hold-dot/50 bg-st-hold-bg p-3 text-sm text-st-hold">
              <p className="font-medium">Someone would lose their place</p>
              <p className="mt-1">{preview.pending[0].message}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {preview ? <Button onClick={() => apply(preview.pending[0].wouldBump)}>Confirm and apply</Button> : <Button onClick={review}>Review the effect</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- Disagree ----------

export function DisagreeButton({ d }: { d: DecisionRecord }) {
  const add = useStore((s) => s.addFeedback);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => { setOpen(true); setDone(false); }}>
        <MessageSquareWarning /> Disagree
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disagree with this decision</DialogTitle>
            <DialogDescription>Tell us why. It goes in the feedback log, which is part of the export. It doesn&apos;t change the decision; use Override for that.</DialogDescription>
          </DialogHeader>
          {done ? (
            <p role="status" className="text-sm">Thank you. Recorded in the feedback log.</p>
          ) : (
            <Textarea aria-label="Why you disagree" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={600} placeholder="What the tool got wrong" />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{done ? "Close" : "Cancel"}</Button>
            {!done && (
              <Button
                disabled={reason.trim().length < 3}
                onClick={() => {
                  add(d.appKey, d.appId, d.status, reason.trim());
                  setReason("");
                  setDone(true);
                }}
              >
                Record it
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

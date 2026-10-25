"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Panel, Pill, Section } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { BRAND_PROFILES } from "@/lib/policy/brandProfiles";
import { describeEdit, EDITABLE, readValue, validateEdit, validateEdits, policyChangeSentence, type EditableField, type PolicyEdit } from "@/lib/policy/edits";
import { effective } from "@/lib/state/session";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { DiffList } from "./diff-card";

const shown = (fld: EditableField, v: number) => String(Math.round(v * fld.scale * 100) / 100);
const GROUPS = ["Money", "Distance", "Deadlines", "Waitlist and training"] as const;

/**
 * Change the business numbers. Every change is checked, applied as one change-log entry (so it can be undone and
 * other viewers see it), and followed by what it did to the decisions. "Reset" puts every number back.
 */
export function PolicyEditor() {
  const { policy, session, settings } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; diff: Parameters<typeof DiffList>[0]["diff"] } | null>(null);

  const profile = policy.profile;
  const id = settings.profileId;
  const defaults = session.policy.id === id ? session.policy : BRAND_PROFILES[id];
  const edited = (effective(session).policyEdits[id] ?? []).length > 0;
  const dirty = Object.keys(draft).length > 0;

  function apply() {
    setFormError(null);
    const errs: Record<string, string> = {};
    const edits: PolicyEdit[] = [];
    for (const [path, raw] of Object.entries(draft)) {
      const fld = EDITABLE.find((e) => e.path === path)!;
      const n = raw.trim() === "" ? NaN : Number(raw);
      const value = Number.isFinite(n) ? n / fld.scale : NaN;
      const problem = validateEdit(path, Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value);
      if (problem) errs[path] = problem;
      else if (Math.abs(value - readValue(profile, path)) > 1e-9) edits.push({ path, value: Math.round(value * 1e6) / 1e6 });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!edits.length) {
      setDraft({});
      return;
    }
    const together = validateEdits(profile, edits);
    if (together) {
      setFormError(together);
      return;
    }
    const what = edits.map((e) => describeEdit(profile, e)).join("; ");
    const out = commit({ source: "policy", description: `Changed assumptions (${profile.label}): ${what}`.slice(0, 480), policy: { profileId: id, edits } });
    if (!out.ok) {
      setFormError(out.message);
      return;
    }
    setDraft({});
    setResult({ text: policyChangeSentence(what, out.diff), diff: out.diff });
  }

  function reset() {
    const out = commit({ source: "policy", description: `Reset the ${profile.label} assumptions to their defaults`, policy: { profileId: id, reset: true } });
    if (!out.ok) {
      setFormError(out.message);
      return;
    }
    setDraft({});
    setErrors({});
    setFormError(null);
    setResult({ text: policyChangeSentence("the assumptions back to their defaults", out.diff).replace("Changing the assumptions back to their defaults", "Resetting the assumptions"), diff: out.diff });
  }

  return (
    <Section
      title="Change the assumptions"
      hint={`These numbers are for the ${profile.label} profile. Each change is checked, shows what it did to the decisions, and can be undone in the Change log.`}
      action={
        edited ? (
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw /> Reset to defaults
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {GROUPS.map((g) => (
          <Panel key={g} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</h4>
            {EDITABLE.filter((f) => f.group === g).map((fld) => {
              const cur = readValue(profile, fld.path);
              const def = readValue(defaults, fld.path);
              const value = draft[fld.path] ?? shown(fld, cur);
              const err = errors[fld.path];
              return (
                <div key={fld.path}>
                  <label htmlFor={`pe-${fld.path}`} className="text-sm font-medium">
                    {fld.label}
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      id={`pe-${fld.path}`}
                      type="number"
                      inputMode="decimal"
                      step={fld.step}
                      value={value}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `pe-err-${fld.path}` : undefined}
                      onChange={(e) => setDraft((d) => ({ ...d, [fld.path]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && apply()}
                      className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-sm tabular-nums aria-[invalid=true]:border-destructive"
                    />
                    <span className="text-xs text-muted-foreground">{fld.unit}</span>
                    {Math.abs(cur - def) > 1e-9 ? <Pill tone="info">Changed from {shown(fld, def)}</Pill> : <span className="text-xs text-muted-foreground">default</span>}
                  </div>
                  {err && (
                    <p id={`pe-err-${fld.path}`} role="alert" className="mt-1 text-xs text-destructive">
                      {err}
                    </p>
                  )}
                </div>
              );
            })}
          </Panel>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={apply} disabled={!dirty}>
          Apply changes
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              setErrors({});
              setFormError(null);
            }}
          >
            Discard
          </Button>
        )}
      </div>
      {formError && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}
      {result && (
        <Panel className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm font-medium">{result.text}</p>
          {result.diff.changes.length > 0 && <DiffList diff={result.diff} max={8} />}
        </Panel>
      )}
    </Section>
  );
}

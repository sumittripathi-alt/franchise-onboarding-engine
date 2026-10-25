"use client";

import { ChevronLeft, ChevronRight, FileText, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/app/ui-bits";
import { StatusChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { REASON_TEXT } from "@/lib/engine/reasons";
import { draftPartnerMessage } from "@/lib/insights/messages";
import { drawerIn, useMotion } from "@/lib/motion";
import { formatDate } from "@/lib/planner/dates";
import { useStore } from "@/lib/state/store";
import type { DecisionRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";
import { DisagreeButton, FactForm, OverrideButton, SentControl } from "./decision-controls";
import { DiffList } from "./diff-card";
import { DraftMessageDialog } from "./draft-message";
import { LastChangeCard } from "./last-change";
import { useFiltered } from "./filter-bar";
import { OnboardingTimeline } from "./timeline";

const BAND_TEXT = {
  space: { 3: "Space is ready and suitable", 2: "Space has a fixable issue", 1: "No space yet" },
  capital: { 3: "At least 120% of the minimum", 2: "Meets the minimum", 1: "Below the minimum, so proof of funds" },
  experience: { 3: "3 or more years of relevant experience", 2: "Some business experience", 1: "No business experience" },
} as const;

function Bands({ d }: { d: DecisionRecord }) {
  if (!d.bands) return <p className="text-sm text-muted-foreground">Not scored: some details are missing.</p>;
  const rows = (["space", "capital", "experience"] as const).map((k) => ({ k, v: d.bands![k] }));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(({ k, v }) => (
        <li key={k} className="flex items-center gap-3">
          <span className="w-24 capitalize text-muted-foreground">{k}</span>
          <span aria-hidden className="flex gap-0.5">
            {[1, 2, 3].map((i) => (
              <span key={i} className={cn("h-2 w-5 rounded-sm", i <= v ? "bg-accent-brand" : "bg-muted")} />
            ))}
          </span>
          <span>
            <span className="tabular-nums font-medium">{v} of 3</span> <span className="text-muted-foreground">· {BAND_TEXT[k][v]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Detail({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        {title}
        <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 border-t px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

function DrawerBody({ d }: { d: DecisionRecord }) {
  const { session, settings, languages, result } = useWorkspace();
  const focus = useStore((s) => s.drawerFocus);
  const lastChangeId = useStore((s) => s.lastChangeId);
  const [msg, setMsg] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useMotion(() => drawerIn(bodyRef.current), { scope: bodyRef, dependencies: [d.appKey] });
  // After a change made here, bring "what changed" into view.
  useEffect(() => {
    if (lastChangeId) document.getElementById("last-change-inline")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [lastChangeId]);
  const history = session.entries.filter((e) => !e.undone && e.diff.changes.some((c) => c.appKey === d.appKey));
  const feedback = session.feedback.filter((f) => f.appKey === d.appKey);
  const language = languages[d.appKey] ?? "English";

  return (
    <div ref={bodyRef} className="space-y-4 px-4 pb-8 pt-3">
      <LastChangeCard inline />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={d.status} label={d.label} size="lg" />
          {d.override && <Pill tone="warn">Human override</Pill>}
          <SentControl d={d} />
        </div>
        <p className="text-base font-medium text-pretty">{d.headline}</p>
        <div className="flex flex-wrap gap-1.5">
          {d.reasonCodes.slice(0, 8).map((c) => (
            <Pill key={c}>{REASON_TEXT[c]}</Pill>
          ))}
        </div>
      </div>

      <section className="rounded-xl border border-accent-brand/30 bg-accent p-4 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What would change this</h4>
        <p className="mt-1">{d.counterfactual}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The partner does next</h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            {d.partnerSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your team does next</h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            {d.teamSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      </div>

      {d.suggestions.length > 0 && (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">A suggestion for the partner</h4>
          {d.suggestions.map((s) => (
            <p key={s} className="mt-1">{s}</p>
          ))}
        </section>
      )}

      {d.questions.length > 0 && (
        <section className="rounded-xl border border-st-hold-dot/40 bg-st-hold-bg p-4 text-sm text-st-hold">
          <h4 className="text-xs font-semibold uppercase tracking-wider">Questions to ask</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {d.conditions.length > 0 && (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conditions</h4>
          <ul className="mt-2 divide-y">
            {d.conditions.map((c) => (
              <li key={c.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-medium">{c.text}</p>
                <p className="text-xs text-muted-foreground">
                  {c.owner === "team" ? "Your team" : "The partner"} · by <span className="tabular-nums">{formatDate(c.deadline)}</span> · {c.ifMissed}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMsg(true)}>
          <FileText /> Draft partner message
        </Button>
        <OverrideButton d={d} />
        <DisagreeButton d={d} />
      </div>
      {msg && <DraftMessageDialog open onOpenChange={(o) => !o && setMsg(false)} title={`Message for ${d.name}`} text={draftPartnerMessage(d)} language={language} appKey={d.appKey} />}

      <FactForm key={`${d.appKey}-${focus}`} d={d} defaultOpen={focus === "fact"} />

      <Detail title="Why, in full" defaultOpen>
        <p className="text-pretty">{d.explanation}</p>
        {d.evidence.length > 0 && (
          <ul className="space-y-1.5">
            {d.evidence.map((e, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2">
                <Quote aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {/* Applicant text is always shown as plain text (G6.3). */}
                <span>
                  The applicant wrote: &ldquo;{e.quote}&rdquo; <span className="text-xs text-muted-foreground">({e.code})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.aiReading && (
          <p className="text-xs text-muted-foreground">
            Notes read by {d.aiReading.model} on {formatDate(d.aiReading.at.slice(0, 10))}. Only quotes the model could point to in the applicant&apos;s own words were used.
          </p>
        )}
      </Detail>

      {d.competitors.length > 0 && (
        <Detail title={`Who else was in the running (${d.competitors.length})`}>
          <ul className="space-y-2">
            {d.competitors.map((c, i) => (
              <li key={i}>
                <p className="font-medium">
                  {c.appId}{" "}
                  <span className="font-normal text-muted-foreground">
                    {c.relation === "pin" ? "wanted the same pin" : c.relation === "slot" ? "competes for a slot" : "was offered the last free location"}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {c.won ? "This application came out ahead because " : "They came out ahead because "}
                  {c.firstDifferingFactor}.
                </p>
              </li>
            ))}
          </ul>
        </Detail>
      )}

      <Detail title="How it scored">
        <Bands d={d} />
        <p className="text-xs text-muted-foreground">Territory priority decides which territory fills first. It never decides who ranks higher. Names and languages are never used.</p>
      </Detail>

      {(d.cannibalisation || d.payback || d.launch) && (
        <Detail title="Location, payback and timing">
          {d.cannibalisation && <p>{d.cannibalisation.note}</p>}
          {d.payback && (
            <p>
              Estimated payback about <span className="tabular-nums">{Math.round(d.payback.months)}</span> months: ₹{d.payback.basisLakh} lakh standard investment, ₹{d.payback.monthlyRevenueLakh} lakh monthly revenue, {Math.round(d.payback.margin * 100)}% margin.
            </p>
          )}
          {d.flags.filter((f) => ["TARGET_NOT_FEASIBLE", "TIGHT_TIMELINE", "NOTES_TARGET_DISAGREE", "RENT_BURDEN_RISK"].includes(f.code)).map((f) => (
            <p key={f.code}>{f.text}</p>
          ))}
        </Detail>
      )}

      {d.onboarding && (
        <Detail title="Onboarding plan">
          <OnboardingTimeline plan={d.onboarding} today={settings.today} />
        </Detail>
      )}

      {d.training && (
        <Detail title="Training plan">
          <p>
            <strong>{d.training.track}</strong> track ({d.training.trackReason}): {d.training.days} days, {d.training.format}, in <strong>{d.training.language}</strong>.
          </p>
          <p className="text-muted-foreground">
            {formatDate(d.training.start)} to {formatDate(d.training.end)}
            {d.training.shifted && ` · ${d.training.shifted.text}`}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {d.training.modules.map((m) => (
              <li key={m.name}>
                {m.name}
                {m.note && <span className="text-muted-foreground"> ({m.note})</span>}
              </li>
            ))}
          </ul>
          {d.training.staffingNote && <p>{d.training.staffingNote}</p>}
          {d.training.storeManagerAttends && <p>The named store manager attends every module too.</p>}
          {d.training.shadow && (
            <p>
              <strong>Shadowing:</strong> {d.training.shadow.days} days at {d.training.shadow.storeId}, {d.training.shadow.storeCity} (pin {d.training.shadow.pin}
              {d.training.shadow.km !== null ? `, ${d.training.shadow.km} km away` : ""}): {d.training.shadow.note}.
            </p>
          )}
          {d.training.teamPreparation && (
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="font-medium">{d.training.teamPreparation.heading}</p>
              <p className="mt-1">{d.training.teamPreparation.text}</p>
            </div>
          )}
          {d.training.cohortId && (
            <p>
              <strong>Cohort:</strong> {result.cohorts.find((c) => c.id === d.training!.cohortId)?.label}
            </p>
          )}
          <p className="text-muted-foreground">
            Readiness check before launch: {d.training.readinessCheck.map((r) => `${r.item} by ${formatDate(r.due)}`).join("; ")}.
          </p>
        </Detail>
      )}

      <Detail title="History">
        {history.length === 0 && feedback.length === 0 && !d.locked && !d.override ? (
          <p className="text-muted-foreground">No changes yet. This is the decision from the uploaded data.</p>
        ) : (
          <div className="space-y-3">
            {d.locked && <p>Sent to the partner on {formatDate(d.locked.date)}. It can&apos;t be displaced by later changes.</p>}
            {d.override && <p>Human override to {d.override.status}: {d.override.reason}</p>}
            {history.map((e) => {
              const c = e.diff.changes.find((x) => x.appKey === d.appKey)!;
              return (
                <p key={e.id}>
                  <span className="tabular-nums text-muted-foreground">{e.time.slice(0, 16).replace("T", " ")}</span> · {e.description}
                  {c.fromLabel && c.toLabel && c.fromLabel !== c.toLabel ? `: ${c.fromLabel} → ${c.toLabel}` : ""}
                </p>
              );
            })}
            {feedback.map((f) => (
              <p key={f.id}>Disagreed: {f.reason}</p>
            ))}
          </div>
        )}
        {history.length > 0 && <DiffList diff={history[history.length - 1].diff} max={4} />}
      </Detail>
    </div>
  );
}

export function Drawer() {
  const { decisionByKey } = useWorkspace();
  const key = useStore((s) => s.drawerKey);
  const openDrawer = useStore((s) => s.openDrawer);
  const { filtered } = useFiltered();
  const d = key ? decisionByKey.get(key) : null;
  const idx = d ? filtered.findIndex((x) => x.appKey === d.appKey) : -1;
  const prev = idx > 0 ? filtered[idx - 1] : null;
  const next = idx >= 0 && idx < filtered.length - 1 ? filtered[idx + 1] : null;

  return (
    <Sheet open={!!d} onOpenChange={(o) => !o && openDrawer(null)}>
      <SheetContent data-animate="drawer" className="w-full gap-0 overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
        {d && (
          <>
            <SheetHeader className="sticky top-0 z-10 border-b bg-popover pb-3">
              <div className="flex items-center justify-between gap-2 pr-8">
                <SheetTitle className="text-base">
                  {d.appId} <span className="font-normal text-muted-foreground">· {d.name}</span>
                </SheetTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Previous application" disabled={!prev} onClick={() => prev && openDrawer(prev.appKey)}>
                    <ChevronLeft />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Next application" disabled={!next} onClick={() => next && openDrawer(next.appKey)}>
                    <ChevronRight />
                  </Button>
                </div>
              </div>
              <SheetDescription className="tabular-nums">
                {d.city ?? "No city"}
                {d.homePin ? ` · pin ${d.homePin}` : ""}
                {d.territoryId ? ` · ${d.territoryId}` : ""}
              </SheetDescription>
            </SheetHeader>
            <DrawerBody d={d} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

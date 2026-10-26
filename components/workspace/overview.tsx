"use client";

import { CalendarClock, ChevronRight, FileCheck2, Flag, Lightbulb, MapPinned, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import { Panel, Pill, Section } from "@/components/app/ui-bits";
import { STATUS_DOT, StatusChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND_LABEL, type ActionItem } from "@/lib/insights/actions";
import { fillSlots, useMotion } from "@/lib/motion";
import { formatDate } from "@/lib/planner/dates";
import { useStore } from "@/lib/state/store";
import { STATUSES, type Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";
import { DecisionDonut, PortfolioGantt } from "./charts";
import { DataCheckPanel } from "./data-check";
import { DraftMessageDialog } from "./draft-message";

export function Overview() {
  const { insights, result, policy, settings } = useWorkspace();
  const setFilters = useStore((s) => s.setFilters);
  const setTab = useStore((s) => s.setTab);
  const [checkOpen, setCheckOpen] = useState(false);

  const labelOf = (s: Status) => result.decisions.find((d) => d.status === s)?.label;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            {insights.total} applications, as of {formatDate(settings.today)}, for the {policy.profile.label.toLowerCase()} ({policy.profile.styleHint}).
          </p>
        </div>
        <Button variant="outline" onClick={() => setCheckOpen(true)}>
          <FileCheck2 /> View data check
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
        <DecisionDonut />
        <section aria-label="Decisions by outcome" className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3">
          {STATUSES.map((s) => (
            <button
              key={s}
              className="min-w-0 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent"
              onClick={() => {
                setFilters({ status: s });
                setTab("applications");
              }}
              aria-label={`${insights.statusCounts[s]} ${labelOf(s) ?? s}. Show them.`}
            >
              <p className="text-2xl font-semibold tabular-nums">{insights.statusCounts[s]}</p>
              <StatusChip status={s} label={labelOf(s) ?? undefined} className="mt-1 max-w-full whitespace-normal" />
            </button>
          ))}
        </section>
      </div>

      <PortfolioGantt />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <ActionQueuePanel />
          <SlotBars />
        </div>
        <div className="space-y-8">
          <InsightsPanel />
          <TopFlags />
          <ProfileCard />
        </div>
      </div>

      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Data check</DialogTitle>
          </DialogHeader>
          <DataCheckPanel />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Action queue (SPEC §15.2) ----------

export function ActionQueuePanel() {
  const { actions, settings } = useWorkspace();
  const openDrawer = useStore((s) => s.openDrawer);
  const [draft, setDraft] = useState<ActionItem | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? actions : actions.slice(0, 8);

  return (
    <Section title="What the team should do next" hint="Most urgent first. Each item has an owner, a due date and, where it helps, a draft message.">
      {actions.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">Nothing is waiting on the team.</Panel>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {shown.map((a) => {
            const overdue = a.due < settings.today;
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Pill>{KIND_LABEL[a.kind]}</Pill>
                    {a.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Owner: {a.owner} · <span className={cn(overdue && "font-medium text-destructive")}>Due {formatDate(a.due)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {a.appKeys[0] && (
                    <Button variant="ghost" size="sm" onClick={() => openDrawer(a.appKeys[0])}>
                      Open
                    </Button>
                  )}
                  {a.draft && (
                    <Button variant="outline" size="sm" onClick={() => setDraft(a)}>
                      Draft message
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {actions.length > 8 && (
        <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${actions.length}`}
        </Button>
      )}
      {draft && (
        <DraftMessageDialog open onOpenChange={(o) => !o && setDraft(null)} title={draft.title} text={draft.draft ?? ""} language={draft.language} appKey={draft.appKeys[0]} />
      )}
    </Section>
  );
}

// ---------- Slot bars ----------

export function SlotBars() {
  const { result, board } = useWorkspace();
  const setTab = useStore((s) => s.setTab);
  const ref = useRef<HTMLUListElement>(null);
  const prev = useRef<Record<string, string> | null>(null);
  // What each slot looks like now; slots that changed since the last run fill in again.
  const states: Record<string, string> = {};
  for (const t of result.territories) for (let i = 0; i < Math.max(t.slots, t.reserved.length); i++) states[`${t.key}:${i}`] = t.reserved[i]?.status ?? "open";
  const signature = JSON.stringify(states);
  useMotion(
    () => {
      const before = prev.current;
      prev.current = states;
      if (!before || !ref.current) return;
      const changed = Object.keys(states).filter((k) => before[k] !== states[k]);
      fillSlots(changed.flatMap((k) => [...ref.current!.querySelectorAll<HTMLElement>(`[data-slot="${CSS.escape(k)}"]`)]));
    },
    { scope: ref, dependencies: [signature] },
  );
  return (
    <Section title="Slots by territory" hint="Each square is one slot: filled when reserved, open when free.">
      <ul ref={ref} className="grid gap-3 sm:grid-cols-2">
        {result.territories.map((t) => {
          const b = board.find((x) => x.id === t.id)!;
          const cells = Math.max(t.slots, t.reserved.length);
          return (
            <li key={t.key} className="rounded-xl border bg-card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {t.id} <span className="font-normal text-muted-foreground">{t.city}</span>
                </p>
                <Pill>{t.priority}</Pill>
              </div>
              <div data-animate="slot-bar" className="mt-2 flex flex-wrap gap-1" role="img" aria-label={`${t.id}: ${t.reserved.length} of ${t.slots} slots reserved`}>
                {cells === 0 && <span className="text-xs text-muted-foreground">No open slots</span>}
                {Array.from({ length: cells }, (_, i) => {
                  const r = t.reserved[i];
                  return <span key={i} data-slot={`${t.key}:${i}`} title={r ? `${r.appId}` : "Open"} className={cn("h-3 w-6 origin-left rounded-sm border", r ? cn("border-transparent", STATUS_DOT[r.status]) : "border-dashed border-muted-foreground/50")} />;
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                {t.reserved.length} of {t.slots} reserved · {b.free} open · {b.waitlist.length} waiting
                {t.whiteSpacePins.length > 0 && ` · ${t.whiteSpacePins.length} pins to recruit for`}
              </p>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" onClick={() => setTab("territories")}>
        Territory boards <ChevronRight />
      </Button>
    </Section>
  );
}

// ---------- Insights ----------

export function InsightsPanel() {
  const { insights } = useWorkspace();
  const setTab = useStore((s) => s.setTab);
  const setFilters = useStore((s) => s.setFilters);

  const rows: { icon: React.ReactNode; title: string; text: string; onClick?: () => void }[] = [
    ...insights.oversubscribed.map((i) => ({ icon: <TrendingUp aria-hidden className="size-4" />, title: "Oversubscribed", text: i.text, onClick: () => setTab("territories") })),
    ...insights.emptySlots.map((i) => ({ icon: <MapPinned aria-hidden className="size-4" />, title: "Slots with no applicants", text: i.text, onClick: () => setTab("territories") })),
    ...(insights.topHoldReason ? [{ icon: <Flag aria-hidden className="size-4" />, title: "Most common hold", text: insights.topHoldReason.text, onClick: () => { setFilters({ status: "HOLD" }); setTab("applications"); } }] : []),
    ...(insights.contradictions ? [{ icon: <Flag aria-hidden className="size-4" />, title: "Contradictions", text: insights.contradictions.text }] : []),
    ...(insights.outsideTerritory ? [{ icon: <MapPinned aria-hidden className="size-4" />, title: "Outside every territory", text: insights.outsideTerritory.text }] : []),
    ...insights.saturation.map((s) => ({ icon: <CalendarClock aria-hidden className="size-4" />, title: "City saturation", text: s.text })),
    ...(insights.untappedDemand ? [{ icon: <Lightbulb aria-hidden className="size-4" />, title: "Untapped demand", text: insights.untappedDemand.text }] : []),
  ];

  return (
    <Section title="What stands out" hint="Worked out by rules from your data, not by AI.">
      {rows.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">Nothing unusual in this pool.</Panel>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="rounded-xl border bg-card p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <span className="text-accent-brand">{r.icon}</span> {r.title}
              </p>
              <p className="mt-1 text-muted-foreground">{r.text}</p>
              {r.onClick && (
                <Button variant="link" size="sm" className="mt-1 h-auto p-0" onClick={r.onClick}>
                  Look
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TopFlags() {
  const { insights } = useWorkspace();
  const setFilters = useStore((s) => s.setFilters);
  const setTab = useStore((s) => s.setTab);
  if (insights.topFlags.length === 0) return null;
  return (
    <Section title="Top flags">
      <ul className="flex flex-wrap gap-2">
        {insights.topFlags.map((f) => (
          <li key={f.code}>
            <button
              className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-accent"
              onClick={() => {
                setFilters({ flag: f.code });
                setTab("applications");
              }}
            >
              {f.text} <span className="tabular-nums text-muted-foreground">{f.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ProfileCard() {
  const { policy } = useWorkspace();
  const setTab = useStore((s) => s.setTab);
  const p = policy.profile;
  return (
    <Section title="Active brand type">
      <Panel className="space-y-2 text-sm">
        <p className="font-medium">
          {p.label} <span className="font-normal text-muted-foreground">({p.styleHint})</span>
        </p>
        <p className="text-muted-foreground">{p.description}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Minimum investment ₹{p.minInvestmentLakh["Tier 1"]} / {p.minInvestmentLakh["Tier 2"]} / {p.minInvestmentLakh["Tier 3"]} lakh (Tier 1 / 2 / 3). Every number is an assumption.
        </p>
        <Button variant="outline" size="sm" onClick={() => setTab("policy")}>
          See the assumptions
        </Button>
      </Panel>
    </Section>
  );
}

"use client";

import { EmptyState, Pill } from "@/components/app/ui-bits";
import { StatusChip } from "@/components/app/status-chip";
import type { BoardPin, PinState } from "@/lib/insights/board";
import { useStore } from "@/lib/state/store";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";

const PIN_STYLE: Record<PinState, { label: string; box: string }> = {
  store: { label: "Existing store", box: "border-st-waitlist-dot bg-st-waitlist-bg text-st-waitlist" },
  reserved: { label: "Reserved", box: "border-st-approved-dot bg-st-approved-bg text-st-approved" },
  contested: { label: "Contested", box: "border-st-hold-dot bg-st-hold-bg text-st-hold" },
  free: { label: "Free", box: "border-dashed border-muted-foreground/50 bg-background text-foreground" },
  unavailable: { label: "Unavailable", box: "border-st-reject-dot/50 bg-st-reject-bg text-st-reject" },
};

function PinBox({ pin }: { pin: BoardPin }) {
  const openDrawer = useStore((s) => s.openDrawer);
  const { decisionById } = useWorkspace();
  const s = PIN_STYLE[pin.state];
  const holder = pin.holder ? decisionById.get(pin.holder.appId) : null;
  return (
    <li className={cn("rounded-lg border p-2.5 text-xs", s.box)}>
      <p className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{pin.pin}</span>
        <span className="font-medium">{s.label}</span>
      </p>
      <p className="mt-1 opacity-90">{pin.text}</p>
      {pin.confidence !== "high" && pin.confidence !== "medium" && pin.state !== "store" && (
        <p className="mt-1 opacity-80">Location uncertain</p>
      )}
      {(holder || pin.contenders.length > 0) && (
        <p className="mt-1.5 flex flex-wrap gap-x-2">
          {(holder ? [holder.appId] : pin.contenders.map((c) => c.appId)).map((id) => {
            const d = decisionById.get(id);
            return (
              <button key={id} className="font-medium underline-offset-2 hover:underline" onClick={() => d && openDrawer(d.appKey)}>
                {id}
              </button>
            );
          })}
        </p>
      )}
    </li>
  );
}

/** One board per territory: its pins by state, winners, waitlist and white space (SPEC §10.1). */
export function Territories() {
  const { board, decisionById } = useWorkspace();
  const openDrawer = useStore((s) => s.openDrawer);
  if (board.length === 0) return <EmptyState title="No territories in this file">Every application is outside the current plan.</EmptyState>;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Territories</h2>
        <p className="text-sm text-muted-foreground">Each territory&apos;s pins, who holds them, and who is waiting.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {board.map((t) => (
          <section key={t.id} aria-labelledby={`t-${t.id}`} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`t-${t.id}`} className="font-semibold">
                {t.id} <span className="font-normal text-muted-foreground">{t.city} · {t.tier}</span>
              </h3>
              <div className="flex gap-1.5">
                <Pill>{t.priority} priority</Pill>
                <Pill tone={t.free > 0 ? "info" : "neutral"}>
                  {t.reserved} of {t.slots} slot{t.slots === 1 ? "" : "s"} reserved
                </Pill>
              </div>
            </div>
            {t.blocked && <p className="mt-2 text-sm text-destructive">This territory&apos;s ID is used twice, so it isn&apos;t used until that is fixed.</p>}
            {t.overCommitted && <p className="mt-2 text-sm text-st-hold">More partners were sent a decision than there are slots now. They keep their slots.</p>}

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {t.pins.map((p) => (
                <PinBox key={p.pin} pin={p} />
              ))}
            </ul>

            {t.whiteSpace.length > 0 && (
              <p className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm">
                <strong>Recruit here:</strong> {t.free} free slot{t.free === 1 ? "" : "s"} and no applicants for pin{t.whiteSpace.length === 1 ? "" : "s"} {t.whiteSpace.join(", ")}.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Winners</h4>
                {t.winners.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {t.winners.map((w) => {
                      const d = decisionById.get(w.appId)!;
                      return (
                        <li key={w.appId} className="flex flex-wrap items-center gap-2">
                          <button className="font-medium underline-offset-2 hover:underline" onClick={() => openDrawer(d.appKey)}>
                            {w.appId}
                          </button>
                          <span className="text-muted-foreground tabular-nums">pin {w.pin}</span>
                          <StatusChip status={d.status} label={w.label} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Waiting for this territory</h4>
                {t.waitlist.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Nobody.</p>
                ) : (
                  <ol className="mt-1.5 space-y-1 text-sm">
                    {t.waitlist.map((w) => (
                      <li key={w.appId}>
                        <button className="font-medium underline-offset-2 hover:underline" onClick={() => openDrawer(decisionById.get(w.appId)!.appKey)}>
                          {w.appId}
                        </button>{" "}
                        <span className="text-muted-foreground tabular-nums">#{w.rank} in {t.city}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

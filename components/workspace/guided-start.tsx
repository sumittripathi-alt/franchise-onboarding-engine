"use client";

import { ArrowLeftRight, Lightbulb, Pencil, PhoneCall, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";

/** Four one-click suggestions on first load (SPEC §15.1). */
export function GuidedStart() {
  const { result, session } = useWorkspace();
  const setFilters = useStore((s) => s.setFilters);
  const openDrawer = useStore((s) => s.openDrawer);
  const setTab = useStore((s) => s.setTab);
  const dismissed = useStore((s) => s.guidedDismissed);
  const dismiss = useStore((s) => s.dismissGuided);
  if (dismissed || session.entries.length > 0) return null;

  const holds = result.decisions.filter((d) => d.status === "HOLD").length;
  const contest = result.decisions.find((d) => d.competitors.some((c) => c.relation === "pin"));
  const fixable = result.decisions.find((d) => d.status !== "REJECT" && d.status !== "HOLD" && d.bands?.space === 1 && d.conditions.some((c) => c.source === "SPACE_NOT_IDENTIFIED")) ??
    result.decisions.find((d) => d.status === "WAITLIST" && d.bands?.space === 1);

  const cards = [
    { icon: PhoneCall, title: "See who's on hold and why", text: `${holds} application${holds === 1 ? "" : "s"} need an answer before a decision.`, onClick: () => setFilters({ status: "HOLD" }), disabled: holds === 0 },
    { icon: ArrowLeftRight, title: "Compare two competing applicants", text: contest ? `Open ${contest.appId} and see who beat whom for the same pin.` : "No two applicants share a pin here.", onClick: () => contest && openDrawer(contest.appKey), disabled: !contest },
    { icon: Pencil, title: "Give a new fact", text: fixable ? `Say ${fixable.appId} found a shop and watch the decisions move.` : "Update any application and watch the decisions move.", onClick: () => fixable && openDrawer(fixable.appKey, "fact"), disabled: !fixable },
    { icon: Lightbulb, title: "Switch the brand type", text: "See how the same applicants fare for a delivery centre or a partner point.", onClick: () => setTab("policy"), disabled: false },
  ];

  return (
    <section aria-label="Suggestions to get started" className="no-print rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Where to start</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide suggestions"
          onClick={dismiss}
        >
          <X />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.title}
            onClick={c.onClick}
            disabled={c.disabled}
            className="rounded-lg border bg-background p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <c.icon aria-hidden className="size-4 text-accent-brand" /> {c.title}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{c.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

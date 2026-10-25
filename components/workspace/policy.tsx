"use client";

import { RotateCcw } from "lucide-react";
import { Panel, Pill, Section } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { STEP_ASSUMPTIONS } from "@/lib/planner/onboarding";
import { BRAND_PROFILES } from "@/lib/policy/brandProfiles";
import type { SpaceRule, BrandProfile, BrandProfileId } from "@/lib/policy/types";
import { formatDate, isIsoDate, todayIST } from "@/lib/planner/dates";
import { useStore } from "@/lib/state/store";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";

const ruleText = (r: SpaceRule) => (r.kind === "ok" ? "Accepted" : r.kind === "reject" ? `Rejected: ${r.text}` : `Condition: ${r.text}`);
const t3 = (v: { "Tier 1": number; "Tier 2": number; "Tier 3": number }, unit = "") => `${v["Tier 1"]} / ${v["Tier 2"]} / ${v["Tier 3"]}${unit}`;

function assumptions(p: BrandProfile): { label: string; value: string; why?: string }[] {
  const r = p.rationale;
  return [
    { label: "Minimum investment, Tier 1 / 2 / 3", value: `₹${t3(p.minInvestmentLakh)} lakh`, why: r.minInvestmentLakh },
    { label: "Hard floor (below this, not approved)", value: `${Math.round(p.hardFloorPct * 100)}% of the minimum`, why: r.hardFloorPct },
    { label: "Space: minimum, ideal range", value: `${p.space.minSqft} sq ft; ${p.space.idealMinSqft} to ${p.space.idealMaxSqft} sq ft`, why: r.space },
    { label: "Ground floor", value: ruleText(p.floorRules.Ground), why: r.floorRules },
    { label: "Mall unit", value: ruleText(p.floorRules["Mall unit"]) },
    { label: "Upper floor", value: ruleText(p.floorRules.Upper) },
    { label: "No space identified yet", value: ruleText(p.noSpaceRule), why: r.noSpaceRule },
    { label: "Counts as relevant experience", value: p.experienceKeywords.join(", ") },
    { label: "Cannibalisation inner radius, Tier 1 / 2 / 3", value: `${t3(p.cannibalisationRadiusKm)} km`, why: r.cannibalisationRadiusKm },
    { label: "Monthly revenue, Tier 1 / 2 / 3", value: `₹${t3(p.monthlyRevenueLakh)} lakh`, why: r.monthlyRevenueLakh },
    { label: "Partner margin", value: `${Math.round(p.partnerMargin * 100)}%`, why: r.partnerMargin },
    { label: "Payback warning threshold", value: `${p.paybackWarningMonths} months`, why: r.paybackWarningMonths },
    { label: "Fit-out, licences, hiring", value: `${p.leadTimes.fitOutDays} / ${p.leadTimes.licencesDays} / ${p.leadTimes.hiringDays} days`, why: r.leadTimes },
    { label: "Special hiring", value: p.specialHiring ?? "None", why: r.specialHiring },
    { label: "Base training", value: `${p.baseTrainingDays} days (${p.trainingFormat}); Fast-track ${p.trainingTrackAdjustDays["Fast-track"] >= 0 ? "+" : ""}${p.trainingTrackAdjustDays["Fast-track"]}, Extended +${p.trainingTrackAdjustDays.Extended}`, why: r.baseTrainingDays },
    { label: "Shadowing at an existing store (Fast-track / Standard / Extended)", value: `${p.shadowDays["Fast-track"]} / ${p.shadowDays.Standard} / ${p.shadowDays.Extended} days`, why: r.shadowDays },
    { label: "Team induction", value: p.teamInduction ? `${p.teamInduction.days} days for ${p.teamInduction.who.toLowerCase()}` : "None", why: r.teamInduction },
    { label: "Default target launch", value: `${p.defaultTargetLaunchMonths} months`, why: r.defaultTargetLaunchMonths },
    { label: "Condition deadlines", value: `${p.conditionDays.confirmDetails} days to confirm details, ${p.conditionDays.proofOfFunds} for proof of funds, ${p.conditionDays.storeManager} to name a manager, ${p.conditionDays.expansionSignOff} for sign-off`, why: r.conditionDays },
    { label: "Pre-onboarding", value: `Top ${p.preOnboarding.topN} per city waitlist, next in line first`, why: r.preOnboarding },
    { label: "Waitlist review", value: `Every ${p.waitlistReviewDays} days`, why: r.waitlistReviewDays },
  ];
}

export function PolicyPanel() {
  const { settings, policy, session } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const undo = useStore((s) => s.undo);
  const rows = assumptions(policy.profile);
  const hasSettingsChanges = session.entries.some((e) => !e.undone && e.set);

  function setProfile(id: BrandProfileId) {
    if (id === settings.profileId) return;
    commit({ source: "brand", description: `Switched the brand type to ${BRAND_PROFILES[id].label}`, set: { profileId: id } });
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Policy</h2>
        <p className="text-sm text-muted-foreground">Every business number here is an assumption, with the reason for it. Change the brand type or the date and every decision is worked out again.</p>
      </div>

      <Section title="Brand type" hint="The same applicants, judged against a different kind of store.">
        <div role="radiogroup" aria-label="Brand type" className="grid gap-3 md:grid-cols-3">
          {(Object.keys(BRAND_PROFILES) as BrandProfileId[]).map((id) => {
            const p = BRAND_PROFILES[id];
            const on = id === settings.profileId;
            return (
              <button
                key={id}
                role="radio"
                aria-checked={on}
                onClick={() => setProfile(id)}
                className={cn("rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent", on && "border-accent-brand ring-2 ring-accent-brand/30")}
              >
                <p className="font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.styleHint}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                {on && <Pill className="mt-2" tone="info">Active</Pill>}
              </button>
            );
          })}
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Today's date" hint="Deadlines and the earliest opening dates count from here. It starts as today in India.">
          <Panel className="flex flex-wrap items-center gap-3">
            <label htmlFor="today" className="sr-only">Today&apos;s date</label>
            <input
              id="today"
              type="date"
              value={settings.today}
              onChange={(e) => {
                if (isIsoDate(e.target.value) && e.target.value !== settings.today) {
                  commit({ source: "settings", description: `Set today's date to ${formatDate(e.target.value)}`, set: { today: e.target.value } });
                }
              }}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            />
            <Button variant="ghost" size="sm" onClick={() => commit({ source: "settings", description: "Reset today's date to the real date", set: { today: todayIST() } })}>
              Use the real date
            </Button>
          </Panel>
        </Section>

        <Section title="Template example rows" hint="The template's grey example row (APP-001, TER-01) is skipped unless you want it.">
          <Panel className="flex items-center justify-between gap-3">
            <label htmlFor="ex" className="text-sm">Include the example rows</label>
            <Switch
              id="ex"
              checked={settings.includeExample}
              disabled={!session.parsed.skippedExample.application && !session.parsed.skippedExample.territory}
              onCheckedChange={(on) =>
                commit({ source: "settings", description: on ? "Included the template's example rows" : "Skipped the template's example rows", set: { includeExample: on } })
              }
            />
          </Panel>
        </Section>
      </div>

      <Section
        title="Assumptions in use"
        hint="Editing these numbers arrives in a later phase. Today you can switch the brand type above."
        action={
          hasSettingsChanges ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => session.entries.filter((e) => !e.undone && e.set).forEach((e) => undo(e.id))}
            >
              <RotateCcw /> Reset to defaults
            </Button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Assumptions for the {policy.profile.label}</caption>
            <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Assumption</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Value</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.label} className="align-top">
                  <th scope="row" className="px-4 py-2.5 font-medium">{r.label}</th>
                  <td className="px-4 py-2.5 tabular-nums">{r.value}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.why ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Panel className="space-y-1 text-sm">
          <p className="font-medium">Rules that apply to every brand type</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>One store per pin code, across existing stores and new reservations.</li>
            <li>One slot per person.</li>
            <li>A decision marked as sent to the partner is never taken back by a later change.</li>
            {STEP_ASSUMPTIONS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Panel>
      </Section>
    </div>
  );
}

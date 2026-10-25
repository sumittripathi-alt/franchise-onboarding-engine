// Template partner messages (SPEC §15.9). Facts come only from the decision record, and the message never says
// "approved" unless the engine did. In Phase 6 an AI drafts these in the partner's own language; this is the
// deterministic English fallback.

import type { DecisionRecord } from "@/lib/types";

export const MACHINE_DRAFTED = "Machine-drafted. Review before sending.";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const strip = (s: string) => s.replace(/^(On hold|Not approved|Waitlisted[^:]*|Offered[^:]*):\s*/, "");

/** English message for a partner: the next three steps and their deadlines, nothing the engine didn't decide. */
export function draftPartnerMessage(d: DecisionRecord): string {
  const hi = `Hello ${firstName(d.name)}, thank you for applying (reference ${d.appId}).`;
  const steps = d.partnerSteps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join("\n");
  switch (d.status) {
    case "HOLD":
      return `${hi}\nWe can't decide yet: ${strip(d.headline).replace(/\.$/, "")}.\nCould you please help with:\n${d.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\nThis lets us move your application forward.`;
    case "REJECT":
      return `${hi}\nWe aren't able to approve this application: ${strip(d.headline).replace(/\.$/, "")}.\n${steps}\nWe'd be glad to hear from you again.`;
    case "WAITLIST":
      return `${hi}\nYour application is waitlisted. ${strip(d.headline).replace(/\.$/, "")}.\nWhat to do next:\n${steps}`;
    case "REDIRECT":
      return `${hi}\nWe can't offer your own pin, but we have another location for you: ${strip(d.headline).replace(/\.$/, "")}.\nWhat to do next:\n${steps}`;
    case "APPROVED":
    case "CONDITIONAL":
      return `${hi}\nYour application is ${d.label.toLowerCase()}: ${d.headline.replace(/\.$/, "")}.\nYour next steps:\n${steps}`;
  }
}

// The fast path (SPEC §15.6): common questions and statements are understood with patterns, instantly, with
// template answers, and the AI is only asked about everything else. This is also the whole chat when the AI is
// off or busy (G4.1, G4.2). Pure functions.

import { looksLikeInjection } from "@/lib/llm/guard";
import type { FieldChangeT, ToolCall, WhatIfChangeT } from "@/lib/llm/tools";
import { appNumbers, territoryNumbers, type Directory } from "./resolve";

export type FastRoute =
  | { kind: "call"; call: ToolCall }
  | { kind: "declined" }
  | { kind: "clarify"; text: string }
  | { kind: "confirm" }
  | { kind: "none" };

const STATUS_WORDS: [RegExp, NonNullable<Extract<ToolCall, { name: "list_applications" }>["args"]["status"]>][] = [
  [/\b(on[\s-]*hold|held|hold)\b/i, "HOLD"],
  [/\b(approved with conditions|conditionally approved|with conditions|conditional)\b/i, "CONDITIONAL"],
  [/\b(approved)\b/i, "APPROVED"],
  [/\b(wait[\s-]*listed|waitlist)\b/i, "WAITLIST"],
  [/\b(offered (?:another|a different) location|redirect(?:ed)?|offered)\b/i, "REDIRECT"],
  [/\b(not approved|rejected|reject|declined)\b/i, "REJECT"],
];

const num = (s: string) => Number(s.replace(/,/g, ""));

function lakhs(amount: string, unit: string | undefined): number {
  const n = num(amount);
  return /^(crore|cr)/i.test(unit ?? "") ? n * 100 : n;
}

const FLOOR_WORD = (w: string) => (/^ground/i.test(w) ? "Ground" : /^mall/i.test(w) ? "Mall unit" : "Upper");

/** Facts stated in a clause: several at once are fine ("a 600 sq ft ground-floor shop and can invest 30 lakh"). */
export function parseFacts(text: string): FieldChangeT[] {
  const out: FieldChangeT[] = [];
  const add = (c: FieldChangeT) => {
    if (!out.some((o) => o.field === c.field)) out.push(c);
  };

  // Space: "found a 600 sq ft ground floor shop", "has got an upper-floor space", "owns a shop".
  const space = /\b(found|got|secured|has|have|taken|rented|leased|owns?|identified|finali[sz]ed)\b[^.,;]{0,40}?\b(shop|space|premises|store|unit|place|showroom)\b/i.exec(text);
  const sqft = /(\d[\d,]{1,5})\s*(?:sq\.?\s*ft\.?|sqft|square\s*(?:feet|foot|ft))/i.exec(text);
  const floor = /\b(ground|upper|first|second|third|mall)[\s-]*(?:floor|unit)\b|\b(upstairs)\b/i.exec(text);
  if (space) {
    const owned = /\bown(s|ed)?\b/i.test(text);
    const rented = /\b(rent(s|ed)?|leas(e|ed|es)|tenant)\b/i.test(text);
    add(owned ? { field: "spaceAvailable", value: "Owned" } : rented ? { field: "spaceAvailable", value: "Rented" } : { field: "spaceAvailable", value: "Rented", assumed: true });
  }
  if (sqft) add({ field: "spaceSqft", value: num(sqft[1]) });
  if (floor) add({ field: "floor", value: floor[2] ? "Upper" : FLOOR_WORD(floor[1]) });

  // Money: "can now invest 30 lakh", "can invest 5 lakh more", "increased the budget by 10 lakh".
  const money = /(?:invest(?:ment)?|capital|budget|put in|bring|afford)\D{0,25}?(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|crores?|cr\b)?(\s*(?:more|extra|additional|higher|increase))?/i.exec(text);
  const by = /(?:increas\w+|rais\w+|add\w*)\b[^.]{0,25}?\bby\s+(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|crores?|cr\b)?/i.exec(text);
  if (by) add({ field: "investmentLakh", value: lakhs(by[1], by[2]), relative: true });
  else if (money) {
    const relative = !!money[3] || /\b(another|additional|extra)\b[^.]{0,12}$/i.test(text.slice(0, money.index));
    add(relative ? { field: "investmentLakh", value: lakhs(money[1], money[2]), relative } : { field: "investmentLakh", value: lakhs(money[1], money[2]) });
  }

  const exp = /(\d+(?:\.\d+)?)\s*(more\s+)?(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience/i.exec(text);
  if (exp) add(exp[2] ? { field: "experienceYears", value: num(exp[1]), relative: true } : { field: "experienceYears", value: num(exp[1]) });

  const launch = /(?:open|launch|start|go\s+live)\w*\D{0,25}?(?:in|within)\s+(\d+)\s*months?|target\s+launch\D{0,15}?(\d+)/i.exec(text);
  if (launch) add({ field: "targetLaunchMonths", value: num(launch[1] ?? launch[2]) });

  const lang = /\b(?:prefers?|speaks?|language\s+(?:is|to)|switch(?:ed)?\s+to|wants?\s+(?:everything\s+)?in)\s+(kannada|hindi|english)\b/i.exec(text);
  if (lang) add({ field: "language", value: lang[1][0].toUpperCase() + lang[1].slice(1).toLowerCase() });

  const move = /\b(?:moved|moving|relocat\w+|shifted|shifting)\s+to\s+([A-Za-z][A-Za-z-]{2,25})/i.exec(text);
  if (move) add({ field: "city", value: move[1] });
  const pin = /\bpin(?:\s*code)?\s*(?:is|to|now|:)?\s*(\d{6})\b/i.exec(text) ?? (move ? /\b(\d{6})\b/.exec(text) : null);
  if (pin) add({ field: "pin", value: pin[1] });
  return out;
}

function appRef(msg: string, dir: Directory, lastApp: string | null): string | null {
  const n = appNumbers(msg);
  if (n.length) return `APP-${n[0]}`;
  // A name from the file that appears as a whole word in the message.
  const tokens = new Set(msg.toLowerCase().split(/[^\p{L}]+/u).filter((t) => t.length >= 3));
  for (const a of dir.apps) {
    for (const t of a.name.toLowerCase().split(/\s+/)) if (t.length >= 3 && tokens.has(t)) return t;
  }
  if (/\b(her|his|their|she|he|they|that\s+(?:application|applicant|one|partner)|the\s+same)\b/i.test(msg) || /^(and|what about|how about)\b/i.test(msg.trim())) return lastApp;
  return null;
}

/** Two references in one message: "compare APP-7 and APP-12", "APP-7 vs Ravi". */
function twoRefs(msg: string, dir: Directory): [string, string] | null {
  const nums = appNumbers(msg);
  if (nums.length >= 2) return [`APP-${nums[0]}`, `APP-${nums[1]}`];
  const m = /(?:compare|between|vs\.?|versus)\s+(.+?)\s+(?:and|with|vs\.?|versus|to)\s+(.+?)[?.!]*$/i.exec(msg);
  if (m) return [m[1].trim(), m[2].trim()];
  void dir;
  return null;
}

const hasApp = (msg: string, dir: Directory, last: string | null) => appRef(msg, dir, last) !== null;

export function routeFast(rawMessage: string, dir: Directory, lastApp: string | null): FastRoute {
  const msg = rawMessage.replace(/\s+/g, " ").trim();
  if (!msg) return { kind: "none" };
  if (looksLikeInjection(msg)) return { kind: "declined" };
  if (/^(yes|yep|confirm|confirmed|go ahead|do it|proceed)[\s.!]*$/i.test(msg)) return { kind: "confirm" };

  const call = (c: ToolCall): FastRoute => ({ kind: "call", call: c });
  const terNums = territoryNumbers(msg);
  const hypothetical = /^(what\s+if|what\s+would\s+happen\s+if|suppose|supposing|imagine|if|would|could|can)\b/i.test(msg) && /\b(if|suppose|supposing|imagine|would|were|had)\b/i.test(msg);

  // Territory facts: "TER-02 now has 2 slots", "set TER-02 slots to 3", "TER-02 priority is High".
  if (terNums.length) {
    const slots = /(?:ter(?:ritory)?[\s-]*#?\s*0*\d+)\D{0,25}?(\d+)\s*(?:open\s+)?slots?|slots?\s*(?:to|=|at)\s*(\d+)/i.exec(msg);
    const prio = /priority\D{0,12}?(high|medium|low)\b/i.exec(msg);
    const ter = `TER-${terNums[0]}`;
    if (slots && /\b(now|has|have|had|got|set|change|make|to|only|just|opened|open|were|would)\b/i.test(msg) && !/\bhow many\b/i.test(msg)) {
      const change = { territory: ter, field: "openSlots" as const, value: num(slots[1] ?? slots[2]) };
      return hypothetical ? call({ name: "what_if", args: { changes: [change] } }) : call({ name: "apply_territory_fact", args: change });
    }
    if (prio && /\b(set|make|change|now|is|to|were|had|would)\b/i.test(msg)) {
      const change = { territory: ter, field: "priority" as const, value: prio[1][0].toUpperCase() + prio[1].slice(1).toLowerCase() };
      return hypothetical ? call({ name: "what_if", args: { changes: [change] } }) : call({ name: "apply_territory_fact", args: change });
    }
  }

  const ref = appRef(msg, dir, lastApp);

  // Withdrawals.
  if (/\b(withdr(?:awn|ew|aw)|dropped\s+out|pulled\s+out|no\s+longer\s+interested|backed\s+out)\b/i.test(msg)) {
    if (!ref) return { kind: "clarify", text: "Who has withdrawn? Give me an ID like APP-007 or a name." };
    return hypothetical ? call({ name: "what_if", args: { changes: [{ app: ref, withdraw: true }] } }) : call({ name: "withdraw", args: { app: ref } });
  }

  // Human control: override and "sent to partner".
  const ov = /\boverride\b\s+(.+?)\s+(?:to|as|with)\s+(approved|conditional(?:ly approved)?|hold|on hold|waitlist(?:ed)?|reject(?:ed)?)\b(?:[\s,.:;-]*(?:because|reason|since|as|due to)[\s:]*(.+))?/i.exec(msg);
  if (ov) {
    const status = /^approved/i.test(ov[2]) ? "APPROVED" : /^cond/i.test(ov[2]) ? "CONDITIONAL" : /hold/i.test(ov[2]) ? "HOLD" : /^wait/i.test(ov[2]) ? "WAITLIST" : "REJECT";
    const target = appRef(ov[1], dir, lastApp) ?? appRef(msg, dir, lastApp);
    if (!target) return { kind: "clarify", text: "Which application should I override? Give me an ID like APP-007." };
    if (!ov[3] || ov[3].trim().length < 3) return { kind: "clarify", text: `A reason is required for a human override. Say, for example: "override ${target.toUpperCase()} to ${status === "HOLD" ? "hold" : status.toLowerCase()} because the regional head asked for it".` };
    return call({ name: "override_decision", args: { app: target, status, reason: ov[3].trim().replace(/[.!]+$/, "") } });
  }
  if (/\b(mark|set|lock)\b.*\b(sent|locked|committed)\b|\bsent\s+to\s+(?:the\s+)?partner\b|\block\s+(?:the\s+decision|app)/i.test(msg) && ref) {
    return call({ name: "lock_decision", args: { app: ref } });
  }

  // Compare.
  if (/\b(compare|difference\s+between|versus|vs\.?|ahead\s+of|rank(?:s|ed)?\s+(?:above|higher|over))\b/i.test(msg)) {
    const two = twoRefs(msg, dir);
    if (two) return call({ name: "compare", args: { a: two[0], b: two[1] } });
    return { kind: "clarify", text: "Which two applications should I compare? For example: compare APP-007 and APP-012." };
  }

  // Facts and what-ifs about an application.
  const facts = parseFacts(msg);
  const statement = /\b(has|have|had|now|just|recently|newly|found|got|secured|moved|can|will|wants?|prefers?|increased?|owns?|rented|leased)\b/i.test(msg);
  if (facts.length && ref && !/^(why|how|what\s+is|what's|who|which|when)\b/i.test(msg)) {
    if (hypothetical) return call({ name: "what_if", args: { changes: facts.map((f): WhatIfChangeT => ({ app: ref, ...f })) } });
    if (statement) return call({ name: "apply_fact", args: { app: ref, changes: facts } });
  }
  if (facts.length && !ref && statement && !/^(why|how|what|who|which|when)\b/i.test(msg)) {
    return { kind: "clarify", text: "Who is that about? Give me an ID like APP-007 or a name." };
  }

  // Team actions.
  if (/\b(today'?s?\s+actions?|action\s+queue|to-?do|what\s+(?:should|do|must|can)\s+(?:we|i|the team)\s+(?:do|work\s+on|chase|focus)|what\s+needs\s+(?:doing|attention)|priorit(?:y|ies)\s+today)\b/i.test(msg)) {
    return call({ name: "todays_actions", args: {} });
  }

  // Lists: "show all on hold", "which applications are approved in Mysuru".
  if (!ref && /\b(list|show|which|who|how\s+many|display|give\s+me|all)\b/i.test(msg)) {
    const status = STATUS_WORDS.find(([re]) => re.test(msg))?.[1];
    const city = /\bin\s+(bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi(?:-dharwad)?|dharwad|belagavi|belgaum|tumakuru|tumkur|davanagere)\b/i.exec(msg)?.[1];
    if (status || city || terNums.length) {
      return call({ name: "list_applications", args: { ...(status ? { status } : {}), ...(city ? { city } : {}), ...(terNums.length ? { territory: `TER-${terNums[0]}` } : {}) } });
    }
  }

  if (terNums.length && !ref) return call({ name: "territory_status", args: { territory: `TER-${terNums[0]}` } });

  // Policy questions.
  if (!ref && /\b(polic(?:y|ies)|assumptions?|rules?|minimum\s+investment|min\s+investment|radius|cannibali[sz]ation|payback|deadlines?|training\s+days|shadow(?:ing)?|why\s+(?:is|are|do|does)\b.*\b(?:required|needed))\b/i.test(msg)) {
    return call({ name: "explain_policy", args: { topic: msg.slice(0, 120) } });
  }

  // Questions about one application.
  if (ref && (/\b(why|what|how|explain|tell|status|decision|decided|training|onboarding|next|step|condition|when|about|show|details?|reason|chances?|stands?|where)\b/i.test(msg) || /^(and|what about|how about)\b/i.test(msg) || /^[#\w-]+[?]?$/.test(msg))) {
    return call({ name: "get_decision", args: { app: ref } });
  }
  if (ref && hasApp(msg, dir, lastApp) && msg.length < 40) return call({ name: "get_decision", args: { app: ref } });
  return { kind: "none" };
}

export const EXAMPLE_QUESTIONS = [
  "Why is APP-007 on hold?",
  "Compare APP-005 and APP-013",
  "Show everyone on hold",
  "APP-012 has now found a ground-floor space",
  "What should we do today?",
  "What if TER-02 had 2 slots?",
];

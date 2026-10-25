// Keyword fallback for free-text signals (SPEC §8.1). Used when Gemini is unavailable, and as the
// first pass before Gemini answers. English plus common Hinglish/Kanglish and native-script words.
// Applicant text is data only: nothing here is ever executed or obeyed.

import type { EvidenceKey, SignalEvidence, Signals } from "@/lib/types";

const UPPER_FLOOR =
  /\b(first|1st|second|2nd|third|3rd|upper|top)[\s-]*floor\b|\bupstairs\b|\bfloor\s*(1|2|3)\b|\bmele\s+(maḍi|madi|mahadi)\b|ಮೊದಲ\s*ಮಹಡಿ|ಮೇಲಿನ\s*ಮಹಡಿ|ಮೇಲ್ಮಹಡಿ|पहली\s*मंज़?िल|ऊपरी\s*मंज़?िल/iu;
const GROUND_FLOOR = /\bground[\s-]*floor\b|\bstreet[\s-]*level\b|\bneela\s*mahadi\b|ನೆಲ\s*ಮಹಡಿ|ಕೆಳ\s*ಮಹಡಿ|भूतल|ग्राउंड\s*फ्लोर|नीचे\s*की\s*मंज़?िल/iu;
const MALL = /\b(in|inside|at)\s+(a|the)?\s*[\w\s]{0,20}?mall\b|\bmall\s+unit\b|ಮಾಲ್‌?ನಲ್ಲಿ|मॉल\s+में/iu;

const SEARCHING =
  /\bstill\s+(searching|looking)\b|\blooking\s+for\s+(a\s+|the\s+)?(shop|space|place|premises|location)\b|\bsearching\s+for\b|\byet\s+to\s+(find|finali[sz]e|identify)\b|\bnot\s+(yet\s+)?(found|finali[sz]ed)\b|\bdhoond?h\b|\bhudukutt?a\b|ಹುಡುಕು|ढूंढ|ढूँढ/iu;
const HAS_SPACE =
  /\b(already\s+)?(have|own|has)\s+(a\s+|my\s+own\s+|our\s+own\s+)?(shop|space|premises|building|property)\b|\b(my|our)\s+(own\s+)?(shop|premises|building)\s+(is|in|on|at)\b/iu;

const FESTIVALS: [RegExp, string][] = [
  [/\b(diwali|deepavali|divali)\b|ದೀಪಾವಳಿ|दिवाली|दीपावली/iu, "Diwali"],
  [/\b(sankranti|sankranthi|makar\s*sankranti|pongal)\b|ಸಂಕ್ರಾಂತಿ|संक्रांति/iu, "Sankranti"],
  [/\bnew\s*year\b|ಹೊಸ\s*ವರ್ಷ|नया\s*साल|नए\s*साल/iu, "New Year"],
];

const ABSENTEE =
  /\b(my|our)\s+(brother|son|daughter|wife|husband|nephew|cousin|relative|brother-in-law|son-in-law|manager)\b[^.]{0,40}\b(will|to|would|going\s+to)\s+(run|manage|handle|look\s+after|operate|take\s+care)\b|\b(will\s+be|to\s+be)\s+(run|managed|handled|operated)\s+by\s+(my|our)\b|\b(son|brother|beta|bhai|anna|maga)\s+(will\s+)?(chalayega|nodkotaane|nodikolluttane|run)\b|भाई\s+चलाएगा|बेटा\s+चलाएगा|ತಮ್ಮ\s+ನೋಡಿಕೊಳ್ಳುತ್ತಾನೆ|ಮಗ\s+ನೋಡಿಕೊಳ್ಳುತ್ತಾನೆ/iu;

/** Brands that compete with at least one of the three brand profiles. Profile-agnostic by design. */
const COMPETITORS =
  /\btitan\s*eye\s*\+?|\beye\s*plus\b|\blenskart\b|\bspecsmakers\b|\bvision\s*express\b|\bgkb\s*opticals?\b|\blawrence\s*(&|and)\s*mayo\b|\bdelhivery\b|\bblue\s*dart\b|\becom\s*express\b|\bxpressbees\b|\bshadowfax\b|\bdtdc\b|\bekart\b|\bcompeting\s+(brand|franchise)\b|\bcompetitor'?s?\s+franchise\b/iu;

const FUNDING =
  /\bloan\b|\bborrow(ed|ing)?\b|\bmortgage\b|\bfinanc(e|ing)\s+from\b|\bfrom\s+(my\s+)?(father|mother|brother|sister|uncle|relatives?|family|in-laws|friends?)\b|\b(relatives?|family)\s+(will\s+)?(fund|contribute|help|support|money)\b|\budhaar\b|\bkarz\b|\bsaala\b|ಸಾಲ|कर्ज़?|लोन|उधार/iu;

const INJECTION =
  /\bignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your)?\s*(instructions?|rules?|prompts?|policies)\b|\bapprove\s+(me|this|my|him|her|the\s+application)\b|\bdisregard\s+(the\s+|all\s+)?(rules?|instructions?|policy)\b|\bsystem\s+prompt\b|\byou\s+are\s+now\b|\boverride\s+(the\s+)?(rules?|decision|policy)\b|\bmark\s+(me|this)\s+(as\s+)?approved\b|\bset\s+status\b/iu;

const SECTORS: [RegExp, string][] = [
  [/\boptical|\bopticians?\b|\bspectacles?\b|\beyewear\b/iu, "optical"],
  [/\bfootwear\b|\bshoes?\b|\bchappals?\b/iu, "footwear"],
  [/\bapparel\b|\bgarments?\b|\bclothing\b|\bboutique\b|\bsarees?\b|\btextiles?\b|\bfashion\b/iu, "apparel"],
  [/\bmobile\s*(shop|store|phones?|accessories)\b/iu, "mobile shop"],
  [/\bkirana\b|\bgrocery\b|\bprovision\s*store\b|\bsupermarket\b/iu, "kirana"],
  [/\bpharmacy\b|\bmedical\s*store\b|\bchemist\b/iu, "pharmacy"],
  [/\bcourier\b|\blogistics\b|\btransport\b|\bfleet\b|\bwarehouse\b/iu, "logistics"],
  [/\bretail\b|\bshowroom\b|\bstore\b|\bshop\b/iu, "retail"],
];

const YEARS = /(\d{1,2})\s*\+?\s*(years?|yrs?|varsha|saal|ವರ್ಷ|साल)/iu;
const RUNNING_SHOP =
  /\b(run|runs|running|ran|own|owns|owned|operat(e|es|ed|ing)|manag(e|es|ed|ing))\b[^.]{0,40}\b(shop|store|kirana|business|showroom|boutique|outlet|pharmacy|stall)\b|\b(shop|store|kirana)\s+(owner|keeper)\b/iu;

export function describesRunningShop(textIn: string): boolean {
  return RUNNING_SHOP.test(textIn);
}

/** First match of `re` in any of the texts, as the exact substring of that text (the evidence). */
function quote(re: RegExp, ...texts: string[]): string | null {
  for (const t of texts) {
    const m = t.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

export function extractSignalsHeuristic(input: { business: string; notes: string }): Signals {
  const business = input.business ?? "";
  const notes = input.notes ?? "";
  const evidence: SignalEvidence = {};
  const note = (key: EvidenceKey, q: string | null) => {
    if (q) evidence[key] = q;
    return q;
  };

  // Floor claims come from the notes only: the business column describes past work, not this space.
  let floor: Signals["notes_floor_claim"] = null;
  if (note("notes_floor_claim", quote(UPPER_FLOOR, notes))) floor = "Upper";
  else if (note("notes_floor_claim", quote(GROUND_FLOOR, notes))) floor = "Ground";
  else if (note("notes_floor_claim", quote(MALL, notes))) floor = "Mall unit";

  let space: Signals["notes_space_claim"] = null;
  if (note("notes_space_claim", quote(SEARCHING, notes))) space = "searching";
  else if (note("notes_space_claim", quote(HAS_SPACE, notes))) space = "has_space";

  const festival = FESTIVALS.find(([re]) => note("festival_deadline", quote(re, notes)))?.[1] ?? null;
  const sector = SECTORS.find(([re]) => note("relevant_sector", quote(re, business, notes)))?.[1] ?? null;
  const running = quote(RUNNING_SHOP, business, notes);
  const years = running ? quote(YEARS, business, notes) : null;
  note("years_running_shop_mentioned", years);

  const other: string[] = [];
  if (/<[a-z/!][^>]*>/i.test(`${business} ${notes}`)) other.push("contains_markup");

  return {
    relevant_sector: sector,
    years_running_shop_mentioned: years ? Number(years.match(/\d+/)![0]) : null,
    notes_floor_claim: floor,
    notes_space_claim: space,
    festival_deadline: festival,
    absentee_owner: !!note("absentee_owner", quote(ABSENTEE, notes)),
    competitor_conflict: !!note("competitor_conflict", quote(COMPETITORS, business, notes)),
    funding_dependency: !!note("funding_dependency", quote(FUNDING, notes)),
    injection_attempt: !!note("injection_attempt", quote(INJECTION, business, notes)),
    other_flags: other,
    confidence: 0.5,
    evidence,
  };
}

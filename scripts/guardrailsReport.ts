// Builds docs/GUARDRAILS_REPORT.md from real results: the unit tests (run now), the browser tests (e2e/results.json from
// the last `npx playwright test`) and the secret scan of the built bundle. Nothing is hand-marked as passing.
//
//   npm run build && npx playwright test && npm run guardrails

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

type Result = "PASS" | "FAIL" | "MANUAL" | "PENDING" | "NO TEST";
interface Rule {
  /** Substrings of test names that cover it, beyond any test whose name contains the ID. */
  unit?: string[];
  e2e?: string[];
  script?: "bundle";
  /** Something only a person can do remains: the guardrail shows as MANUAL, not PASS, with this said. */
  manual?: string;
  pending?: string;
  /** Context worth stating next to a result. */
  note?: string;
}

const RULES: Record<string, Rule> = {
  "G4.3": { unit: ["an injection attempt is declined, never obeyed", "declines instructions without ever calling the model", "an injection in the notes is still flagged", "a model that obeys an injection"] },
  "G4.4": { unit: ["returns a tool call only from the allowlist", "the tool schema accepts exactly the allowlist", "an AI-routed fact update still goes through the same validation"] },
  "G4.6": { unit: ["suggests the nearest ID for an unknown one", "the AI declining (out of scope)"] },
  "G4.7": { unit: ["sends the model only the last 12 turns", "caps very long input at 2,000 characters"] },
  "G5.1": { unit: ["commits with a diff, an assumption and an Undo", "'what if' only simulates"] },
  "G5.3": { unit: ["'APP-003 has withdrawn' removes them", "'TER-02 now has 2 slots' changes the territory"] },
  "G6.1": { script: "bundle" },
  "G6.2": { unit: [".env files are ignored by git"] },
  "G6.6": { note: "The count is kept in each server instance's memory, as specified, so a script spread across several instances at once can exceed it. The cost backstop is a spend cap in Google AI Studio, which only you can set." },
  "G7.2": { unit: ["a refresh restores the workspace"], e2e: ["G7.2"] },
  "G7.5": { unit: ["every AI route answers 503 with no key"], e2e: ["G7.5"], manual: "The UptimeRobot monitor on /api/health is not set up yet: it needs an account only you can create (https://uptimerobot.com, HTTP monitor on https://onboarding-engine-dun.vercel.app/api/health, every 5 minutes)." },
  "G7.7": { e2e: ["G7.7"], note: "Checked from a fresh browser with no cookies: the page loads with no login. Vercel's protection is on its standard setting, which leaves the production URL open and asks for a login only on the long per-deployment URLs." },
  "G8.4": { pending: "Phase 7 (the map) is not built yet." },
  "G8.5": { pending: "Phase 10 (motion) is not built yet." },
  "G9.1": { unit: ["the evidence rule (SPEC §15.3)"] },
  "G9.4": { unit: ["corrects a wrong premise first"] },
  "G9.5": { unit: ["IDs and names (SPEC §15.6)"] },
  "G9.6": { unit: ["several facts in one message make one commit and one diff"] },
};

const spec = readFileSync("docs/SPEC.md", "utf8");
const sec = spec.slice(spec.indexOf("## 11. Guardrails"), spec.indexOf("## 12. Test fixture"));
const guardrails: { id: string; text: string }[] = [];
for (const line of sec.split("\n")) {
  const m = /^- \*\*(G\d+\.\d+)\*\*\s*(.*)$/.exec(line);
  if (m) guardrails.push({ id: m[1], text: m[2].replace(/\*\*/g, "").replace(/\*\(overridden by section 16\)\*\s*/, "(Overridden by section 16.) ").replace(/`/g, "") });
}
// Section 16 adds G10.
const s16 = spec.slice(spec.indexOf("### 16.5 Guardrails"));
for (const line of s16.split("\n")) {
  const m = /^- \*\*(G10\.\d+)\*\*\s*(.*)$/.exec(line);
  if (m) guardrails.push({ id: m[1], text: m[2] });
}

// ---- Unit tests, run now ----
execSync("npx vitest run --reporter=json --outputFile=/tmp/guardrails-vitest.json", { stdio: "ignore" });
const vt = JSON.parse(readFileSync("/tmp/guardrails-vitest.json", "utf8")) as { numTotalTests: number; testResults: { assertionResults: { fullName: string; status: string }[] }[] };
const unit = vt.testResults.flatMap((f) => f.assertionResults.map((t) => ({ name: t.fullName, ok: t.status === "passed", skipped: t.status === "skipped" || t.status === "pending" })));

// ---- Browser tests ----
interface E2E { title: string; project: string; ok: boolean }
const e2e: E2E[] = [];
let e2eNote = "no browser results found";
if (existsSync("e2e/results.json")) {
  const j = JSON.parse(readFileSync("e2e/results.json", "utf8"));
  interface PwSuite {
    title: string;
    specs?: { title: string; tests?: { projectName: string; status: string }[] }[];
    suites?: PwSuite[];
  }
  const walk = (suite: PwSuite, trail: string[]) => {
    for (const s of suite.specs ?? []) for (const t of s.tests ?? []) e2e.push({ title: [...trail, s.title].join(" › "), project: t.projectName, ok: t.status === "expected" });
    for (const sub of suite.suites ?? []) walk(sub, [...trail, sub.title]);
  };
  for (const s of j.suites ?? []) walk(s, []);
  e2eNote = `${j.config?.projects?.length ?? 0} projects against ${j.config?.metadata?.baseURL ?? process.env.E2E_BASE_URL ?? "https://onboarding-engine-dun.vercel.app"}, results from ${statSync("e2e/results.json").mtime.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---- Bundle scan ----
let bundle: { ok: boolean; text: string } = { ok: false, text: "not run (build first)" };
if (existsSync(".next/static")) {
  try {
    bundle = { ok: true, text: execSync("npm run -s check:bundle", { encoding: "utf8" }).trim() };
  } catch (e) {
    bundle = { ok: false, text: String((e as { stdout?: string }).stdout ?? e).trim().split("\n")[0] };
  }
}

const idRe = (id: string) => new RegExp(`\\b${id.replace(".", "\\.")}(?!\\d)`);
const rows: { id: string; text: string; tests: string[]; result: Result; note?: string }[] = [];
for (const g of guardrails) {
  const rule = RULES[g.id] ?? {};
  const u = unit.filter((t) => idRe(g.id).test(t.name) || (rule.unit ?? []).some((s) => t.name.includes(s)));
  const e = e2e.filter((t) => idRe(g.id).test(t.title) || (rule.e2e ?? []).some((s) => t.title.includes(s)));
  const tests = [...new Set(u.map((t) => `unit: ${t.name}`)), ...new Set(e.map((t) => `browser: ${t.title}`))];
  if (rule.script === "bundle") tests.push(`script: npm run check:bundle: ${bundle.text}`);
  let result: Result;
  const failed = u.some((t) => !t.ok && !t.skipped) || e.some((t) => !t.ok) || (rule.script === "bundle" && !bundle.ok);
  if (rule.pending) result = "PENDING";
  else if (failed) result = "FAIL";
  else if (rule.manual) result = "MANUAL";
  else if (tests.length === 0) result = "NO TEST";
  else result = "PASS";
  rows.push({ id: g.id, text: g.text, tests, result, note: rule.pending ?? rule.manual ?? rule.note });
}

const count = (r: Result) => rows.filter((x) => x.result === r).length;
const esc = (s: string) => s.replace(/\|/g, "\\|");
const lines = [
  "# Guardrails report",
  "",
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`npm run guardrails\` from real test results. Nothing here is marked by hand.`,
  "",
  `- Unit tests: ${unit.filter((t) => t.ok).length} passed of ${vt.numTotalTests} (${unit.filter((t) => t.skipped).length} skipped).`,
  `- Browser tests: ${e2e.filter((t) => t.ok).length} passed of ${e2e.length} (${e2eNote}).`,
  `- Secret scan of the browser bundle: ${bundle.text}`,
  "",
  `**${count("PASS")} passed, ${count("FAIL")} failed, ${count("PENDING")} waiting on a later phase, ${count("MANUAL")} manual, ${count("NO TEST")} without a test**, out of ${rows.length} guardrails.`,
  "",
  "| ID | Guardrail | Test(s) | Result |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${esc(r.text)} | ${r.tests.length ? esc(r.tests.slice(0, 3).join("; ")) + (r.tests.length > 3 ? `; and ${r.tests.length - 3} more` : "") : "none"}${r.note ? ` — ${esc(r.note)}` : ""} | **${r.result}** |`),
  "",
];
writeFileSync("docs/GUARDRAILS_REPORT.md", lines.join("\n"));
console.log(`${count("PASS")} passed, ${count("FAIL")} failed, ${count("PENDING")} pending, ${count("MANUAL")} manual, ${count("NO TEST")} no test (of ${rows.length})`);
for (const r of rows.filter((x) => x.result === "FAIL" || x.result === "NO TEST")) console.log(`  ${r.result}: ${r.id}`);
process.exit(count("FAIL") + count("NO TEST") > 0 ? 1 : 0);

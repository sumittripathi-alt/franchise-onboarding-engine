// Motion (SPEC §10.3, G8.5): only transform and opacity, 150 to 350 ms, nothing for people who ask for less motion,
// everything in a context that is cleaned up, and GSAP used in exactly one place so the rules can't be bypassed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampDuration, fadeUp, highlightApplications, MAX_SECONDS, MIN_SECONDS, motionOk, pop, staggerFor, STAGGER_BUDGET_SECONDS } from "@/lib/motion";

const ROOT = join(__dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "tests", "e2e", "scripts", "supabase", "docs", "public", "test-results"].includes(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.slice(ROOT.length + 1));
  }
  return out;
}

describe("G8.5 motion rules", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every duration is held between 150 and 350 ms, whatever is asked for", () => {
    expect(clampDuration(0.01)).toBe(MIN_SECONDS);
    expect(clampDuration(5)).toBe(MAX_SECONDS);
    expect(clampDuration(0.22)).toBe(0.22);
    expect([MIN_SECONDS, MAX_SECONDS]).toEqual([0.15, 0.35]);
  });

  it("a stagger never adds more than the budget, however many items there are", () => {
    for (const n of [1, 2, 5, 12, 40, 500]) {
      const total = staggerFor(n) * Math.max(0, n - 1);
      expect(total, `${n} items`).toBeLessThanOrEqual(STAGGER_BUDGET_SECONDS + 1e-9);
    }
    expect(staggerFor(1)).toBe(0);
  });

  it("people who prefer reduced motion get no animation at all", () => {
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: /reduce/.test(q) }) });
    expect(motionOk()).toBe(false);
    expect(fadeUp({} as never)).toBeNull();
    expect(pop({} as never)).toBeNull();
    expect(highlightApplications(["APP-001"])).toBeUndefined(); // returns without touching the page
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(motionOk()).toBe(true);
  });

  it("without a window (server rendering) nothing animates", () => {
    expect(motionOk()).toBe(false);
  });

  it("only transform and opacity are ever animated", () => {
    const src = read("lib/motion/index.ts");
    // Property names that would cause layout or paint work, used as keys anywhere in the motion code.
    expect(src).not.toMatch(/\b(width|height|top|left|right|bottom|margin\w*|padding\w*|background\w*|color|boxShadow|filter|borderRadius|fontSize|autoAlpha|visibility|display)\s*:/);
    const keys = [...src.matchAll(/\{\s*((?:opacity|x|y|scale|scaleX|scaleY)\s*:[^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((k) => k[1]));
    // The properties that move things, plus the timing options that don't change how anything looks.
    for (const k of keys) expect(["opacity", "x", "y", "scale", "scaleX", "scaleY", "duration", "stagger", "delay", "ease", "clearProps"]).toContain(k);
    expect(keys.length).toBeGreaterThan(8);
  });

  it("every tween goes through one function that clamps the duration and clears what it set", () => {
    const src = read("lib/motion/index.ts");
    expect(src.match(/gsap\.fromTo\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/gsap\.(to|from)\(/);
    expect(src).toMatch(/duration: clampDuration\(/);
    expect(src).toMatch(/clearProps: CLEAR/);
  });

  it("GSAP is imported in one file only, so none of this can be bypassed", () => {
    const users = sources(ROOT).filter((f) => /from "(gsap|@gsap\/react)"/.test(read(f)));
    expect(users).toEqual(["lib/motion/index.ts"]);
  });

  it("every animated component uses a context hook that is reverted on unmount or change", () => {
    const src = read("lib/motion/index.ts");
    expect(src).toMatch(/useGSAP\(fn, \{ scope: opts\.scope, dependencies: opts\.dependencies, revertOnUpdate: true \}\)/);
    const users = sources(ROOT).filter((f) => f !== "lib/motion/index.ts" && /@\/lib\/motion"/.test(read(f)));
    expect(users.length).toBeGreaterThanOrEqual(6);
    for (const f of users) expect(read(f), f).toMatch(/useMotion\(|useChangePop\(/);
  });

  it("the stylesheet switches CSS transitions and animations off for reduced motion", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
  });

  it("the animated elements are the ones the spec names", () => {
    const hooks = sources(ROOT).flatMap((f) => [...read(f).matchAll(/data-animate="([\w-]+)"/g)].map((m) => m[1]));
    for (const h of ["status-chip", "diff-card", "diff-row", "slot-bar", "landing-section", "drawer"]) expect(hooks).toContain(h);
  });
});

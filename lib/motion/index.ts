"use client";

// Motion (SPEC §10.3). It explains, it doesn't decorate: the cascade after a change, a chip when its status changes,
// slots filling, the drawer opening, the landing page arriving. Rules kept here, in one place:
//   - only transform and opacity are animated;
//   - every tween lasts 0.15 to 0.35 seconds, and a stagger never adds more than about 0.7 seconds in total;
//   - nothing waits before content exists: it is in the page and readable from the start;
//   - with prefers-reduced-motion nothing animates at all;
//   - every animation lives in a GSAP context that is reverted when the component goes away.
// No other file imports GSAP, so these rules can't be bypassed.

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, type RefObject } from "react";

gsap.registerPlugin(useGSAP);

export const MIN_SECONDS = 0.15;
export const MAX_SECONDS = 0.35;
export const STAGGER_BUDGET_SECONDS = 0.7;

export const clampDuration = (s: number): number => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, s));

/** The pause between items so that all of them have started within the budget. */
export const staggerFor = (count: number, per = 0.12, budget = STAGGER_BUDGET_SECONDS): number => (count <= 1 ? 0 : Math.min(per, budget / (count - 1)));

export function motionOk(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// For tests and for anyone checking that nothing is left running: how many tweens are active right now.
if (typeof window !== "undefined") {
  (window as unknown as { __motion?: { active: () => number } }).__motion = { active: () => gsap.globalTimeline.getChildren(true, true, true).length };
}

type Targets = gsap.TweenTarget;
const CLEAR = "transform,opacity";
const ease = "power2.out";

interface Opts {
  duration?: number;
  stagger?: number;
  delay?: number;
}

const tween = (targets: Targets, from: gsap.TweenVars, to: gsap.TweenVars, o: Opts): gsap.core.Tween | null =>
  motionOk() ? gsap.fromTo(targets, from, { ...to, duration: clampDuration(o.duration ?? 0.22), stagger: o.stagger ?? 0, delay: o.delay ?? 0, ease, clearProps: CLEAR }) : null;

export const fadeUp = (t: Targets, o: Opts & { y?: number } = {}) => tween(t, { opacity: 0, y: o.y ?? 8 }, { opacity: 1, y: 0 }, o);
export const slideIn = (t: Targets, o: Opts & { x?: number } = {}) => tween(t, { opacity: 0, x: o.x ?? -10 }, { opacity: 1, x: 0 }, o);
export const pop = (t: Targets, o: Opts = {}) => tween(t, { opacity: 0.5, scale: 0.85 }, { opacity: 1, scale: 1 }, o);
export const fillIn = (t: Targets, o: Opts = {}) => tween(t, { opacity: 0.3, scaleX: 0 }, { opacity: 1, scaleX: 1 }, o);
export const flash = (t: Targets, o: Opts = {}) => tween(t, { opacity: 0.35, x: -6 }, { opacity: 1, x: 0 }, o);

/** A GSAP context tied to a component: reverted (and its inline styles cleared) when it unmounts or its dependencies change. */
export function useMotion(fn: () => void, opts: { scope?: RefObject<Element | null>; dependencies?: unknown[] } = {}) {
  useGSAP(fn, { scope: opts.scope, dependencies: opts.dependencies, revertOnUpdate: true });
}

/** A small pop when a value changes (a status chip's status). Not on first render. */
export function useChangePop(ref: RefObject<HTMLElement | null>, value: unknown) {
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (el && prev.current !== value) pop(el);
    prev.current = value;
    return () => {
      if (el) {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: CLEAR });
      }
    };
  }, [ref, value]);
}

// ---------- The animations ----------

/** The diff card arrives, then each affected application slides in, in order (SPEC §10.3, 1). */
export function cascadeDiff(card: HTMLElement | null) {
  if (!card || !motionOk()) return;
  const rows = card.querySelectorAll<HTMLElement>('[data-animate="diff-row"]');
  const tl = gsap.timeline();
  tl.add(fadeUp(card, { y: 6, duration: 0.2 }) ?? gsap.timeline());
  if (rows.length) tl.add(slideIn(rows, { duration: 0.25, stagger: staggerFor(rows.length) }) ?? gsap.timeline(), "-=0.05");
  const chips = card.querySelectorAll<HTMLElement>('[data-animate="status-chip"]');
  if (chips.length) tl.add(pop(chips, { duration: 0.2, stagger: staggerFor(chips.length, 0.06, 0.4) }) ?? gsap.timeline(), "-=0.4");
}

/** Highlight, one after another, the applications a change moved, wherever they are on screen. */
export function highlightApplications(appIds: string[]) {
  if (!motionOk() || appIds.length === 0) return;
  const stagger = staggerFor(appIds.length, 0.18);
  appIds.slice(0, 12).forEach((id, i) => {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-app-id="${CSS.escape(id)}"]`)].filter((e) => e.offsetParent !== null);
    if (els.length) flash(els, { duration: 0.3, delay: 0.1 + i * stagger });
  });
}

/** Slots whose state changed fill in from the left. */
export function fillSlots(cells: HTMLElement[]) {
  if (cells.length) fillIn(cells, { duration: 0.25, stagger: staggerFor(cells.length, 0.05, 0.4) });
}

/** The sections of a decision settle in as it opens. */
export function drawerIn(root: HTMLElement | null) {
  if (!root) return;
  const kids = [...root.children] as HTMLElement[];
  fadeUp(kids, { y: 6, duration: 0.22, stagger: staggerFor(kids.length, 0.04, 0.3) });
}

/** The landing page arrives section by section. */
export function landingIn(root: HTMLElement | null) {
  if (!root) return;
  const parts = root.querySelectorAll<HTMLElement>('[data-animate="landing-section"]');
  fadeUp(parts, { y: 10, duration: 0.3, stagger: staggerFor(parts.length, 0.08, 0.3) });
}

"use client";

import { useRef } from "react";
import { highlightApplications, useMotion } from "@/lib/motion";
import { useWorkspace } from "./context";

/**
 * When a change adds to the log, from here or from another viewer, highlight the applications it moved, one after
 * another, so the knock-on effects are seen and not just listed (SPEC §10.3). Undo doesn't replay it. It renders nothing.
 */
export function Cascade() {
  const { session } = useWorkspace();
  const ids = session.entries.map((e) => e.id).join(",");
  const seen = useRef<Set<string> | null>(null);
  useMotion(
    () => {
      const known = seen.current;
      seen.current = new Set(session.entries.map((e) => e.id));
      if (known === null) return; // the entries that were already there when the page opened
      const fresh = session.entries.filter((e) => !known.has(e.id) && !e.undone);
      const moved = fresh.flatMap((e) => e.diff.changes.map((c) => c.appId));
      if (moved.length) highlightApplications([...new Set(moved)]);
    },
    { dependencies: [ids] },
  );
  return null;
}

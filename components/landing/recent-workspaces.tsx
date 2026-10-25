"use client";

import { ArrowRight, CloudOff, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { safeGetItem } from "@/lib/state/storage";
import { LAST_WORKSPACE_KEY } from "@/lib/workspace/cache";
import type { WorkspaceSummary } from "@/lib/workspace/schemas";
import { httpTransport } from "@/lib/workspace/transport";

type Load = { kind: "loading" } | { kind: "ok"; items: WorkspaceSummary[] } | { kind: "failed" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The last 20 shared workspaces, each with Join. Opening this list changes nothing (G10.6). */
export function RecentWorkspaces() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMine(safeGetItem(LAST_WORKSPACE_KEY)); // eslint-disable-line react-hooks/set-state-in-effect
    void httpTransport.list().then((res) => {
      if (live) setLoad(res.ok ? { kind: "ok", items: res.data.workspaces } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="recent" className="mx-auto mt-10 max-w-2xl">
      <h2 id="recent" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Users aria-hidden className="size-4" /> Recent workspaces
      </h2>

      {mine && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <p className="text-sm">
            <span className="font-medium">Pick up where you left off</span>
            <span className="block text-muted-foreground">The workspace you had open last on this device.</span>
          </p>
          <Link href={`/w/${mine}`} className="contents">
            <Button>
              Continue <ArrowRight />
            </Button>
          </Link>
        </div>
      )}

      {load.kind === "loading" && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Loading recent workspaces…
        </p>
      )}
      {load.kind === "failed" && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
          <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>Shared workspaces can&apos;t be loaded right now. You can still start a new one below; it is saved on this device and shared as soon as the connection is back.</span>
        </p>
      )}
      {load.kind === "ok" && load.items.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No workspaces yet. Upload a file below to start the first one.</p>}
      {load.kind === "ok" && load.items.length > 0 && (
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {load.items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{w.name}</p>
                <p className="text-muted-foreground">
                  {w.rowCounts.applications} applications · {w.rowCounts.territories} territories · {when(w.createdAt)}
                </p>
              </div>
              <Link href={`/w/${w.id}`} className="contents">
                <Button variant="outline" size="sm">
                  Join
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

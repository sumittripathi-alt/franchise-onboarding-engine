"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { WorkspaceProvider } from "./context";
import { DataCheckPanel } from "./data-check";
import { Shell } from "./shell";

/** The workspace: data check first, then the decisions. Everything lives in this browser (G7.1). */
export function Workspace() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const session = useStore((s) => s.session);
  const continueReview = useStore((s) => s.continueReview);
  useEffect(() => hydrate(), [hydrate]);

  if (!hydrated) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
        <p className="text-sm text-muted-foreground">Loading your session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="max-w-sm text-center">
          <Logo />
          <p className="mt-6 font-medium">There is no session open</p>
          <p className="mt-1 text-sm text-muted-foreground">Upload your applications, try the sample data, or resume a saved session.</p>
          <Link href="/" className="contents">
            <Button className="mt-4">Go to the start</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceProvider session={session}>
      {session.reviewed ? (
        <Shell />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <Logo href="/workspace" />
          <main id="main" className="mt-6">
            <DataCheckPanel onContinue={continueReview} />
          </main>
        </div>
      )}
    </WorkspaceProvider>
  );
}

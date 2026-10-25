"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { WorkspaceProvider } from "./context";
import { DataCheckPanel } from "./data-check";
import { Shell } from "./shell";
import { SyncBanner, ToastStack } from "./sync-notices";

/** A shared workspace at /w/<id>: data check first, then the decisions, kept in step with everyone else on the link. */
export function Workspace() {
  const { id } = useParams<{ id: string }>();
  const hydrate = useStore((s) => s.hydrate);
  const open = useStore((s) => s.open);
  const close = useStore((s) => s.close);
  const retryLoad = useStore((s) => s.retryLoad);
  const session = useStore((s) => s.session);
  const loadError = useStore((s) => s.loadError);
  const continueReview = useStore((s) => s.continueReview);

  useEffect(() => {
    hydrate();
    void open(id);
    return () => close();
  }, [hydrate, open, close, id]);

  if (!session) {
    if (loadError?.kind === "not_found") {
      return (
        <div className="grid min-h-screen place-items-center px-4">
          <div className="max-w-sm text-center">
            <Logo />
            <p className="mt-6 font-medium">This workspace doesn&apos;t exist</p>
            <p className="mt-1 text-sm text-muted-foreground">Check the link, or go back to the start to join a recent workspace or upload a file.</p>
            <Link href="/" className="contents">
              <Button className="mt-4">Go to the start</Button>
            </Link>
          </div>
        </div>
      );
    }
    if (loadError) {
      return (
        <div className="grid min-h-screen place-items-center px-4">
          <div className="max-w-sm text-center" role="alert">
            <Logo />
            <p className="mt-6 font-medium">Can&apos;t load this workspace right now</p>
            <p className="mt-1 text-sm text-muted-foreground">{loadError.message}</p>
            <Button className="mt-4" onClick={retryLoad}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
        <p className="text-sm text-muted-foreground">Loading the workspace…</p>
      </div>
    );
  }

  return (
    <WorkspaceProvider session={session}>
      {session.reviewed ? (
        <Shell />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <Logo href={`/w/${id}`} />
          <div className="mt-4 empty:hidden">
            <SyncBanner />
          </div>
          <main id="main" className="mt-6">
            <DataCheckPanel onContinue={continueReview} />
          </main>
        </div>
      )}
      <ToastStack />
    </WorkspaceProvider>
  );
}

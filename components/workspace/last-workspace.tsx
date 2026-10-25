"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { safeGetItem } from "@/lib/state/storage";
import { LAST_WORKSPACE_KEY } from "@/lib/workspace/cache";

export function LastWorkspace() {
  const router = useRouter();
  const [none, setNone] = useState(false);
  useEffect(() => {
    const id = safeGetItem(LAST_WORKSPACE_KEY);
    if (id) router.replace(`/w/${id}`);
    else setNone(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, [router]);

  if (!none) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
        <p className="text-sm text-muted-foreground">Opening your workspace…</p>
      </div>
    );
  }
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="max-w-sm text-center">
        <Logo />
        <p className="mt-6 font-medium">There is no workspace open</p>
        <p className="mt-1 text-sm text-muted-foreground">Upload your applications, try the sample data, or join a recent workspace.</p>
        <Link href="/" className="contents">
          <Button className="mt-4">Go to the start</Button>
        </Link>
      </div>
    </div>
  );
}

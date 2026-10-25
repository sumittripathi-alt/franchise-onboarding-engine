import { Suspense } from "react";
import { Workspace } from "@/components/workspace/workspace";

export default function Page() {
  return (
    <Suspense fallback={<p className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</p>}>
      <Workspace />
    </Suspense>
  );
}

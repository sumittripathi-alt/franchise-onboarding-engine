import { Suspense } from "react";
import { LastWorkspace } from "@/components/workspace/last-workspace";

// The old address: sends you to the workspace you had open last, if this device remembers one.
export default function Page() {
  return (
    <Suspense>
      <LastWorkspace />
    </Suspense>
  );
}

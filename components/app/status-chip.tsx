"use client";

import { useRef } from "react";
import { useChangePop } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { STATUS_META, type Status } from "@/lib/types";

// Status is always shown with a text label, never by colour alone (SPEC 10.2, G8.1).
// Class names are written out in full so Tailwind can see them.
const STYLE: Record<Status, { chip: string; dot: string }> = {
  APPROVED: { chip: "bg-st-approved-bg text-st-approved", dot: "bg-st-approved-dot" },
  CONDITIONAL: { chip: "bg-st-conditional-bg text-st-conditional", dot: "bg-st-conditional-dot" },
  HOLD: { chip: "bg-st-hold-bg text-st-hold", dot: "bg-st-hold-dot" },
  WAITLIST: { chip: "bg-st-waitlist-bg text-st-waitlist", dot: "bg-st-waitlist-dot" },
  REDIRECT: { chip: "bg-st-redirect-bg text-st-redirect", dot: "bg-st-redirect-dot" },
  REJECT: { chip: "bg-st-reject-bg text-st-reject", dot: "bg-st-reject-dot" },
};

export function StatusChip({ status, label, className, size = "sm" }: { status: Status; label?: string; className?: string; size?: "sm" | "lg" }) {
  const s = STYLE[status];
  const ref = useRef<HTMLSpanElement>(null);
  useChangePop(ref, status);
  return (
    <span
      ref={ref}
      data-animate="status-chip"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        s.chip,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", size === "lg" && "size-2", s.dot)} />
      {label ?? STATUS_META[status].label}
    </span>
  );
}

export const STATUS_DOT: Record<Status, string> = {
  APPROVED: STYLE.APPROVED.dot,
  CONDITIONAL: STYLE.CONDITIONAL.dot,
  HOLD: STYLE.HOLD.dot,
  WAITLIST: STYLE.WAITLIST.dot,
  REDIRECT: STYLE.REDIRECT.dot,
  REJECT: STYLE.REJECT.dot,
};

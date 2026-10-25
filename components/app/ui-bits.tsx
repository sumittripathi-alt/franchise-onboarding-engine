import { cn } from "@/lib/utils";

/** A small uppercase label above a section. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</p>;
}

export function Section({ title, hint, children, className, action }: { title: string; hint?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 text-card-foreground shadow-[0_1px_0_0_rgb(0_0_0/0.02)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "warn" | "info"; className?: string }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    warn: "bg-st-hold-bg text-st-hold",
    info: "bg-st-redirect-bg text-st-redirect",
  };
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

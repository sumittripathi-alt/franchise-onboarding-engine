import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent-brand text-[0.7rem] font-bold text-white">
        O
      </span>
      Onboarding Engine
    </Link>
  );
}

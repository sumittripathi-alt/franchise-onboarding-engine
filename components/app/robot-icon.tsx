import { cn } from "@/lib/utils";

/**
 * The assistant's face: a friendly robot head with a headset, drawn as a single-colour icon. The eyes and smile are
 * cut out in `holeClassName`'s fill, so it works on any background (white on the dark launcher button, dark on light).
 */
export function RobotIcon({ className, holeClassName = "fill-primary" }: { className?: string; holeClassName?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden focusable="false" className={cn("size-full", className)}>
      {/* antenna */}
      <rect x="48" y="14" width="4" height="16" rx="2" fill="currentColor" />
      <circle cx="50" cy="11" r="5.5" fill="currentColor" />
      {/* head */}
      <rect x="25" y="29" width="50" height="38" rx="19" fill="currentColor" />
      <path d="M41 29 q9 -9 18 0 z" fill="currentColor" />
      {/* eyes and smile */}
      <circle cx="40" cy="46" r="3.6" className={holeClassName} />
      <circle cx="60" cy="46" r="3.6" className={holeClassName} />
      <path d="M41 55 q9 8 18 0 z" className={holeClassName} />
      {/* headset: band, ear cups, microphone arm */}
      <path d="M17 52 C17 26 83 26 83 52" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="17" cy="53" rx="7" ry="11" fill="currentColor" />
      <path d="M83 42 a7 11 0 0 1 0 22 z" fill="currentColor" />
      <path d="M17 62 C17 80 32 84 44 82" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <ellipse cx="50" cy="82" rx="7" ry="4.6" fill="currentColor" />
    </svg>
  );
}

"use client";

import { Download, FileSpreadsheet, MessageSquareText, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { landingIn, useMotion } from "@/lib/motion";
import { useStore } from "@/lib/state/store";
import { RecentWorkspaces } from "./recent-workspaces";
import { ResumeSession, UploadZone, useUpload } from "./upload";

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload your applications", text: "Drop in the Excel template. We check it and tell you what looks wrong before deciding anything. It becomes a workspace you can share by link." },
  { icon: Sparkles, title: "See every decision explained", text: "Each application gets a clear outcome, the reason, what the partner does next, and how they will be trained." },
  { icon: MessageSquareText, title: "Change a fact, watch it ripple", text: "Tell us a partner found a shop, or change the brand type. The decisions that move, and why, show up straight away." },
];

export function Landing() {
  const upload = useUpload();
  const hydrate = useStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const main = useRef<HTMLElement>(null);
  useMotion(() => landingIn(main.current), { scope: main });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main ref={main} id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
        <section data-animate="landing-section" className="mx-auto max-w-2xl pt-8 text-center sm:pt-14">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">From application to an open, trained store, decided and explained.</h1>
          <p className="mt-4 text-pretty text-muted-foreground">
            Upload your franchise applications. Get a decision for every one, the reason in plain English, the next step for the partner and for your team, and a training plan.
          </p>
        </section>

        <div data-animate="landing-section">
          <RecentWorkspaces />
        </div>

        <section data-animate="landing-section" aria-label="Start a new workspace" className="mx-auto mt-10 max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Start new</h2>
          <UploadZone upload={upload} />

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="secondary" size="lg" onClick={() => void upload.onSample()} disabled={upload.busy}>
              <Sparkles /> Try with sample data
            </Button>
            <a
              href="/data/template.xlsx"
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Download className="size-4" aria-hidden /> Download blank template
            </a>
            <ResumeSession />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Your file is saved as a shareable workspace; anyone with the link can view and change it. Don&apos;t upload real personal data.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            The notes and business descriptions in your file are read by an AI service (Google Gemini) to pick out facts, and so are the partner messages you ask it to draft. Decisions are made by rules, not by the AI.
          </p>
        </section>

        <section data-animate="landing-section" aria-labelledby="how" className="mx-auto mt-20 max-w-4xl">
          <h2 id="how" className="text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-accent-brand">
                  <s.icon aria-hidden className="size-4" /> Step {i + 1}
                </div>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

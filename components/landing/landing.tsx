"use client";

import { ArrowRight, Download, FileSpreadsheet, MessageSquareText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";
import { ResumeSession, UploadZone, useUpload } from "./upload";

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload your applications", text: "Drop in the Excel template. We read it in your browser, check it, and tell you what looks wrong before deciding anything." },
  { icon: Sparkles, title: "See every decision explained", text: "Each application gets a clear outcome, the reason, what the partner does next, and how they will be trained." },
  { icon: MessageSquareText, title: "Change a fact, watch it ripple", text: "Tell us a partner found a shop, or change the brand type. The decisions that move, and why, show up straight away." },
];

export function Landing() {
  const upload = useUpload();
  const hydrate = useStore((s) => s.hydrate);
  const session = useStore((s) => s.session);
  const hydrated = useStore((s) => s.hydrated);
  const reset = useStore((s) => s.reset);
  useEffect(() => hydrate(), [hydrate]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
        <section data-animate="landing-section" className="mx-auto max-w-2xl pt-8 text-center sm:pt-14">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">From application to an open, trained store, decided and explained.</h1>
          <p className="mt-4 text-pretty text-muted-foreground">
            Upload your franchise applications. Get a decision for every one, the reason in plain English, the next step for the partner and for your team, and a training plan.
          </p>
        </section>

        <section data-animate="landing-section" className="mx-auto mt-10 max-w-2xl space-y-4">
          {hydrated && session && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="text-sm">
                <p className="font-medium">You have a session in progress</p>
                <p className="text-muted-foreground">{session.files.join(", ")}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={reset}>
                  Start over
                </Button>
                <Link href="/workspace" className="contents">
                  <Button>
                    Continue <ArrowRight />
                  </Button>
                </Link>
              </div>
            </div>
          )}

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
          <p className="text-center text-xs text-muted-foreground">Your file is read in this browser. Nothing is uploaded to a server.</p>
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

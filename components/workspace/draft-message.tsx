"use client";

import { Check, Copy, Languages, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { draftMessageAi } from "@/lib/llm/clientApi";
import { MACHINE_DRAFTED } from "@/lib/insights/messages";
import { useWorkspace } from "./context";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked: the text is on screen to select by hand.
          setCopied(false);
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

const LANGS = ["Kannada", "Hindi", "English"] as const;
type Lang = (typeof LANGS)[number];

interface Drafted {
  message: string;
  back: string;
  language: Lang;
}

/**
 * A draft message the team can copy or share (SPEC §15.9). It starts as the English template. With an application
 * it can be written by the AI in the partner's language, from the decision record only, with an English back-translation.
 */
export function DraftMessageDialog({
  open,
  onOpenChange,
  title,
  text,
  language,
  appKey,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  text: string;
  language: string | null;
  appKey?: string;
}) {
  const { decisionByKey } = useWorkspace();
  const d = appKey ? decisionByKey.get(appKey) : undefined;
  const preferred: Lang = (LANGS as readonly string[]).includes(language ?? "") ? (language as Lang) : "English";
  const [lang, setLang] = useState<Lang>(preferred);
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function write() {
    if (!d) return;
    setBusy(true);
    setProblem(null);
    const r = await draftMessageAi({
      appId: d.appId,
      firstName: d.name.trim().split(/\s+/)[0] ?? "",
      language: lang,
      status: d.status,
      label: d.label,
      headline: d.headline,
      steps: d.partnerSteps.slice(0, 3),
      questions: d.questions.slice(0, 4),
    });
    setBusy(false);
    if (r.kind === "ok") setDrafted({ message: r.message, back: r.backTranslation, language: lang });
    else if (r.kind === "rejected") setProblem("The AI's draft said something the decision doesn't, so it wasn't used. The English template below is safe to send; you can try again.");
    else setProblem("The AI assistant isn't available right now. The English template below is ready to use.");
  }

  const shown = drafted ? drafted.message : text;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Pill tone="warn">{MACHINE_DRAFTED}</Pill>
            {!drafted && language && language !== "English" && <span>Their preferred language is {language}. This is the English template; the AI can write it in {language}.</span>}
          </DialogDescription>
        </DialogHeader>

        {d && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="draft-lang" className="sr-only">
              Language
            </label>
            <select id="draft-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" onClick={() => void write()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Write in {lang} with AI
            </Button>
            {drafted && (
              <Button variant="ghost" size="sm" onClick={() => setDrafted(null)}>
                Use the English template
              </Button>
            )}
          </div>
        )}
        {problem && (
          <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">
            {problem}
          </p>
        )}

        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-sans text-sm" tabIndex={0} aria-label="Draft message" lang={drafted ? { Kannada: "kn", Hindi: "hi", English: "en" }[drafted.language] : "en"}>
          {shown}
        </pre>
        {drafted && drafted.language !== "English" && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Languages aria-hidden className="size-3.5" /> English back-translation, for you to check
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg border border-dashed p-3 text-sm" data-testid="back-translation">
              {drafted.back}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <CopyButton text={shown} />
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shown)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-muted"
          >
            <MessageCircle className="size-4" aria-hidden /> Share on WhatsApp
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MACHINE_DRAFTED } from "@/lib/insights/messages";

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

/** A draft message the team can copy or share (SPEC §15.9). Applicant words appear as plain text only. */
export function DraftMessageDialog({
  open,
  onOpenChange,
  title,
  text,
  language,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  text: string;
  language: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Pill tone="warn">{MACHINE_DRAFTED}</Pill>
            {language && language !== "English" && <span>Their preferred language is {language}. The message is in English for now; translation arrives with the assistant.</span>}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-sans text-sm" tabIndex={0} aria-label="Draft message">
          {text}
        </pre>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={text} />
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
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

"use client";

import { ChevronDown, ChevronUp, FlaskConical, Loader2, Send, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatReply } from "@/lib/chat/engine";
import { EXAMPLE_QUESTIONS } from "@/lib/chat/router";
import { REASON_TEXT } from "@/lib/engine/reasons";
import { useStore, type ChatMsg } from "@/lib/state/store";
import { useWorkspace } from "./context";
import { DiffList } from "./diff-card";

const LIMIT = 2000;

function ViaNote({ via }: { via: ChatReply["via"] }) {
  if (via === "ai") return <span className="text-xs text-muted-foreground">Worded by AI from the engine&apos;s facts. The decision itself comes from the rules.</span>;
  if (via === "template") return <span className="text-xs text-muted-foreground">Template answer: the AI&apos;s wording didn&apos;t match the engine&apos;s facts, so it wasn&apos;t used.</span>;
  return null;
}

function Assistant({ msg }: { msg: ChatMsg }) {
  const r = msg.reply;
  const { session } = useWorkspace();
  const undo = useStore((s) => s.undo);
  const openDrawer = useStore((s) => s.openDrawer);
  const ask = useStore((s) => s.askChat);
  const [more, setMore] = useState(false);
  const entry = r?.entryId ? session.entries.find((e) => e.id === r.entryId) : undefined;
  const app = r?.appKey ? session.parsed.applications.find((a) => a.key === r.appKey) : undefined;

  return (
    <div className="max-w-[46rem] space-y-2 rounded-2xl rounded-tl-sm border bg-card p-3.5 text-sm">
      <p className="whitespace-pre-wrap text-pretty">{msg.text}</p>
      {r?.notice && <p className="text-xs text-muted-foreground">{r.notice}</p>}
      {r?.simulated && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
          <FlaskConical aria-hidden className="size-3.5" /> Simulation only. Nothing was saved.
        </p>
      )}
      {r?.diff && (r.diff.changes.length > 0 || r.diff.slots.length > 0) && <DiffList diff={r.diff} max={6} />}
      {r?.kind === "commit" && entry && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={entry.undone} onClick={() => undo(entry.id)}>
            <Undo2 /> {entry.undone ? "Undone" : "Undo"}
          </Button>
          <span className="text-xs text-muted-foreground">Saved in the change log.</span>
        </div>
      )}
      {r && r.chips.length > 0 && (
        <p className="flex flex-wrap gap-1.5" aria-label="Reason codes">
          {r.chips.map((c) => (
            <span key={c} title={REASON_TEXT[c as keyof typeof REASON_TEXT] ?? c} className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">
              {c}
            </span>
          ))}
        </p>
      )}
      {r && r.examples.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.examples.map((e) => (
            <button key={e} onClick={() => void ask(e)} className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted">
              {e}
            </button>
          ))}
        </div>
      )}
      {r?.details && (
        <div>
          <button onClick={() => setMore((x) => !x)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={more}>
            {more ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} {more ? "Hide details" : "Show details"}
          </button>
          {more && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{r.details}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {r && <Pill tone="info">{r.brand}</Pill>}
        {app && (
          <Button variant="ghost" size="sm" onClick={() => openDrawer(app.key)}>
            Open {app.id}
          </Button>
        )}
        {r && <ViaNote via={r.via} />}
      </div>
    </div>
  );
}

/** Ask about any decision, give a new fact, or ask "what if". Answers come from the engine; the AI only helps with wording and routing. */
export function Chat() {
  const messages = useStore((s) => s.chat.messages);
  const busy = useStore((s) => s.chat.busy);
  const ask = useStore((s) => s.askChat);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    void ask(t);
  }

  return (
    <div className="flex min-h-[60vh] flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Ask about the decisions</h2>
        <p className="text-sm text-muted-foreground">
          Ask why, compare two applications, or tell me something new (&quot;APP-012 has found a ground-floor space&quot;). New facts are applied with a diff and an Undo. Start a question with &quot;what if&quot; to simulate without changing anything.
        </p>
      </div>

      <div role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button key={q} onClick={() => void ask(q)} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[36rem] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ) : (
            <Assistant key={m.id} msg={m} />
          ),
        )}
        {busy && (
          <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Thinking…
          </p>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="sticky bottom-0 -mx-1 flex items-end gap-2 border-t bg-background/90 px-1 py-3 backdrop-blur"
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question or update
        </label>
        <Textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, LIMIT))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={LIMIT}
          placeholder="Why is APP-007 on hold?"
          className="min-h-0 resize-none"
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Send
        </Button>
      </form>
      {text.length > LIMIT - 200 && <p className="text-right text-xs text-muted-foreground">{text.length} of {LIMIT} characters</p>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles aria-hidden className="size-3.5" /> Decisions always come from the rules. Anything you say that isn&apos;t a question about these applications is declined.
      </p>
    </div>
  );
}

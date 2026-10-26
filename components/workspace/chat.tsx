"use client";

import { ChevronDown, ChevronUp, FlaskConical, Loader2, Send, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { RobotIcon } from "@/components/app/robot-icon";
import { Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatReply } from "@/lib/chat/engine";
import { EXAMPLE_QUESTIONS } from "@/lib/chat/router";
import { REASON_TEXT } from "@/lib/engine/reasons";
import { useStore, type ChatMsg } from "@/lib/state/store";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./context";
import { DiffList } from "./diff-card";

const LIMIT = 2000;
const ID_RE = /\b((?:APP|TER)-\d+)\b/g;

/** Text with application and territory IDs turned into links: an application opens its decision, a territory opens the Territories board. */
export function LinkedText({ text }: { text: string }) {
  const { decisionById } = useWorkspace();
  const openDrawer = useStore((s) => s.openDrawer);
  const setTab = useStore((s) => s.setTab);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const parts = text.split(ID_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const app = part.startsWith("APP-") ? decisionById.get(part) : undefined;
        if (part.startsWith("APP-") && !app) return <Fragment key={i}>{part}</Fragment>;
        return (
          <button
            key={i}
            type="button"
            className="rounded-sm font-medium text-accent-brand underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2"
            aria-label={app ? `Open the decision for ${part}` : `Open the territories board for ${part}`}
            onClick={() => {
              setChatOpen(false);
              if (app) openDrawer(app.appKey);
              else setTab("territories");
            }}
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

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
  const setChatOpen = useStore((s) => s.setChatOpen);
  const ask = useStore((s) => s.askChat);
  const [more, setMore] = useState(false);
  const entry = r?.entryId ? session.entries.find((e) => e.id === r.entryId) : undefined;
  const app = r?.appKey ? session.parsed.applications.find((a) => a.key === r.appKey) : undefined;

  return (
    <div className="max-w-full space-y-2 rounded-2xl rounded-tl-sm border bg-card p-3 text-sm">
      <p className="whitespace-pre-wrap text-pretty">
        <LinkedText text={msg.text} />
      </p>
      {r?.notice && <p className="text-xs text-muted-foreground">{r.notice}</p>}
      {r?.simulated && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
          <FlaskConical aria-hidden className="size-3.5" /> Simulation only. Nothing was saved.
        </p>
      )}
      {r?.diff && (r.diff.changes.length > 0 || r.diff.slots.length > 0) && <DiffList diff={r.diff} max={5} />}
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
          {more && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">
              <LinkedText text={r.details} />
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {r && <Pill tone="info">{r.brand}</Pill>}
        {app && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChatOpen(false);
              openDrawer(app.key);
            }}
          >
            Open {app.id}
          </Button>
        )}
        {r && <ViaNote via={r.via} />}
      </div>
    </div>
  );
}

/** The conversation and its input, inside the assistant panel. */
function ChatBody({ autoFocus }: { autoFocus: boolean }) {
  const messages = useStore((s) => s.chat.messages);
  const busy = useStore((s) => s.chat.busy);
  const ask = useStore((s) => s.askChat);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    void ask(t);
  }

  return (
    <>
      <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Ask why a decision was made, compare two applications, or tell me something new. New facts are applied with a diff and an Undo. Start with &quot;what if&quot; to simulate.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button key={q} onClick={() => void ask(q)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs hover:bg-muted">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
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
        className="flex items-end gap-2 border-t bg-card p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question or update
        </label>
        <Textarea
          id="chat-input"
          ref={input}
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
        <Button type="submit" size="icon" aria-label="Send" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
      {text.length > LIMIT - 200 && <p className="px-3 pb-2 text-right text-xs text-muted-foreground">{text.length} of {LIMIT} characters</p>}
    </>
  );
}

/**
 * The assistant: a round button at the bottom right that opens a chat panel over the page. It is not a screen of its
 * own, so you can ask while looking at any tab. Escape closes it and returns focus to the button.
 */
export function ChatWidget() {
  const open = useStore((s) => s.chatOpen);
  const setOpen = useStore((s) => s.setChatOpen);
  const busy = useStore((s) => s.chat.busy);
  const launcher = useRef<HTMLButtonElement>(null);

  return (
    <div className="no-print">
      {open && (
        <section
          id="assistant-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              launcher.current?.focus();
            }
          }}
          className={cn(
            "fixed inset-x-2 bottom-[5.25rem] top-16 z-[60] flex flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl",
            "sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[min(36rem,calc(100dvh-7rem))] sm:w-[26rem]",
          )}
        >
          <header className="flex items-center gap-3 border-b bg-card px-3 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary p-1.5 text-primary-foreground">
              <RobotIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-tight">Assistant</h2>
              <p className="truncate text-xs text-muted-foreground">Decisions always come from the rules.</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close the assistant"
              onClick={() => {
                setOpen(false);
                launcher.current?.focus();
              }}
            >
              <X />
            </Button>
          </header>
          <ChatBody autoFocus />
        </section>
      )}
      <button
        ref={launcher}
        type="button"
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        aria-expanded={open}
        aria-controls="assistant-panel"
        title="Ask about the decisions"
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-[60] grid size-14 place-items-center rounded-full bg-primary p-2.5 text-primary-foreground shadow-lg outline-offset-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <RobotIcon />
        {busy && !open && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-3.5 animate-pulse rounded-full border-2 border-background bg-st-approved-dot" />}
      </button>
    </div>
  );
}

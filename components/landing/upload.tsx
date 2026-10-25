"use client";

import { AlertCircle, FileSpreadsheet, FileUp, History, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES } from "@/lib/ingest/parseWorkbook";
import { parseSessionFile, useStore } from "@/lib/state/store";
import { cn } from "@/lib/utils";

/** Read files in the browser and open the workspace. Nothing here touches a server (G7.1). */
export function useUpload() {
  const router = useRouter();
  const startFromParse = useStore((s) => s.startFromParse);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function parseFiles(files: { name: string; size: number; data: ArrayBuffer }[]) {
    setBusy(true);
    setErrors([]);
    try {
      const { parseWorkbooks } = await import("@/lib/ingest/parseWorkbook");
      const result = parseWorkbooks(files.map((f) => ({ name: f.name, size: f.size, data: f.data })));
      if (!result.ok) {
        setErrors(result.errors);
        return false;
      }
      startFromParse(result, files.map((f) => f.name));
      router.push("/workspace");
      return true;
    } catch {
      setErrors(["Something went wrong reading that file. Check it opens in Excel, then try again."]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(list: FileList | File[]) {
    const files = [...list];
    if (files.length === 0) return;
    // Size and type are checked by the parser too; checking size here avoids reading a huge file into memory.
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setErrors([`"${tooBig.name}" is ${(tooBig.size / (1024 * 1024)).toFixed(1)} MB. The limit is 5 MB per file.`]);
      return;
    }
    setBusy(true);
    try {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, data: await f.arrayBuffer() })));
      await parseFiles(read);
    } catch {
      setBusy(false);
      setErrors(["That file couldn't be opened. Try saving it again from Excel."]);
    }
  }

  async function onSample() {
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/data/sampleWorkbook.xlsx");
      if (!res.ok) throw new Error("sample");
      const data = await res.arrayBuffer();
      await parseFiles([{ name: "sampleWorkbook.xlsx", size: data.byteLength, data }]);
    } catch {
      setBusy(false);
      setErrors(["The sample data couldn't be loaded. Check your connection and try again."]);
    }
  }

  return { busy, errors, setErrors, onFiles, onSample };
}

export function UploadZone({ upload }: { upload: ReturnType<typeof useUpload> }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { busy, errors, onFiles } = upload;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-2xl border-2 border-dashed bg-card p-8 text-center transition-colors",
          over ? "border-accent-brand bg-accent" : "border-border",
        )}
      >
        <FileSpreadsheet aria-hidden className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Drop your Excel file here</p>
        <p className="mt-1 text-sm text-muted-foreground">One workbook with Applications and Territories sheets, or two CSV files. Up to 5 MB.</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="sr-only"
          aria-label="Choose your Excel or CSV file"
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button className="mt-4" size="lg" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
          {busy ? "Reading your file…" : "Choose a file"}
        </Button>
      </div>
      {errors.length > 0 && (
        <div role="alert" className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertCircle aria-hidden className="size-4" /> We couldn&apos;t use that file
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">Fix it and upload again, or try the sample data to see how it works.</p>
        </div>
      )}
    </div>
  );
}

export function ResumeSession() {
  const router = useRouter();
  const resume = useStore((s) => s.resume);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    if (file.size > 20 * 1024 * 1024) {
      setError("That file is too large to be a session file.");
      return;
    }
    const parsed = parseSessionFile(await file.text());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    resume(parsed.session);
    router.push("/workspace");
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Choose a saved session file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <Button variant="outline" onClick={() => input.current?.click()}>
        <History /> Resume a saved session
      </Button>
      {error && (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

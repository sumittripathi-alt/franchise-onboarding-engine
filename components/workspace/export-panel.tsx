"use client";

import { FileDown, FileJson, Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { downloadBlob } from "@/components/app/download";
import { Panel } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { EXPORT_SHEETS } from "@/lib/export/sheets";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";

export function ExportPanel() {
  const w = useWorkspace();
  const exportSessionText = useStore((s) => s.exportSessionText);
  const setTab = useStore((s) => s.setTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function excel() {
    setBusy(true);
    setError(null);
    try {
      // Loaded on demand: the spreadsheet library is only needed for upload and export.
      const { buildExportWorkbook, workbookToBlob } = await import("@/lib/export/workbook");
      const wb = buildExportWorkbook({
        session: w.session,
        applications: w.applications,
        result: w.result,
        insights: w.insights,
        actions: w.actions,
        settings: { profileLabel: w.policy.profile.label, today: w.settings.today },
        entries: w.session.entries,
        feedback: w.session.feedback,
        languages: w.languages,
      });
      downloadBlob(workbookToBlob(wb), `decisions-${w.settings.today}.xlsx`);
    } catch {
      setError("The workbook couldn't be built. Try again, or download the session file instead.");
    } finally {
      setBusy(false);
    }
  }

  function session() {
    const text = exportSessionText();
    if (text) downloadBlob(new Blob([text], { type: "application/json" }), `session-${w.settings.today}.json`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Export</h2>
        <p className="text-sm text-muted-foreground">Take the decisions out of the tool, or save your place and pick it up on any device.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel className="space-y-3">
          <h3 className="font-semibold">Excel workbook</h3>
          <p className="text-sm text-muted-foreground">Your own columns first, then the decision, the why and the next steps for each application, so the team can work from it directly.</p>
          <Button onClick={excel} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FileDown />} Download .xlsx
          </Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </Panel>
        <Panel className="space-y-3">
          <h3 className="font-semibold">Session file</h3>
          <p className="text-sm text-muted-foreground">Your data, changes, brand type and date in one file. &ldquo;Resume a saved session&rdquo; on the first page opens it with identical decisions.</p>
          <Button variant="outline" onClick={session}>
            <FileJson /> Download session
          </Button>
        </Panel>
        <Panel className="space-y-3">
          <h3 className="font-semibold">Print the decision sheet</h3>
          <p className="text-sm text-muted-foreground">One row per application: what happens, why, what they do next, and how they will be prepared.</p>
          <Button
            variant="outline"
            onClick={() => {
              setTab("sheet");
              setTimeout(() => window.print(), 150);
            }}
          >
            <Printer /> Print
          </Button>
        </Panel>
      </div>
      <Panel>
        <h3 className="text-sm font-semibold">What is in the workbook</h3>
        <ol className="mt-2 grid list-decimal gap-x-8 pl-5 text-sm text-muted-foreground sm:grid-cols-2">
          {EXPORT_SHEETS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Text that could be read as a formula is stored as plain text, so a note like &ldquo;=1+1&rdquo; can never run.</p>
      </Panel>
    </div>
  );
}

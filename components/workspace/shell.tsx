"use client";

import { ClipboardList, Download, FileDown, History, LayoutDashboard, Map as MapIcon, MapPinned, MessageSquareText, Scale, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { downloadBlob } from "@/components/app/download";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/planner/dates";
import { useStore, type Tab } from "@/lib/state/store";
import { cn } from "@/lib/utils";
import { ApplicationsTable } from "./applications-table";
import { Banners } from "./banners";
import { ShareButton, SyncBanner } from "./sync-notices";
import { ChangeLog } from "./change-log";
import { Chat } from "./chat";
import { CompareDialog } from "./compare-dialog";
import { useWorkspace } from "./context";
import { DecisionSheet } from "./decision-sheet";
import { Drawer } from "./drawer";
import { ExportPanel } from "./export-panel";
import { LastChangeCard } from "./last-change";
import { MapTab } from "./map-view";
import { Overview } from "./overview";
import { PolicyPanel } from "./policy";
import { Territories } from "./territories";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "sheet", label: "Decision sheet", icon: ClipboardList },
  { id: "chat", label: "Ask", icon: MessageSquareText },
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: Table2 },
  { id: "territories", label: "Territories", icon: MapPinned },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "policy", label: "Policy", icon: Scale },
  { id: "log", label: "Change log", icon: History },
  { id: "export", label: "Export", icon: FileDown },
];

export function Shell() {
  const w = useWorkspace();
  const router = useRouter();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const reset = useStore((s) => s.reset);
  const id = useStore((s) => s.workspaceId);
  const exportSessionText = useStore((s) => s.exportSessionText);

  function downloadSession() {
    const text = exportSessionText();
    if (text) downloadBlob(new Blob([text], { type: "application/json" }), `session-${w.settings.today}.json`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4">
            <Logo href={`/w/${id}`} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {w.session.files.join(", ")} · {w.policy.profile.label} · {formatDate(w.settings.today)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/" className="contents">
              <Button variant="ghost" size="sm" aria-label="Upload another file">
                <Upload /> <span className="hidden sm:inline">Upload another file</span>
              </Button>
            </Link>
            <ShareButton />
            <Button variant="ghost" size="sm" onClick={downloadSession} aria-label="Download session">
              <Download /> <span className="hidden sm:inline">Download session</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                router.push("/");
              }}
            >
              Leave
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[92rem] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-8">
        <nav aria-label="Sections" className="no-print md:sticky md:top-20 md:h-fit md:w-48 md:shrink-0">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:flex-col md:overflow-visible md:pb-0">
            {TABS.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                    tab === t.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <t.icon className="size-4" aria-hidden /> {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="min-w-0 flex-1 space-y-4 pb-24">
          <SyncBanner />
          <Banners />
          {tab === "sheet" && <DecisionSheet />}
          {tab === "chat" && <Chat />}
          {tab === "overview" && <Overview />}
          {tab === "applications" && <ApplicationsTable />}
          {tab === "territories" && <Territories />}
          {tab === "map" && <MapTab />}
          {tab === "policy" && <PolicyPanel />}
          {tab === "log" && <ChangeLog />}
          {tab === "export" && <ExportPanel />}
        </main>
      </div>

      <Drawer />
      <CompareDialog />
      <LastChangeCard />
    </div>
  );
}

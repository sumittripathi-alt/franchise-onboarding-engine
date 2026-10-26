"use client";

import "leaflet/dist/leaflet.css";
import { MapPinOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { StatusChip } from "@/components/app/status-chip";
import { Panel } from "@/components/app/ui-bits";
import { CITY_CENTRES, KARNATAKA_VIEW } from "@/lib/geo/cities";
import { haversineKm } from "@/lib/geo/distance";
import { STATUS_COLOUR } from "@/lib/insights/charts";
import { buildMapModel, type MapModel, type MapPoint } from "@/lib/insights/map";
import { STATUSES } from "@/lib/types";
import { useStore } from "@/lib/state/store";
import { useWorkspace } from "./context";

type LayerKey = "stores" | "applicants" | "competitors" | "territoryPins" | "whiteSpace";

const LAYERS: { key: LayerKey; label: string; hint: string }[] = [
  { key: "stores", label: "Existing stores and their rings", hint: "A ring shows where no new store may open." },
  { key: "applicants", label: "Applicants, by decision", hint: "Each is drawn at the pin they asked for." },
  { key: "competitors", label: "Lines between competitors", hint: "Applicants who were competing for the same pin or slot." },
  { key: "territoryPins", label: "Territory pins", hint: "Small dots for each pin in a territory." },
  { key: "whiteSpace", label: "Recruit here", hint: "Pins nobody applied for, in territories with free slots." },
];

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

type MapState = "loading" | "ready" | "tiles-failed" | "error";

/** Plain DOM, never HTML: applicant names and words are shown as text (G6.3). */
function tip(lines: string[]): HTMLElement {
  const el = document.createElement("div");
  lines.forEach((t, i) => {
    const p = document.createElement(i === 0 ? "strong" : "div");
    p.textContent = t;
    el.appendChild(p);
  });
  return el;
}

/**
 * The map (SPEC §10.1). Every fact on it is also written out below it, and if the map background can't load the places
 * are still drawn and the page says so (G8.4): nothing needs the map to be understood.
 */
export function MapTab() {
  const { result, board, policy } = useWorkspace();
  const openDrawer = useStore((s) => s.openDrawer);
  const model = useMemo(() => buildMapModel(result, board, policy.profile), [result, board, policy.profile]);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ stores: true, applicants: true, competitors: true, territoryPins: true, whiteSpace: true });
  const [focus, setFocus] = useState<string>("all");
  const [state, setState] = useState<MapState>("loading");
  /** Bumped when the map has been created, so the drawing effect runs once it exists. */
  const [layersReady, setLayersReady] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<{ L: typeof Leaflet; map: Leaflet.Map; groups: Record<LayerKey, Leaflet.LayerGroup> } | null>(null);

  const cities = useMemo(() => [...new Set([...model.stores.map((s) => s.city), ...result.territories.map((t) => t.city ?? "")].filter(Boolean))].sort(), [model.stores, result.territories]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const el = host.current;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !el) return;
        const map = L.map(el, { center: [KARNATAKA_VIEW.lat, KARNATAKA_VIEW.lng], zoom: KARNATAKA_VIEW.zoom, zoomControl: true, attributionControl: true });
        let loaded = 0;
        let failed = 0;
        const tiles = L.tileLayer(TILES, { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
        tiles.on("tileload", () => {
          loaded++;
          if (!cancelled) setState("ready");
        });
        tiles.on("tileerror", () => {
          failed++;
          if (failed >= 4 && loaded === 0 && !cancelled) setState("tiles-failed");
        });
        // No tile at all within a few seconds (offline, blocked): say so, and keep drawing everything else.
        timer = setTimeout(() => {
          if (loaded === 0 && !cancelled) setState("tiles-failed");
        }, 7000);
        const groups = { stores: L.layerGroup(), applicants: L.layerGroup(), competitors: L.layerGroup(), territoryPins: L.layerGroup(), whiteSpace: L.layerGroup() };
        el.setAttribute("role", "region");
        el.setAttribute("aria-label", "Map of stores, applicants and free pins. The same facts are written out below the map.");
        live.current = { L, map, groups };
        setLayersReady((n) => n + 1);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      live.current?.map.remove();
      live.current = null;
    };
  }, []);

  // Draw (and redraw) what the data and the toggles say.
  useEffect(() => {
    const lv = live.current;
    if (!lv) return;
    const { L, map, groups } = lv;
    for (const g of Object.values(groups)) g.clearLayers();
    const ll = (p: MapPoint) => [p.lat, p.lng] as [number, number];
    const bounds: [number, number][] = [];
    const inFocus = (city: string | null | undefined) => focus === "all" || city === focus;
    const focusCentre = focus !== "all" ? CITY_CENTRES[focus as keyof typeof CITY_CENTRES] : null;
    // Zooming to a city fits the points near it. One applicant whose pin is in another city is still drawn, but doesn't pull the view away.
    const fit = (p: MapPoint) => {
      if (!focusCentre || haversineKm(p, focusCentre) <= 40) bounds.push(ll(p));
    };

    for (const s of model.stores) {
      if (!inFocus(s.city)) continue;
      fit(s.point);
      L.circleMarker(ll(s.point), { radius: 7, color: "#111827", weight: 2, fillColor: "#ffffff", fillOpacity: 1, dashArray: s.point.approximate ? "3 2" : undefined }).bindTooltip(tip([s.id, s.text]), { direction: "top" }).addTo(groups.stores);
      if (s.radiusKm !== null && !s.point.approximate) L.circle(ll(s.point), { radius: s.radiusKm * 1000, color: "#6b7280", weight: 1.5, dashArray: "6 4", fillColor: "#6b7280", fillOpacity: 0.08 }).addTo(groups.stores);
    }
    for (const a of model.applicants) {
      const city = result.decisions.find((d) => d.appKey === a.appKey)?.city;
      if (!inFocus(city)) continue;
      fit(a.point);
      const m = L.circleMarker(ll(a.point), {
        radius: 6,
        color: STATUS_COLOUR[a.status],
        weight: 2,
        fillColor: STATUS_COLOUR[a.status],
        fillOpacity: a.point.approximate ? 0.2 : 0.85,
        dashArray: a.point.approximate ? "3 2" : undefined,
      });
      m.bindTooltip(tip([`${a.appId} · ${a.label}`, a.text]), { direction: "top" });
      m.on("click", () => openDrawer(a.appKey));
      m.addTo(groups.applicants);
      if (a.offered) L.polyline([ll(a.point), ll(a.offered.point)], { color: STATUS_COLOUR.REDIRECT, weight: 1.5, dashArray: "2 5" }).bindTooltip(tip([`${a.appId} is offered pin ${a.offered.pin}`]), { sticky: true }).addTo(groups.applicants);
    }
    for (const c of model.competitions) {
      const fa = model.applicants.find((a) => a.appId === c.a);
      if (!fa || !inFocus(result.decisions.find((d) => d.appKey === fa.appKey)?.city)) continue;
      if (c.from.lat === c.to.lat && c.from.lng === c.to.lng) continue;
      L.polyline([ll(c.from), ll(c.to)], { color: "#9333ea", weight: 1.5, opacity: 0.7 }).bindTooltip(tip([`${c.a} and ${c.b}`, c.text]), { sticky: true }).addTo(groups.competitors);
    }
    for (const t of model.territoryPins) {
      const city = result.territories.find((x) => x.id === t.territoryId)?.city;
      if (!inFocus(city)) continue;
      L.circleMarker(ll(t.point), { radius: 3, color: "#94a3b8", weight: 1, fillColor: "#94a3b8", fillOpacity: t.point.approximate ? 0.15 : 0.6, dashArray: t.point.approximate ? "2 2" : undefined }).bindTooltip(tip([`${t.territoryId} · pin ${t.pin}`, t.text]), { direction: "top" }).addTo(groups.territoryPins);
    }
    for (const w of model.whiteSpace) {
      const city = result.territories.find((x) => x.id === w.territoryId)?.city;
      if (!inFocus(city)) continue;
      fit(w.point);
      L.marker(ll(w.point), {
        keyboard: false,
        icon: L.divIcon({ className: "", html: "", iconSize: [0, 0] }),
      })
        .bindTooltip(tip([`Recruit here: pin ${w.pin}`, w.text]), { permanent: true, direction: "right", className: "map-recruit" })
        .addTo(groups.whiteSpace);
      L.circleMarker(ll(w.point), { radius: 8, color: "#0369a1", weight: 2, fillColor: "#0369a1", fillOpacity: 0.12, dashArray: w.point.approximate ? "3 2" : undefined }).addTo(groups.whiteSpace);
    }

    (Object.keys(groups) as LayerKey[]).forEach((k) => {
      if (layers[k]) groups[k].addTo(map);
      else groups[k].remove();
    });
    const centre = focusCentre;
    if (bounds.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    else if (centre) map.setView([centre.lat, centre.lng], 11);
    else map.setView([KARNATAKA_VIEW.lat, KARNATAKA_VIEW.lng], KARNATAKA_VIEW.zoom);
  }, [model, layers, focus, layersReady, result, openDrawer]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Map</h2>
        <p className="text-sm text-muted-foreground">
          Where the stores, applicants and free pins are. Everything on the map is also written out below it. A dashed marker means the location is only approximate.
        </p>
      </div>

      {state === "tiles-failed" && (
        <p role="status" data-map-fallback className="flex items-start gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
          <MapPinOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>The map background couldn&apos;t load (you may be offline, or it is blocked). The places are still drawn on a plain background, and everything on the map is written out below.</span>
        </p>
      )}
      {state === "error" && (
        <p role="status" data-map-fallback className="flex items-start gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
          <MapPinOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>The map couldn&apos;t start in this browser. Everything it would show is written out below.</span>
        </p>
      )}

      <div className={state === "error" ? "hidden" : "relative"}>
        <div ref={host} data-testid="map" className="z-0 h-[22rem] w-full overflow-hidden rounded-xl border bg-muted sm:h-[30rem]" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Legend">
        {STATUSES.map((s) => (
          <StatusChip key={s} status={s} label={model.applicants.find((a) => a.status === s)?.label ?? undefined} />
        ))}
        <span className="text-xs text-muted-foreground">Ring: no new store inside it. Purple line: competing applicants. Dashed: approximate location.</span>
      </div>

      <Panel className="space-y-3">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Show</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LAYERS.map((l) => (
              <label key={l.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={layers[l.key]} onChange={(e) => setLayers((x) => ({ ...x, [l.key]: e.target.checked }))} />
                <span>
                  <span className="font-medium">{l.label}</span>
                  <span className="block text-xs text-muted-foreground">{l.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="map-focus" className="text-sm font-medium">
            Zoom to
          </label>
          <select id="map-focus" value={focus} onChange={(e) => setFocus(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="all">All of Karnataka</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <MapInWords model={model} open={state === "tiles-failed" || state === "error"} />
    </div>
  );
}

/** Every fact on the map, as text (SPEC §15.8). */
function MapInWords({ model, open }: { model: MapModel; open: boolean }) {
  return (
    <details open={open || undefined} className="rounded-xl border bg-card p-4" data-testid="map-in-words">
      <summary className="cursor-pointer text-sm font-semibold">The map in words ({model.facts.reduce((n, f) => n + f.items.length, 0)} facts)</summary>
      <div className="mt-3 space-y-5 text-sm">
        {model.approximate.length > 0 && (
          <section>
            <h3 className="font-medium">Locations that are only approximate ({model.approximate.length})</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {model.approximate.map((a) => (
                <li key={a.pin}>
                  Pin {a.pin}: {a.why}. No distance rule uses it.
                </li>
              ))}
            </ul>
          </section>
        )}
        {model.facts.map((f) => (
          <section key={f.title}>
            <h3 className="font-medium">{f.title}</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {f.items.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

import React, { useRef, useEffect, useState, useCallback } from 'react';
import L from 'leaflet';
import { Building, Tree, Streetlight, Agent, HeatmapCell, SimulationParams, Vector2D, PastCrime, EnvironmentalIndex } from '../types';
import { projectCoordinate, unprojectCoordinate } from '../constants/coordinates';
import { Tract } from '../constants/tracts';
import { generatePastCrimesForTract } from '../utils/pastCrimes';
import { Tract4207Dataset } from '../utils/tract4207Data';
import { areStreetlightsDaytimeOff } from '../utils/simulation';
import { Eye, Sun, AlertTriangle, LightbulbOff, EyeOff, ShieldAlert, Sparkles, Navigation, AlertCircle, Clock } from 'lucide-react';
import { ZonePiece } from '../utils/zoningData';
import { zoneFillColor, zoneStrokeColor } from '../utils/zoningBuildingGenerator';
import { ExtendedBuilding } from '../utils/zoningBuildingGenerator';
import { ZoneConfigEntry } from '../constants/zoningConfig';
import { useLanguage } from '../i18n';

function getIndexRiskLevel(key: string, value: number): 'safe' | 'medium' | 'hazard' {
  if (key === 'GRN') return value > 65 ? 'medium' : 'safe';
  if (key === 'DEN' || key === 'HIS') return value > 65 ? 'hazard' : value > 35 ? 'medium' : 'safe';
  return value > 60 ? 'safe' : value > 35 ? 'medium' : 'hazard';
}

function getIndexColor(key: string, value: number): string {
  const level = getIndexRiskLevel(key, value);
  if (level === 'safe') return '#10b981';
  if (level === 'medium') return '#fbbf24';
  return '#ef4444';
}

function getHeatmapCellColor(risk: number, alpha: number): string {
  if (risk >= 0.75) return `rgba(220,38,38,${alpha})`;
  if (risk >= 0.55) return `rgba(249,115,22,${alpha})`;
  if (risk >= 0.35) return `rgba(250,204,21,${alpha})`;
  return `rgba(34,197,94,${alpha})`;
}

function safeLatLngToContainerPoint(map: L.Map | null, latlng: L.LatLngExpression): { x: number; y: number } | null {
  if (!map) return null;
  try {
    const pt = map.latLngToContainerPoint(latlng);
    if (!pt || isNaN(pt.x) || isNaN(pt.y)) return null;
    return { x: pt.x, y: pt.y };
  } catch (err) { return null; }
}

function safeContainerPointToLatLng(map: L.Map | null, point: L.PointExpression): L.LatLng | null {
  if (!map) return null;
  try {
    const latlng = map.containerPointToLatLng(point);
    if (!latlng || isNaN(latlng.lat) || isNaN(latlng.lng)) return null;
    return latlng;
  } catch (err) { return null; }
}

function pointInPolygonScreen(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const inter = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-10) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

interface MapCanvasProps {
  buildings: Building[];
  streetlights: Streetlight[];
  trees: Tree[];
  agents: Agent[];
  heatmap: HeatmapCell[];
  params: SimulationParams;
  onToggleStreetlight: (id: string) => void;
  selectedTract: Tract;
  environmentalIndices?: EnvironmentalIndex[];
  tract4207Dataset?: Tract4207Dataset | null;
  zonePieces?: ZonePiece[];
  zoneParams?: Record<string, ZoneConfigEntry>;
  sidebarOpen?: boolean;
  // Mobile props
  hideZoomControls?: boolean;
  legendOpen?: boolean;
  onToggleLegend?: () => void;
  bottomSheetOpen?: boolean;
}

export default function MapCanvas({
  buildings, streetlights, trees, agents, heatmap, params,
  onToggleStreetlight, selectedTract,
  environmentalIndices = [], tract4207Dataset = null,
  zonePieces = [], zoneParams = {},
  sidebarOpen = false,
  hideZoomControls = false,
  legendOpen,
  onToggleLegend,
  bottomSheetOpen = false,
}: MapCanvasProps) {
  const { t } = useLanguage();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const boundaryPolyRef = useRef<L.Polygon | null>(null);

  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [zoomLevel, setZoomLevel] = useState<number>(16);
  const [isLegendCollapsedInternal, setIsLegendCollapsedInternal] = useState<boolean>(true);
  const isLegendCollapsed = legendOpen !== undefined ? !legendOpen : isLegendCollapsedInternal;
  const toggleLegend = onToggleLegend || (() => setIsLegendCollapsedInternal(prev => !prev));
  const [mapMoveTick, setMapMoveTick] = useState<number>(0);

  // Hover states
  const [hoverPos, setHoverPos] = useState<Vector2D | null>(null);
  const [hoverCell, setHoverCell] = useState<HeatmapCell | null>(null);
  const [hoverStreetlight, setHoverStreetlight] = useState<Streetlight | null>(null);
  const [hoverPastCrime, setHoverPastCrime] = useState<PastCrime | null>(null);
  const [hoverEnvironmentalIndex, setHoverEnvironmentalIndex] = useState<EnvironmentalIndex | null>(null);
  const [hoverBuilding, setHoverBuilding] = useState<ExtendedBuilding | null>(null);

  // Throttle refs for performance
  const lastMouseMoveTs = useRef(0);
  const scenePointToScreen = (map: L.Map, point: Vector2D) => {
    const gps = unprojectCoordinate(point, 840, 600, 40, selectedTract.boundingBox);
    if (!gps || typeof gps.lat !== 'number' || typeof gps.lng !== 'number' || isNaN(gps.lat) || isNaN(gps.lng)) return null;
    return safeLatLngToContainerPoint(map, [gps.lat, gps.lng]);
  };

  const drawProjectedPath = (
    ctx: CanvasRenderingContext2D, map: L.Map,
    path: Vector2D[], strokeStyle: string, lineWidth: number, fillStyle?: string,
  ) => {
    const points = path.map(p => scenePointToScreen(map, p)).filter((p): p is { x: number; y: number } => p !== null);
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  };

  const pastCrimes = React.useMemo(() => generatePastCrimesForTract(selectedTract, 15), [selectedTract]);
  const hazardPoints = React.useMemo(() => {
    if (heatmap.length === 0) return [];

    const highRiskAreas = heatmap.filter(cell => cell.risk > 0.7 && cell.criminalEyes > 0.4);
    const targetCount = Math.max(0, Math.round(highRiskAreas.length / 12));
    if (targetCount === 0) return [];

    const sortedCandidates = [...heatmap]
      .filter(cell => cell.risk > 0.62)
      .sort((a, b) => {
        const scoreA = a.risk * 0.8 + a.criminalEyes * 0.2;
        const scoreB = b.risk * 0.8 + b.criminalEyes * 0.2;
        return scoreB - scoreA;
      });

    const selected: HeatmapCell[] = [];
    const minSpacing = 30;
    for (const cell of sortedCandidates) {
      const tooClose = selected.some(existing => Math.hypot(existing.x - cell.x, existing.y - cell.y) < minSpacing);
      if (tooClose) continue;
      selected.push(cell);
      if (selected.length >= targetCount) break;
    }

    return selected;
  }, [heatmap]);

  // Refs to avoid stale closures
  const streetlightsRef = useRef(streetlights);
  const buildingsRef = useRef(buildings);
  const heatmapRef = useRef(heatmap);
  const pastCrimesRef = useRef(pastCrimes);
  const environmentalIndicesRef = useRef(environmentalIndices);
  const paramsRef = useRef(params);
  useEffect(() => { streetlightsRef.current = streetlights; }, [streetlights]);
  useEffect(() => { buildingsRef.current = buildings; }, [buildings]);
  useEffect(() => { heatmapRef.current = heatmap; }, [heatmap]);
  useEffect(() => { pastCrimesRef.current = pastCrimes; }, [pastCrimes]);
  useEffect(() => { environmentalIndicesRef.current = environmentalIndices; }, [environmentalIndices]);
  useEffect(() => { paramsRef.current = params; }, [params]);

  // Resize
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      const mh = height > 100 ? height : (containerRef.current?.clientHeight || 650);
      setDimensions({ width: Math.floor(width), height: Math.floor(mh) });
      mapRef.current?.invalidateSize();
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ─── Leaflet map init ──────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let map: L.Map;
    try {
      const c = selectedTract?.center || { lat: 41.77669, lng: -87.61069 };
      const lat = isNaN(c.lat) ? 41.77669 : c.lat;
      const lng = isNaN(c.lng) ? -87.61069 : c.lng;
      map = L.map(mapContainerRef.current, {
        center: [lat, lng], zoom: 16, zoomControl: false,
        attributionControl: false, maxZoom: 19, minZoom: 14,
        zoomSnap: 0.25, zoomDelta: 0.35, wheelPxPerZoomLevel: 180,
      });
    } catch { return; }

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
    if (!hideZoomControls) {
      L.control.zoom({ position: 'topright' }).addTo(map);
    }

    const bPts = (selectedTract?.coordinates || [])
      .filter(c => c && !isNaN(c.lat) && !isNaN(c.lng))
      .map(c => [c.lat, c.lng] as L.LatLngExpression);
    if (bPts.length > 0) {
      boundaryPolyRef.current = L.polygon(bPts, {
        color: '#171717', weight: 2, opacity: 0.8,
        fillColor: '#000', fillOpacity: 0.015, dashArray: '5,5'
      }).addTo(map);
    }

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    // Debounced map events — throttle to ~20fps
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRedraw = () => {
      if (moveTimer) return;
      moveTimer = setTimeout(() => { moveTimer = null; setMapMoveTick(t => t + 1); }, 50);
    };
    map.on('move', scheduleRedraw);
    map.on('zoomend', () => { setZoomLevel(map.getZoom()); scheduleRedraw(); });
    map.on('viewreset', scheduleRedraw);

    // Click → streetlight toggle
    map.on('click', (e) => {
      if (!e.latlng || isNaN(e.latlng.lat) || isNaN(e.latlng.lng)) return;
      let best: Streetlight | null = null, bestD = 0.00035;
      for (const l of streetlightsRef.current) {
        const g = unprojectCoordinate(l.position, 840, 600, 40, selectedTract.boundingBox);
        if (!g || isNaN(g.lat) || isNaN(g.lng)) continue;
        const d = Math.hypot(e.latlng.lng - g.lng, e.latlng.lat - g.lat);
        if (d < bestD) { bestD = d; best = l; }
      }
      if (best) onToggleStreetlight(best.id);
    });

    // Mousemove — throttled to ~30fps
    map.on('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMouseMoveTs.current < 33) return;
      lastMouseMoveTs.current = now;

      if (!e.latlng || isNaN(e.latlng.lat) || isNaN(e.latlng.lng)) { setHoverPos(null); return; }
      const cPt = safeLatLngToContainerPoint(map, e.latlng);
      if (!cPt) { setHoverPos(null); return; }
      setHoverPos(cPt);

      const simPos = projectCoordinate({ lng: e.latlng.lng, lat: e.latlng.lat }, 840, 600, 40, selectedTract.boundingBox);
      const curParams = paramsRef.current;

      // 1. Building hover
      let bh: ExtendedBuilding | null = null;
      for (const b of (buildingsRef.current as ExtendedBuilding[])) {
        if (!b.polygon || b.polygon.length < 3) continue;
        const scr = b.polygon.map(p => pointToScreen(map, p)).filter((p): p is { x: number; y: number } => p !== null);
        if (scr.length >= 3 && pointInPolygonScreen(cPt, scr)) { bh = b; break; }
      }
      setHoverBuilding(bh);

      // 2. Streetlight hover
      let lh: Streetlight | null = null;
      let ld = 18;
      if (!bh) {
        for (const l of streetlightsRef.current) {
          const d = Math.hypot(simPos.x - l.position.x, simPos.y - l.position.y);
          if (d < ld) { ld = d; lh = l; }
        }
      }
      setHoverStreetlight(lh);

      // 3. Past crime hover
      let ch: PastCrime | null = null;
      let cd = 12;
      if (!bh && !lh && curParams.showPastCrimes) {
        for (const c of pastCrimesRef.current) {
          if (!c || isNaN(c.lat) || isNaN(c.lng)) continue;
          const pt = safeLatLngToContainerPoint(map, [c.lat, c.lng]);
          if (!pt) continue;
          const d = Math.hypot(cPt.x - pt.x, cPt.y - pt.y);
          if (d < cd) { cd = d; ch = c; }
        }
      }
      setHoverPastCrime(ch);

      // 4. Env index hover
      let ih: EnvironmentalIndex | null = null;
      let idist = 14;
      if (!bh && !lh && !ch && curParams.showEnvironmentalIndices) {
        for (const idx of environmentalIndicesRef.current) {
          if (!idx || isNaN(idx.lat) || isNaN(idx.lng)) continue;
          const pt = safeLatLngToContainerPoint(map, [idx.lat, idx.lng]);
          if (!pt) continue;
          const d = Math.hypot(cPt.x - pt.x, cPt.y - pt.y);
          if (d < idist) { idist = d; ih = idx; }
        }
      }
      setHoverEnvironmentalIndex(ih);

      // 5. Heatmap cell hover (only if nothing else)
      if (!bh && !lh && !ch && !ih && curParams.showHeatmap && heatmapRef.current.length > 0) {
        let bestCell: HeatmapCell | null = null;
        let cellD = 30;
        for (const cell of heatmapRef.current) {
          const d = Math.hypot(simPos.x - cell.x, simPos.y - cell.y);
          if (d < cellD) { cellD = d; bestCell = cell; }
        }
        setHoverCell(bestCell);
      } else { setHoverCell(null); }
    });

    map.on('mouseout', () => {
      setHoverPos(null); setHoverCell(null); setHoverStreetlight(null);
      setHoverPastCrime(null); setHoverEnvironmentalIndex(null); setHoverBuilding(null);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Helper: scene → screen, needs current map
  function pointToScreen(map: L.Map, pos: Vector2D) {
    const gps = unprojectCoordinate(pos, 840, 600, 40, selectedTract.boundingBox);
    if (!gps || isNaN(gps.lat) || isNaN(gps.lng)) return null;
    return safeLatLngToContainerPoint(map, [gps.lat, gps.lng]);
  }

  // Smooth tract switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = selectedTract?.center || { lat: 41.77669, lng: -87.61069 };
    map.flyTo([isNaN(c.lat) ? 41.77669 : c.lat, isNaN(c.lng) ? -87.61069 : c.lng], 16, { duration: 1 });
    const poly = boundaryPolyRef.current;
    if (poly) {
      const pts = (selectedTract?.coordinates || []).filter(c => c && !isNaN(c.lat) && !isNaN(c.lng)).map(c => [c.lat, c.lng] as L.LatLngExpression);
      if (pts.length > 0) poly.setLatLngs(pts);
    }
    setHoverPos(null); setHoverCell(null); setHoverStreetlight(null);
    setHoverPastCrime(null); setHoverEnvironmentalIndex(null); setHoverBuilding(null);
    setMapMoveTick(t => t + 1);
  }, [selectedTract]);

  // ─── Canvas Redraw ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    // CRITICAL FIX: use setTransform to reset every frame, NOT ctx.scale (which accumulates)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const zoomScale = Math.pow(1.45, zoomLevel - 16);

    const getSP = (pos: Vector2D) => {
      if (!pos || isNaN(pos.x) || isNaN(pos.y)) return { x: 0, y: 0 };
      const gps = unprojectCoordinate(pos, 840, 600, 40, selectedTract.boundingBox);
      if (!gps || isNaN(gps.lat) || isNaN(gps.lng)) return { x: 0, y: 0 };
      const pt = safeLatLngToContainerPoint(map, [gps.lat, gps.lng]);
      return pt || { x: 0, y: 0 };
    };

    // ── A. Neighborhood boundary ─────────────────────────
    {
      const pB = (selectedTract?.coordinates || []).filter(c => c && !isNaN(c.lat) && !isNaN(c.lng))
        .map(c => safeLatLngToContainerPoint(map, [c.lat, c.lng])).filter((p): p is { x: number; y: number } => p !== null);
      ctx.strokeStyle = 'rgba(23,23,23,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); pB.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── A2. Lot boundaries, greenery, parking pads ────────
    const extB = buildings as ExtendedBuilding[];
    for (const b of extB) {
      if (!b.lotCorners || !b.greenCorners || !b.parkCorners) continue;
      // Lot boundary — white dashed
      if (b.renderLot) {
        const lpts = b.lotCorners.map(p => pointToScreen(map, p)).filter((p): p is { x: number; y: number } => p !== null);
        if (lpts.length >= 4) {
          ctx.save(); ctx.setLineDash([6, 4]);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); lpts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
      }
      // Greenery
      if (b.renderGreen) drawProjectedPath(ctx, map, b.greenCorners, '#4a7a3a', 1, 'rgba(90,138,74,0.28)');
      // Parking
      if (b.renderPark) {
        const pkpts = b.parkCorners.map(p => pointToScreen(map, p)).filter((p): p is { x: number; y: number } => p !== null);
        if (pkpts.length >= 4) {
          ctx.save(); ctx.fillStyle = 'rgba(204,204,204,0.4)';
          ctx.beginPath(); pkpts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.fill();
          ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(170,170,170,0.75)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
      }
    }

    // ── B. Heatmap ───────────────────────────────────────
    if (params.showHeatmap && heatmap.length > 0) {
      const cw = 12 * zoomScale;
      for (const cell of heatmap) {
        const pt = getSP({ x: cell.x, y: cell.y });
        ctx.fillStyle = getHeatmapCellColor(cell.risk, cell.risk * params.heatmapOpacity * 0.75);
        ctx.fillRect(pt.x - cw / 2 + 0.5, pt.y - cw / 2 + 0.5, cw - 0.5, cw - 0.5);
      }
    }

    // ── C. Streetlight glow ──────────────────────────────
    const daylightLightsOff = areStreetlightsDaytimeOff(params.simHour);
    for (const l of streetlights) {
      if (l.status === 'off' || l.isBroken || daylightLightsOff) continue;
      const pt = getSP(l.position); const sr = l.radius * zoomScale;
      const g = ctx.createRadialGradient(pt.x, pt.y, 1, pt.x, pt.y, sr);
      g.addColorStop(0, 'rgba(253,224,71,0.12)'); g.addColorStop(0.4, 'rgba(253,224,71,0.04)'); g.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pt.x, pt.y, sr, 0, Math.PI * 2); ctx.fill();
    }

    // ── D. Buildings (flat ground footprint only) ────────
    for (const b of extB) {
      const ground = b.polygon.map(getSP);
      const isHov = hoverBuilding?.id === b.id;

      // Parks rendered differently from buildings
      if (b.isPark) {
        ctx.fillStyle = b.fillColor || 'rgba(100,160,80,0.40)';
        ctx.strokeStyle = isHov ? '#2d6a1e' : 'rgba(60,120,40,0.40)';
        ctx.lineWidth = isHov ? 2 : 1.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath(); ground.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);

        if (isHov) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ground.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
          ctx.setLineDash([]);
        }
        continue;
      }

      const gFill = b.fillColor || 'rgba(245,245,245,0.85)';
      const gStroke = isHov ? '#1a1a2e' : (b.strokeColor || 'rgba(115,115,115,0.25)');

      // Ground footprint
      ctx.fillStyle = gFill; ctx.strokeStyle = gStroke; ctx.lineWidth = isHov ? 1.5 : 0.8;
      ctx.beginPath(); ground.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
      ctx.fill(); ctx.stroke();

      // Hover highlight ring
      if (isHov) {
        ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ground.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ground.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── E. Trees ─────────────────────────────────────────
    for (const t of trees) {
      const pt = getSP(t.position); const sr = t.canopyRadius * zoomScale;
      ctx.fillStyle = 'rgba(0,0,0,0.04)'; ctx.beginPath(); ctx.arc(pt.x + 1.5 * zoomScale, pt.y + 1.5 * zoomScale, sr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(34,197,94,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(pt.x, pt.y, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(34,197,94,0.15)'; ctx.beginPath(); ctx.arc(pt.x, pt.y, sr * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(21,128,61,0.7)'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5 * zoomScale, 0, Math.PI * 2); ctx.fill();
    }

    // ── F. Streetlights ──────────────────────────────────
    for (const l of streetlights) {
      const isOff = l.status === 'off' || l.isBroken || daylightLightsOff;
      const pt = getSP(l.position);
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.beginPath(); ctx.arc(pt.x + 0.5, pt.y + 0.5, 3.1 * zoomScale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = l.isBroken ? '#64748b' : (daylightLightsOff ? 'rgba(251,191,36,0.35)' : (l.status === 'off' ? '#64748b' : '#fbbf24'));
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.4 * zoomScale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = l.isBroken ? 'rgba(71,85,105,0.35)' : (daylightLightsOff ? 'rgba(245,158,11,0.28)' : (l.status === 'off' ? 'rgba(71,85,105,0.35)' : 'rgba(245,158,11,0.55)'));
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.0 * zoomScale, 0, Math.PI * 2); ctx.stroke();
      if (!isOff) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5 * zoomScale, 0, Math.PI * 2); ctx.fill(); }
      else if (l.isBroken) {
        ctx.fillStyle = Math.floor(Date.now() / 400) % 2 === 0 ? '#ef4444' : '#991b1b';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5 * zoomScale, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── G. Past crimes ───────────────────────────────────
    if (params.showPastCrimes && pastCrimes.length > 0) {
      for (const c of pastCrimes) {
        if (!c || isNaN(c.lat) || isNaN(c.lng)) continue;
        const pt = safeLatLngToContainerPoint(map, [c.lat, c.lng]); if (!pt) continue;
        ctx.save(); ctx.fillStyle = 'rgba(220,38,38,0.15)'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 8 * zoomScale, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(220,38,38,0.65)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(pt.x, pt.y, 5 * zoomScale, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1; const len = 2.5 * zoomScale;
        ctx.beginPath(); ctx.moveTo(pt.x - len, pt.y - len); ctx.lineTo(pt.x + len, pt.y + len); ctx.moveTo(pt.x + len, pt.y - len); ctx.lineTo(pt.x - len, pt.y + len); ctx.stroke();
        ctx.restore();
      }
    }

    // ── G1. Active hazard points ────────────────────────
    if (hazardPoints.length > 0) {
      const pulse = (Date.now() % 1400) / 1400;
      for (const point of hazardPoints) {
        const pt = getSP({ x: point.x, y: point.y });
        const ringRadius = (7 + pulse * 6) * zoomScale;
        ctx.save();
        ctx.fillStyle = 'rgba(239,68,68,0.12)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7.5 * zoomScale, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(220,38,38,${0.8 - pulse * 0.35})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 5.5 * zoomScale);
        ctx.lineTo(pt.x + 5.5 * zoomScale, pt.y);
        ctx.lineTo(pt.x, pt.y + 5.5 * zoomScale);
        ctx.lineTo(pt.x - 5.5 * zoomScale, pt.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(7, Math.round(7.5 * zoomScale))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', pt.x, pt.y + 0.5);
        ctx.restore();
      }
    }

    // ── G2. Environmental indicators ─────────────────────
    if (params.showEnvironmentalIndices && environmentalIndices.length > 0) {
      for (const idx of environmentalIndices) {
        if (!idx || isNaN(idx.lat) || isNaN(idx.lng)) continue;
        const pt = safeLatLngToContainerPoint(map, [idx.lat, idx.lng]); if (!pt) continue;
        ctx.save();
        const ih = hoverEnvironmentalIndex?.key === idx.key;
        const color = getIndexColor(idx.key, idx.value);
        const pulse = (Date.now() % 1600) / 1600;
        ctx.strokeStyle = color; ctx.globalAlpha = ih ? 0.8 : 0.4 * (1 - pulse); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, (5 + 10 * pulse) * zoomScale, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pt.x, pt.y, 4 * zoomScale, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5 * zoomScale, 0, Math.PI * 2); ctx.fill();
        const pw = 26 * zoomScale, ph = 10 * zoomScale, px = pt.x - pw / 2, py = pt.y - 15 * zoomScale;
        ctx.fillStyle = ih ? 'rgba(23,23,23,0.9)' : 'rgba(23,23,23,0.75)'; ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(7.5 * zoomScale)}px "JetBrains Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(idx.key, pt.x, py + ph / 2 + 0.5);
        if (ih) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, 6 * zoomScale, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      }
    }

    // ── H. Agents ────────────────────────────────────────
    for (const a of agents) {
      if (!a.active) continue;
      const pt = getSP(a.position); const isC = a.type === 'criminal';
      if (params.showVisionCones || isC) {
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(a.angle);
        const fov = (a.visionAngle * Math.PI) / 180; const sr = a.visionRange * zoomScale;
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, sr);
        if (isC) {
          g.addColorStop(0, 'rgba(168,85,247,0.14)');
          g.addColorStop(0.6, 'rgba(168,85,247,0.05)');
          g.addColorStop(1, 'rgba(168,85,247,0)');
          ctx.strokeStyle = 'rgba(147,51,234,0.24)';
        }
        else {
          g.addColorStop(0, 'rgba(196,181,253,0.12)');
          g.addColorStop(0.6, 'rgba(196,181,253,0.04)');
          g.addColorStop(1, 'rgba(196,181,253,0)');
          ctx.strokeStyle = 'rgba(139,92,246,0.18)';
        }
        ctx.fillStyle = g; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, sr, -fov / 2, fov / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      if (isC) {
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.8 * zoomScale, 0, Math.PI * 2); ctx.fill();
        const pulse = (Date.now() % 1200) / 1200;
        ctx.strokeStyle = `rgba(239,68,68,${0.8 - pulse})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, (4 + 6 * pulse) * zoomScale, 0, Math.PI * 2); ctx.stroke();
      } else { ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.2 * zoomScale, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    // ── I / J. Hover highlights ──────────────────────────
    if (hoverStreetlight) {
      const pt = getSP(hoverStreetlight.position);
      ctx.strokeStyle = '#171717'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(pt.x, pt.y, 9 * zoomScale, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(23,23,23,0.12)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, hoverStreetlight.radius * zoomScale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (hoverPastCrime && !isNaN(hoverPastCrime.lat) && !isNaN(hoverPastCrime.lng)) {
      const pt = safeLatLngToContainerPoint(map, [hoverPastCrime.lat, hoverPastCrime.lng]);
      if (pt) { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pt.x, pt.y, 11 * zoomScale, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (hoverEnvironmentalIndex && !isNaN(hoverEnvironmentalIndex.lat) && !isNaN(hoverEnvironmentalIndex.lng)) {
      const pt = safeLatLngToContainerPoint(map, [hoverEnvironmentalIndex.lat, hoverEnvironmentalIndex.lng]);
      if (pt) { ctx.strokeStyle = getIndexColor(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pt.x, pt.y, 12 * zoomScale, 0, Math.PI * 2); ctx.stroke(); }
    }

  }, [dimensions, zoomLevel, mapMoveTick, buildings, streetlights, trees, agents, heatmap, hazardPoints, params, hoverStreetlight, hoverPastCrime, hoverEnvironmentalIndex, hoverBuilding, pastCrimes, environmentalIndices, selectedTract]);

  const gpsCoord = hoverPos && mapRef.current ? safeContainerPointToLatLng(mapRef.current, [hoverPos.x, hoverPos.y]) : null;
  const displayHour = Math.floor(params.simHour);
  const displayMinute = Math.round((params.simHour - displayHour) * 60);
  const formattedSimTime = `${displayHour.toString().padStart(2, '0')}:${displayMinute.toString().padStart(2, '0')}`;

  return (
    <div className="relative flex flex-col w-full h-full bg-neutral-100 overflow-hidden" id="crime-map-container" ref={containerRef}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 bg-white text-xs font-mono text-neutral-800 select-none z-[410] shrink-0">
        <div className="flex items-center gap-2">
          <Navigation className="w-3.5 h-3.5 text-neutral-900 rotate-45 animate-pulse" />
          <span className="font-bold tracking-wider text-neutral-950">GIS SPATIAL MONITOR / 芝加哥街区孪生仿真网格</span>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="hidden md:inline text-neutral-500">BOUNDS: {selectedTract.name} ({selectedTract.neighborhood.split('(')[0].trim()})</span>
          <span className="text-neutral-900 font-bold bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200 shadow-sm">ZOOM: {zoomLevel}</span>
        </div>
      </div>

      <div className="relative flex-grow w-full h-full">
        <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 1 }} />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ zIndex: 400 }} />

        <div className="absolute top-3 left-3 z-[430] pointer-events-none">
          <div className="rounded-md border border-neutral-200 bg-white/90 px-2.5 py-1.5 text-xs font-mono font-bold text-neutral-900 shadow-md backdrop-blur-sm">
            {formattedSimTime}
          </div>
        </div>

        {/* Floating HUD — shows for all hover types */}
        {hoverPos && (hoverBuilding || hoverCell || hoverStreetlight || hoverPastCrime || hoverEnvironmentalIndex) && (
          <div
            className="absolute p-3.5 bg-white border border-neutral-300 rounded shadow-lg text-[11px] font-mono text-neutral-800 flex flex-col gap-1.5 w-64 shadow-neutral-900/10"
            style={{
              left: Math.min(hoverPos.x + 18, dimensions.width - 275),
              top: Math.min(hoverPos.y + 18, dimensions.height - 220),
              zIndex: 500
            }}
          >
            <div className="flex justify-between items-center border-b border-neutral-200 pb-1 text-neutral-900 text-xs font-bold">
              <span>HUD SENSING / 智能感应</span>
              <span className="text-emerald-600 animate-pulse font-bold text-[9px] flex items-center gap-1 bg-emerald-50 px-1 rounded border border-emerald-200">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> LIVE
              </span>
            </div>

            {hoverBuilding ? (
              hoverBuilding.isPark ? (
                <div className="flex flex-col gap-1 border-t border-dashed border-neutral-200 pt-1.5">
                  <div className="font-bold text-xs text-emerald-700">
                    社区公园 / Public Park
                  </div>
                  <div className="text-neutral-600 text-[10px]">
                    <span>分区:</span> <span className="font-bold text-neutral-800">{hoverBuilding.zoneClass}</span>
                  </div>
                  <p className="text-[9px] text-neutral-500 italic leading-normal mt-1 bg-green-50 p-1.5 rounded border border-green-100">
                    居民区公共绿地空间 · 鼠标移开以关闭
                  </p>
                </div>
              ) : (
              <div className="flex flex-col gap-1 border-t border-dashed border-neutral-200 pt-1.5">
                <div className="font-bold text-xs text-neutral-900">
                  {hoverBuilding.zoneClass} · {hoverBuilding.zoneFamily === 'R' ? '住宅' : hoverBuilding.zoneFamily === 'B' ? '商业' : '混合'}
                </div>
                <div className="text-neutral-600 text-[10px]">
                  <span>尺寸:</span> <span className="font-bold text-neutral-800">{hoverBuilding.width?.toFixed(1) || '--'}×{hoverBuilding.depth?.toFixed(1) || '--'}m</span>
                </div>
                <div className="text-neutral-600 text-[10px]">
                  <span>楼层:</span> <span className="font-bold text-neutral-800">{hoverBuilding.stories}层 · {hoverBuilding.height}° 高度</span>
                </div>
                <div className="text-neutral-600 text-[10px]">
                  <span>密度:</span> <span className="font-bold text-neutral-800">{hoverBuilding.density} FAR</span>
                </div>
                <p className="text-[9px] text-neutral-500 italic leading-normal mt-1 bg-neutral-50 p-1.5 rounded border border-neutral-100">
                  鼠标移开以关闭 · 点击路灯可切换开关
                </p>
              </div>
              )
            ) : hoverEnvironmentalIndex ? (
              <div className="flex flex-col gap-1.5 border-t border-dashed border-neutral-200 pt-1.5">
                <div className="flex items-center justify-between font-bold" style={{ color: getIndexColor(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value) }}>
                  <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> {hoverEnvironmentalIndex.name.split(' (')[0]}</span>
                  <span className="text-[10px] uppercase font-bold bg-neutral-50 px-1 rounded border border-neutral-200">{hoverEnvironmentalIndex.key}</span>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>指标采样数值:</span>
                  <span className="font-bold text-neutral-900 text-xs" style={{ color: getIndexColor(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value) }}>{hoverEnvironmentalIndex.value}%</span>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>状态等级:</span>
                  <span className="font-bold uppercase" style={{ color: getIndexColor(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value) }}>
                    {getIndexRiskLevel(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value) === 'safe' ? '优秀 / 安全 (SAFE)' : getIndexRiskLevel(hoverEnvironmentalIndex.key, hoverEnvironmentalIndex.value) === 'medium' ? '中度 / 警戒 (WARN)' : '极高风险 (HAZARD)'}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-600 mt-1 leading-normal font-sans bg-neutral-50 p-1.5 rounded border border-neutral-100">{hoverEnvironmentalIndex.description}</p>
              </div>
            ) : hoverPastCrime ? (
              <div className="flex flex-col gap-1.5 border-t border-dashed border-neutral-200 pt-1.5">
                <div className="flex items-center justify-between font-bold text-red-600">
                  <span className="flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> 历史犯罪记录</span>
                  <span className="text-[10px] uppercase font-bold bg-red-50 px-1 rounded border border-red-200">{hoverPastCrime.type}</span>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-500"><span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> 案发时间:</span><span className="font-bold text-neutral-800">{hoverPastCrime.time}</span></div>
                <div className="flex justify-between text-[10px] text-neutral-500"><span>危害等级:</span><span className={`font-bold uppercase ${hoverPastCrime.severity === 'high' ? 'text-red-600' : hoverPastCrime.severity === 'medium' ? 'text-amber-600' : 'text-emerald-600'}`}>{hoverPastCrime.severity}</span></div>
                <p className="text-[10px] text-neutral-600 mt-1 italic leading-normal font-sans bg-neutral-50 p-1.5 rounded border border-neutral-100">* 警局通报: 在本街区过往记录中发生过该起案件。</p>
              </div>
            ) : hoverStreetlight ? (
              <div className="flex flex-col gap-1.5 border-t border-dashed border-neutral-200 pt-1.5">
                <div className="flex items-center justify-between font-bold text-neutral-900">
                  <span className="flex items-center gap-1"><Sun className="w-3.5 h-3.5 text-amber-500" /> 路灯运行状态</span>
                  <span className={hoverStreetlight.status === 'on' ? 'text-emerald-600 font-bold' : 'text-neutral-500'}>{hoverStreetlight.status === 'on' ? '开启 (ON)' : '关闭 (OFF)'}</span>
                </div>
                <div className="flex justify-between text-neutral-500"><span>路灯硬件状况:</span><span className={hoverStreetlight.isBroken ? 'text-red-500 font-bold bg-red-50 px-1 border border-red-200 rounded' : 'text-emerald-600'}>{hoverStreetlight.isBroken ? '损坏 (FAULT)' : '正常运行'}</span></div>
                <div className="text-neutral-500 text-[9px] mt-0.5 italic text-center font-sans bg-neutral-50 py-1 border border-neutral-100 rounded">* 鼠标左键点击该路灯可手动开关/修缮</div>
              </div>
            ) : hoverCell ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center font-bold">
                  <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="w-3.5 h-3.5 text-red-600 animate-bounce" /> 实时安全隐患系数:</span>
                  <span className={hoverCell.risk > 0.65 ? 'text-red-600 font-black text-xs' : hoverCell.risk > 0.35 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-medium'}>{(hoverCell.risk * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full bg-neutral-100 h-1.5 rounded-full overflow-hidden border border-neutral-200"><div className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500" style={{ width: `${hoverCell.risk * 100}%` }} /></div>
                <div className="grid grid-cols-2 gap-1.5 mt-1 border-t border-neutral-200 pt-1.5 text-neutral-500 text-[10px]">
                  <div><span>路灯有效照度:</span><span className="block text-neutral-800 font-bold">{(hoverCell.illumination * 100).toFixed(0)}%</span></div>
                  <div><span>旁观监视系数:</span><span className="block text-neutral-800 font-bold">{(hoverCell.bystanderEyes * 100).toFixed(0)}%</span></div>
                  <div className="col-span-2"><span>罪犯窥视死角增益:</span><span className="block text-red-600 font-bold">{(hoverCell.criminalEyes * 100).toFixed(0)}% 漏洞</span></div>
                </div>
              </div>
            ) : null}

            {gpsCoord && !hoverBuilding && (
              <div className="flex justify-between text-[10px] text-neutral-500 border-t border-neutral-100 pt-1 mt-0.5">
                <span>坐标 Lng/Lat:</span>
                <span className="text-neutral-800 font-bold">{gpsCoord.lng.toFixed(6)}, {gpsCoord.lat.toFixed(6)}</span>
              </div>
            )}
          </div>
        )}

        {/* Legend — mobile: externally controlled, no toggle button; desktop: self-contained */}
        {legendOpen !== undefined ? (
          // Mobile mode: no toggle button, panel shown/hidden by parent
          legendOpen && (
            <div
              className="absolute transition-all duration-300 ease-out"
              style={{ zIndex: 455, right: 24, bottom: bottomSheetOpen ? 'calc(40vh + 16px)' : '24px' }}
            >
              <div className="absolute bottom-0 right-0 bg-white/95 border border-neutral-200 rounded-lg flex flex-col gap-1 text-[9px] font-mono text-neutral-700 select-none w-[170px] shadow-lg backdrop-blur-md p-2.5 transition-all duration-300">
                <div className="font-bold border-b border-neutral-200 pb-1 text-[10px] text-neutral-800 tracking-wider flex items-center justify-between font-sans">
                  <span className="flex items-center gap-1"><Sparkles className="w-2.5 h-2.5 text-neutral-900" /> GIS LEGEND / 图例</span>
                  <button onClick={toggleLegend} className="text-[8px] text-neutral-400 hover:text-neutral-900 cursor-pointer">✕</button>
                </div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-800/60 inline-block border border-amber-900/40 shrink-0"></span><span>{t('legend.residential')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-800/60 inline-block border border-blue-900/40 shrink-0"></span><span>{t('legend.business')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-700/60 inline-block border border-emerald-900/40 shrink-0"></span><span>{t('legend.mixed')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0"></span><span>{t('legend.residents')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shrink-0"></span><span>{t('legend.criminals')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border border-emerald-400 inline-block shrink-0"></span><span>{t('legend.trees')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block shrink-0"></span><span>{t('legend.lightsOn')}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block shrink-0"></span><span>{t('legend.lightsFault')}</span></div>
                {params.showPastCrimes && (
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 border border-red-500 bg-red-50 inline-flex items-center justify-center text-[7px] text-red-600 font-bold shrink-0">X</span><span>{t('legend.pastCrimes')}</span></div>
                )}
                {hazardPoints.length > 0 && (
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-red-600 inline-flex items-center justify-center text-[7px] text-white font-bold shrink-0"><span className="-rotate-45">!</span></span><span>{t('legend.hazardPoints')}</span></div>
                )}
                {params.showHeatmap && (
                  <div className="flex flex-col gap-0.5 border-t border-neutral-200 pt-1 mt-0.5"><div className="flex justify-between text-neutral-400 text-[8px]"><span>{t('legend.safe')}</span><span>{t('legend.risk')}</span></div><div className="w-full h-1 bg-gradient-to-r from-emerald-500 via-amber-400 to-red-600 rounded-full" /></div>
                )}
              </div>
            </div>
          )
        ) : (
          // Desktop mode: self-contained toggle button + panel
          <div
            className="absolute bottom-6 transition-all duration-300 ease-out"
            style={{ zIndex: 455, right: sidebarOpen ? 'calc(min(90vw, 360px) + 24px)' : '24px' }}
          >
            {isLegendCollapsed ? (
              <button
                onClick={toggleLegend}
                className="w-12 h-12 bg-neutral-900 text-white rounded-full shadow-xl flex items-center justify-center active:scale-95 transition-transform duration-200"
                aria-label="Toggle legend"
              >
                <Sparkles className="w-5 h-5" />
              </button>
            ) : (
              <div className="absolute bottom-14 right-0 bg-white/95 border border-neutral-200 rounded-lg flex flex-col gap-1.5 text-[10px] font-mono text-neutral-800 select-none w-[220px] shadow-lg backdrop-blur-md p-3.5 transition-all duration-300">
                <div className="font-bold border-b border-neutral-200 pb-1.5 text-neutral-900 tracking-wider flex items-center justify-between font-sans">
                  <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-neutral-900" /> GIS LEGEND / 图例</span>
                  <button onClick={toggleLegend} className="text-[9px] text-neutral-400 hover:text-neutral-900 hover:underline cursor-pointer">隐藏</button>
                </div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded bg-amber-800/60 inline-block border border-amber-900/40"></span><span>住宅建筑 (R)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded bg-blue-800/60 inline-block border border-blue-900/40"></span><span>商业建筑 (B)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded bg-emerald-700/60 inline-block border border-emerald-900/40"></span><span>混合建筑 (C)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block shadow-sm"></span><span>合法流动居民 (Bystanders)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded-full bg-red-500 inline-block shadow-sm"></span><span>隐患罪犯流出 (Threat)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 rounded-full border border-emerald-400 inline-block"></span><span>密集绿植林荫 (Canopy)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shadow-sm"></span><span>正常照明路灯 (ON)</span></div>
                <div className="flex items-center gap-2 text-neutral-700"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow-sm"></span><span>损坏缺陷路灯 (Fault)</span></div>
                {params.showPastCrimes && (
                  <div className="flex items-center gap-2 text-neutral-700"><span className="w-3 h-3 border border-red-500 bg-red-50 inline-flex items-center justify-center text-[8px] text-red-600 font-bold">X</span><span>历史案发地点</span></div>
                )}
                {hazardPoints.length > 0 && (
                  <div className="flex items-center gap-2 text-neutral-700">
                    <span className="w-3 h-3 rotate-45 bg-red-600 inline-flex items-center justify-center text-[8px] text-white font-bold shadow-sm">
                      <span className="-rotate-45">!</span>
                    </span>
                    <span>实时治安隐患点</span>
                  </div>
                )}
                {params.showHeatmap && (
                  <div className="flex flex-col gap-1 border-t border-neutral-200 pt-1.5 mt-1"><div className="flex justify-between text-neutral-400 text-[9px]"><span>安全 (SAFE)</span><span>隐患 (RISK)</span></div><div className="w-full h-1 bg-gradient-to-r from-emerald-500 via-amber-400 to-red-600 rounded-full" /></div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

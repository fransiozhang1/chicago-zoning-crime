// Parses the zoning WKT CSV data and produces building pieces
// via intersection with block rectangles (exact 1:1 port of script.js)

import * as turf from '@turf/turf';
import { projectCoordinate } from '../constants/coordinates';
import blockRectsData from '../data/block_rectangles';

export interface ZonePiece {
  /** ring in scene coordinates */
  ring: { x: number; y: number }[];
  zoneClass: string;
}

interface CsvRow {
  category: string;
  code: string;
  share: string;
  importance_score: string;
  importance_rank: string;
  spearman_rho: string;
  direction: string;
  multipolygon_wkt: string;
}

// ── CSV parser (exact port from script.js) ──────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csvText: string): CsvRow[] {
  const clean = csvText.replace(/\r/g, '');
  const lines = clean.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    const row: any = {};
    headers.forEach((h, j) => { row[h] = (values[j] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// ── WKT parser (exact port from script.js) ──────────────

function splitTopLevelGroups(body: string): string[] {
  const inner = body.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start >= 0) {
        parts.push(inner.substring(start, i + 1));
        start = -1;
      }
    }
  }
  return parts;
}

function parseCoordPairs(text: string): [number, number][] {
  const clean = text.trim();
  const pairs = clean.split(',');
  const result: [number, number][] = [];
  for (const pair of pairs) {
    const trimmed = pair.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lng) || isNaN(lat)) continue;
    result.push([lat, lng]);
  }
  return result;
}

function parseRing(ringStr: string): [number, number][] {
  const trimmed = ringStr.trim();
  const inner = trimmed.slice(1, -1);
  return parseCoordPairs(inner);
}

function parsePolygonBody(body: string): [number, number][][] {
  const groups = splitTopLevelGroups(body);
  return groups.map(parseRing);
}

function parseMultiPolygonBody(body: string): [number, number][][][] {
  const polyGroups = splitTopLevelGroups(body);
  return polyGroups.map(g => parsePolygonBody(g));
}

function parseWKTToLatLngs(wkt: string): [number, number][][] {
  const trimmed = wkt.trim();
  const firstParen = trimmed.indexOf('(');
  if (firstParen === -1) return [];
  const keyword = trimmed.substring(0, firstParen).trim().toUpperCase();
  const body = trimmed.substring(firstParen);
  if (keyword === 'POLYGON') {
    return [parsePolygonBody(body)].flatMap(p => p);
  } else if (keyword === 'MULTIPOLYGON') {
    return parseMultiPolygonBody(body).flatMap(poly => poly);
  }
  return [];
}

function latLngRingToGeoJSON(ringLatLng: [number, number][]): [number, number][] {
  const ring = ringLatLng.map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

function bboxOverlaps(a: number[], b: number[]): boolean {
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

// ── Main: compute zone pieces via intersection ──────────

export function computeZonePieces(
  csvRaw: string,
  sceneW: number, sceneH: number,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): ZonePiece[] {
  const rows = parseCSV(csvRaw);
  const pieces: ZonePiece[] = [];

  const zoneItems: { row: CsvRow; bbox: number[]; feature: any }[] = [];

  for (const row of rows) {
    if (row.category === 'zone_family') continue;
    const wkt = row.multipolygon_wkt;
    if (!wkt) continue;

    const polys = parseWKTToLatLngs(wkt);
    for (const outer of polys) {
      if (!outer || outer.length < 4) continue;
      const geoRing = latLngRingToGeoJSON(outer);
      zoneItems.push({
        row,
        bbox: turf.bbox(turf.polygon([geoRing])),
        feature: turf.polygon([geoRing])
      });
    }
  }

  const rects = (blockRectsData as any).rectangles;
  if (!rects) return pieces;

  for (const rect of rects) {
    const corners = rect.corners as { lat: number; lng: number }[];
    const ring = latLngRingToGeoJSON(corners.map(c => [c.lat, c.lng] as [number, number]));
    const rectFeature = turf.polygon([ring]);
    const rectBbox = turf.bbox(rectFeature);

    for (const { row, bbox: zBbox, feature: zoneFeature } of zoneItems) {
      if (!bboxOverlaps(rectBbox, zBbox)) continue;
      let inter: any;
      try {
        inter = turf.intersect(turf.featureCollection([rectFeature, zoneFeature]));
      } catch (_) {
        continue;
      }
      if (!inter) continue;

      const rings = geoJsonGeomToSceneRings(inter.geometry, sceneW, sceneH, bbox);
      for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        pieces.push({ ring, zoneClass: row.code });
      }
    }
  }

  return pieces;
}

function geoJsonGeomToSceneRings(
  geom: any,
  sceneW: number, sceneH: number,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): { x: number; y: number }[][] {
  const rings: { x: number; y: number }[][] = [];
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      const sceneRing = ring.map(([lng, lat]: number[]) =>
        projectCoordinate({ lat, lng }, sceneW, sceneH, 40, bbox)
      );
      rings.push(sceneRing);
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        const sceneRing = ring.map(([lng, lat]: number[]) =>
          projectCoordinate({ lat, lng }, sceneW, sceneH, 40, bbox)
        );
        rings.push(sceneRing);
      }
    }
  }
  return rings;
}

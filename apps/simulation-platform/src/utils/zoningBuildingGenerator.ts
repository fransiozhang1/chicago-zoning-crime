// ── Zoning Building Generator ──────────────────────────────
// EXACT 1:1 port of buildings.js.
// Takes ZonePiece[] (scene-coordinate rings) and produces
// Building[] (scene coordinates) with greenery, lot, parking data.

import { Vector2D, Building, Coordinate } from '../types';
import { projectCoordinate, unprojectCoordinate } from '../constants/coordinates';
import { ZoneConfigEntry, resolveZoneClass } from '../constants/zoningConfig';
import { ZonePiece } from './zoningData';

// ── Meter-space conversions (EXACT copy from buildings.js) ──

const M_PER_DEG_LAT = 111320;
let REF_LAT = 0, M_PER_DEG_LNG = 111320;

function setRefLat(lat: number) {
  REF_LAT = lat;
  const cos = Math.cos(lat * Math.PI / 180);
  M_PER_DEG_LNG = M_PER_DEG_LAT * Math.max(0.01, cos);
}

function toMeters(ll: [number, number]): [number, number] {
  const x = ll[1] * M_PER_DEG_LNG;
  const y = (ll[0] - REF_LAT) * M_PER_DEG_LAT;
  if (isNaN(x) || isNaN(y)) return [0, 0];
  return [x, y];
}

function toLatLng(m: [number, number]): [number, number] {
  const lat = REF_LAT + m[1] / M_PER_DEG_LAT;
  const lng = m[0] / M_PER_DEG_LNG;
  if (isNaN(lat) || isNaN(lng)) return [0, 0];
  return [lat, lng];
}

// ── Geometry helpers ───────────────────────────────────────

function distM(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function ringCentroid(ring: [number, number][]): [number, number] | null {
  let slat = 0, slng = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const lat = ring[i][0], lng = ring[i][1];
    if (isNaN(lat) || isNaN(lng)) return null;
    slat += lat; slng += lng;
  }
  return n > 0 ? [slat / n, slng / n] : null;
}

function perpendicular(a: [number, number], b: [number, number]): [number, number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 0, 0];
  return [-dy / len, dx / len, len];
}

function dot(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}

function polygonAreaSqM(ringM: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ringM.length - 1; i++) {
    area += ringM[i][0] * ringM[i + 1][1] - ringM[i + 1][0] * ringM[i][1];
  }
  return Math.abs(area) / 2;
}

function inwardNormal(edgeA: [number, number], edgeB: [number, number], target: [number, number]): [number, number] {
  const p = perpendicular(edgeA, edgeB);
  if (p[2] < 1e-9) return [0, 0];
  const dc = dot([p[0], p[1]], [target[0] - edgeA[0], target[1] - edgeA[1]]);
  return dc >= 0 ? [p[0], p[1]] : [-p[0], -p[1]];
}

function boxesOverlap(ax1: number, ay1: number, ax2: number, ay2: number, bx1: number, by1: number, bx2: number, by2: number): boolean {
  return !(ax2 <= bx1 || bx2 <= ax1 || ay2 <= by1 || by2 <= ay1);
}

function pointInPolygon(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function stablePieceScore(piece: ZonePiece, index: number): number {
  const ring = piece.ring || [];
  let sum = index * 9973;
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    sum += Math.round(pt.x * 10) * 31 + Math.round(pt.y * 10) * 17 + i * 13;
  }
  return sum;
}

// ── Seeded random ──────────────────────────────────────────

let _seed = 1;
function srand(s: number) { _seed = s | 0; }
function rnd(): number {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed - 1) / 2147483646;
}

// ── Massing ────────────────────────────────────────────────

interface MassingResult {
  stories: number;
  totalFootprintSqM: number;
  far: number;
  heightFt: number;
}

function computePieceMassing(pieceAreaSqM: number, params: ZoneConfigEntry): MassingResult {
  const far = Math.max(0.1, params.max_far_raw || 1);
  const heightFt = params.max_height_raw || 38;
  const maxStories = Math.max(1, Math.floor(heightFt / 12));
  let stories = Math.max(1, Math.min(maxStories, Math.max(1, Math.round(far))));
  if (far < 1.5) stories = 1;
  else if (far < 2.5) stories = Math.min(2, maxStories);
  else stories = Math.min(maxStories, Math.ceil(far));
  const totalFloorSqM = far * pieceAreaSqM;
  const totalFootprintSqM = totalFloorSqM / stories;
  return { stories, totalFootprintSqM, far, heightFt };
}

// ── Opposite edges ────────────────────────────────────────

interface EdgeInfo {
  idx: number;
  len: number;
  mid: [number, number];
  inwNx: number;
  inwNy: number;
}

function findTwoOppositeEdges(ringM: [number, number][], centroidM: [number, number]): { edgeA: EdgeInfo | null; edgeB: EdgeInfo | null } {
  const n = ringM.length;
  const edges: EdgeInfo[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = ringM[i], b = ringM[i + 1];
    const len = distM(a, b);
    if (len < 5) continue;
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const inw = inwardNormal(a, b, centroidM);
    edges.push({ idx: i, len, mid, inwNx: inw[0], inwNy: inw[1] });
  }
  if (edges.length < 2) return { edgeA: null, edgeB: null };
  edges.sort((a, b) => b.len - a.len);
  const edgeA = edges[0];
  let bestB: EdgeInfo | null = null;
  let bestBLen = -1;
  for (let j = 1; j < edges.length; j++) {
    const dp = edgeA.inwNx * edges[j].inwNx + edgeA.inwNy * edges[j].inwNy;
    if (dp < 0 && edges[j].len > bestBLen) {
      bestBLen = edges[j].len;
      bestB = edges[j];
    }
  }
  if (!bestB && edges.length >= 2) bestB = edges[1];
  return { edgeA, edgeB: bestB };
}

// ── Zoning metrics ─────────────────────────────────────────

function computeZoningMetrics(bldgWidth: number, bldgDepth: number, stories: number, lotAreaSqM: number, params: ZoneConfigEntry, pieceAreaSqM: number) {
  const bldgArea = bldgWidth * bldgDepth;
  const lotCoverage = lotAreaSqM > 0 ? bldgArea / lotAreaSqM : 0;
  const totalFloor = bldgArea * stories;
  const farDenom = (pieceAreaSqM > 0) ? pieceAreaSqM : lotAreaSqM;
  const farAchieved = farDenom > 0 ? totalFloor / farDenom : 0;
  const farAllowed = params.max_far_raw;
  let parkingSpaces = params.parking_requirement_num ? Math.ceil(params.parking_requirement_num * stories) : 0;
  if (params.zone_family !== 'R' && !params.non_accessory_parking_allowed) {
    parkingSpaces = Math.max(0, Math.min(parkingSpaces, 4));
  }
  return { lotCoverage, farAchieved, farAllowed, parkingSpaces, farOk: farAchieved <= farAllowed + 0.05 };
}

interface LotBox { minX: number; minY: number; maxX: number; maxY: number; }

interface BldgResult {
  cornersLL: [number, number][];
  width: number; depth: number; stories: number;
  far: number; heightFt: number;
  zoneFamily: string; zoneClass: string;
  lotCornersM: [number, number][];
  greenCornersM: [number, number][];
  parkCornersM: [number, number][];
}

// ── Residential: generate along edge ─────────────────────

function generateAlongEdge(
  edgeA: [number, number], edgeB: [number, number],
  inward: [number, number], availableDepth: number,
  params: ZoneConfigEntry, placedLotBoxes: LotBox[],
  pieceMassing: MassingResult, estBuildingsOnPiece: number,
  pieceAreaSqM: number
): BldgResult[] {
  const edgeLen = distM(edgeA, edgeB);
  if (edgeLen < 5 || availableDepth < 6) return [];

  const isRT = (params.zone_family === 'R');
  const setbackFt = params.front_setback_raw || 15;
  let setbackM = setbackFt * 0.3048;
  if (params.buffer_required) setbackM += 3.048;

  const stories = pieceMassing.stories;
  const perBldgMaxFp = pieceMassing.totalFootprintSqM / Math.max(1, estBuildingsOnPiece);

  const minLotSqM = (params.min_lot_area_raw || 1000) * 0.092903;
  const rearYard = isRT ? 1.5 : 2;
  const sideGap = isRT ? 2 : 3;
  const maxLotDepth = Math.max(8, availableDepth);
  const buildZoneDepth = Math.max(6, maxLotDepth - setbackM - rearYard);
  let lotWidth = Math.max(isRT ? 10 : 14, Math.sqrt(minLotSqM * 0.9));
  lotWidth = Math.min(lotWidth, edgeLen * 0.45);
  let nLots = Math.max(1, Math.floor((edgeLen + sideGap) / (lotWidth + sideGap)));
  let spacing = nLots > 1 ? Math.max(sideGap, (edgeLen - nLots * lotWidth) / (nLots - 1)) : 0;
  let startOffset = (edgeLen - nLots * lotWidth - (nLots - 1) * spacing) / 2;
  if (startOffset < 0) {
    lotWidth = (edgeLen - (nLots - 1) * sideGap) / nLots;
    spacing = sideGap;
    startOffset = 0;
  }
  const edgeUx = (edgeB[0] - edgeA[0]) / Math.max(1e-9, edgeLen);
  const edgeUy = (edgeB[1] - edgeA[1]) / Math.max(1e-9, edgeLen);

  srand((edgeLen * 1000 + nLots * 137 + ((params.max_far_raw || 1) * 100)) | 0);
  const buildings: BldgResult[] = [];

  for (let k = 0; k < nLots; k++) {
    if (nLots > 3 && rnd() < 0.18) continue;
    const wRand = 0.5 + rnd() * 0.9;
    const dRand = 0.85 + rnd() * 0.13;
    const lotW = Math.max(isRT ? 8 : 10, Math.min(lotWidth * wRand, edgeLen / nLots - sideGap * 0.3));
    const pos = startOffset + k * (lotWidth + spacing);
    const myFp = perBldgMaxFp * (0.72 + rnd() * 0.5);
    let bD = buildZoneDepth * dRand;
    bD = Math.max(isRT ? 8 : 9, bD);
    let bW = myFp / Math.max(1, bD);
    bW = Math.min(lotW * 0.88, Math.max(isRT ? 7 : 8, bW));
    if (bW < bD * 0.4 && lotW > bD) {
      bD = bW * (1.5 + rnd() * 1.0);
      bD = Math.max(isRT ? 8 : 9, Math.min(buildZoneDepth, bD));
    }
    const lotTotalDepth = maxLotDepth;
    const flA: [number, number] = [edgeA[0] + edgeUx * pos, edgeA[1] + edgeUy * pos];
    const flB: [number, number] = [edgeA[0] + edgeUx * (pos + lotW), edgeA[1] + edgeUy * (pos + lotW)];
    const rlA: [number, number] = [flA[0] + inward[0] * lotTotalDepth, flA[1] + inward[1] * lotTotalDepth];
    const rlB: [number, number] = [flB[0] + inward[0] * lotTotalDepth, flB[1] + inward[1] * lotTotalDepth];
    const lotMinX = Math.min(flA[0], flB[0], rlA[0], rlB[0]);
    const lotMinY = Math.min(flA[1], flB[1], rlA[1], rlB[1]);
    const lotMaxX = Math.max(flA[0], flB[0], rlA[0], rlB[0]);
    const lotMaxY = Math.max(flA[1], flB[1], rlA[1], rlB[1]);
    const lotOverlap = placedLotBoxes.some(lb =>
      boxesOverlap(lotMinX, lotMinY, lotMaxX, lotMaxY, lb.minX, lb.minY, lb.maxX, lb.maxY));
    if (lotOverlap) continue;
    placedLotBoxes.push({ minX: lotMinX, minY: lotMinY, maxX: lotMaxX, maxY: lotMaxY });
    const cx = flA[0] + edgeUx * (lotW / 2);
    const cy = flA[1] + edgeUy * (lotW / 2);
    const stagger = (rnd() - 0.5) * setbackM * 0.8;
    const effectiveSetback = setbackM + stagger;
    const frontCx = cx + inward[0] * effectiveSetback;
    const frontCy = cy + inward[1] * effectiveSetback;
    const midX = frontCx + inward[0] * (bD / 2);
    const midY = frontCy + inward[1] * (bD / 2);
    const hw = bW / 2, hd = bD / 2;
    const c1: [number, number] = [midX - edgeUx * hw - inward[0] * hd, midY - edgeUy * hw - inward[1] * hd];
    const c2: [number, number] = [midX + edgeUx * hw - inward[0] * hd, midY + edgeUy * hw - inward[1] * hd];
    const c3: [number, number] = [midX + edgeUx * hw + inward[0] * hd, midY + edgeUy * hw + inward[1] * hd];
    const c4: [number, number] = [midX - edgeUx * hw + inward[0] * hd, midY - edgeUy * hw + inward[1] * hd];
    const greenFrontA: [number, number] = [flA[0], flA[1]];
    const greenFrontB: [number, number] = [flB[0], flB[1]];
    const greenBackA: [number, number] = [frontCx - edgeUx * (lotW / 2), frontCy - edgeUy * (lotW / 2)];
    const greenBackB: [number, number] = [frontCx + edgeUx * (lotW / 2), frontCy + edgeUy * (lotW / 2)];
    const pkDepth = Math.min(4.5, setbackM * 0.55);
    const pkWidth = Math.min(lotW * 0.45, 5);
    const pkAlong = pos + lotW * 0.72;
    const pkCx = edgeA[0] + edgeUx * pkAlong;
    const pkCy = edgeA[1] + edgeUy * pkAlong;
    const pkMidX = pkCx + inward[0] * (pkDepth / 2);
    const pkMidY = pkCy + inward[1] * (pkDepth / 2);
    const pkC1: [number, number] = [pkMidX - edgeUx * (pkWidth / 2) - inward[0] * (pkDepth / 2), pkMidY - edgeUy * (pkWidth / 2) - inward[1] * (pkDepth / 2)];
    const pkC2: [number, number] = [pkMidX + edgeUx * (pkWidth / 2) - inward[0] * (pkDepth / 2), pkMidY + edgeUy * (pkWidth / 2) - inward[1] * (pkDepth / 2)];
    const pkC3: [number, number] = [pkMidX + edgeUx * (pkWidth / 2) + inward[0] * (pkDepth / 2), pkMidY + edgeUy * (pkWidth / 2) + inward[1] * (pkDepth / 2)];
    const pkC4: [number, number] = [pkMidX - edgeUx * (pkWidth / 2) + inward[0] * (pkDepth / 2), pkMidY - edgeUy * (pkWidth / 2) + inward[1] * (pkDepth / 2)];
    const cornersLL = [c1, c2, c3, c4].map(toLatLng) as [number, number][];
    if (isNaN(cornersLL[0][0]) || isNaN(cornersLL[0][1])) continue;
    buildings.push({
      cornersLL, width: bW, depth: bD, stories,
      far: pieceMassing.far, heightFt: pieceMassing.heightFt,
      zoneClass: params.zone_class, zoneFamily: params.zone_family,
      lotCornersM: [flA, flB, rlB, rlA],
      greenCornersM: [greenFrontA, greenFrontB, greenBackB, greenBackA],
      parkCornersM: [pkC1, pkC2, pkC3, pkC4]
    });
  }
  return buildings;
}

// ── Commercial varied placement ─────────────────────────

function generateCommercialVaried(ringM: [number, number][], centroidM: [number, number], params: ZoneConfigEntry): BldgResult[] {
  if (!ringM || ringM.length < 4) return [];
  const n = ringM.length;
  const edges: { a: [number, number]; b: [number, number]; len: number; inw: [number, number]; edgeIdx: number; }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = ringM[i], b = ringM[i + 1];
    const len = distM(a, b);
    if (len < 8) continue;
    const inw = inwardNormal(a, b, centroidM);
    edges.push({ a, b, len, inw, edgeIdx: i });
  }
  edges.sort((a, b) => b.len - a.len);
  if (edges.length === 0) return [];

  const areaSqM = polygonAreaSqM(ringM);
  const pieceMassing = computePieceMassing(areaSqM, params);
  const stories = pieceMassing.stories;
  const setbackM = (params.front_setback_raw || 10) * 0.3048;
  const placedBoxes: LotBox[] = [];
  const placedLotBoxes: LotBox[] = [];
  const maxTotal = Math.max(2, Math.min(15, Math.floor(areaSqM / 500 + pieceMassing.totalFootprintSqM / 400)));
  srand((areaSqM * 7919 + ringM.length * 31 + ((params.max_far_raw || 1) * 100)) | 0);
  const buildings: BldgResult[] = [];

  for (let k = 0; k < maxTotal; k++) {
    const tierScale = 0.55 + rnd() * 0.8;
    const maxFp = (pieceMassing.totalFootprintSqM / maxTotal) * tierScale;
    let bD = Math.min(22, Math.max(10, Math.sqrt(maxFp * 1.2)));
    let bW = Math.min(35, Math.max(12, maxFp / bD));
    let placed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const edgeIdx = (k + attempt) % edges.length;
      const edge = edges[edgeIdx];
      if (!edge) continue;
      const edgeUx = (edge.b[0] - edge.a[0]) / Math.max(1e-9, edge.len);
      const edgeUy = (edge.b[1] - edge.a[1]) / Math.max(1e-9, edge.len);
      const availableAlong = edge.len - bW - 4;
      if (availableAlong < 0) continue;
      const pos = 2 + rnd() * availableAlong;
      const flA: [number, number] = [edge.a[0] + edgeUx * pos, edge.a[1] + edgeUy * pos];
      const flB: [number, number] = [edge.a[0] + edgeUx * (pos + bW), edge.a[1] + edgeUy * (pos + bW)];
      const lotTotalDepth = Math.min(setbackM + bD + 5, edge.len * 0.35);
      const rlA: [number, number] = [flA[0] + edge.inw[0] * lotTotalDepth, flA[1] + edge.inw[1] * lotTotalDepth];
      const rlB: [number, number] = [flB[0] + edge.inw[0] * lotTotalDepth, flB[1] + edge.inw[1] * lotTotalDepth];
      const lotMinX = Math.min(flA[0], flB[0], rlA[0], rlB[0]);
      const lotMinY = Math.min(flA[1], flB[1], rlA[1], rlB[1]);
      const lotMaxX = Math.max(flA[0], flB[0], rlA[0], rlB[0]);
      const lotMaxY = Math.max(flA[1], flB[1], rlA[1], rlB[1]);
      if (placedLotBoxes.some(lb => boxesOverlap(lotMinX, lotMinY, lotMaxX, lotMaxY, lb.minX, lb.minY, lb.maxX, lb.maxY))) continue;

      const cxPt = flA[0] + edgeUx * (bW / 2);
      const cyPt = flA[1] + edgeUy * (bW / 2);
      const frontCx = cxPt + edge.inw[0] * setbackM;
      const frontCy = cyPt + edge.inw[1] * setbackM;
      const midX = frontCx + edge.inw[0] * (bD / 2);
      const midY = frontCy + edge.inw[1] * (bD / 2);
      const hw = bW / 2, hd = bD / 2;
      const c1: [number, number] = [midX - edgeUx * hw - edge.inw[0] * hd, midY - edgeUy * hw - edge.inw[1] * hd];
      const c2: [number, number] = [midX + edgeUx * hw - edge.inw[0] * hd, midY + edgeUy * hw - edge.inw[1] * hd];
      const c3: [number, number] = [midX + edgeUx * hw + edge.inw[0] * hd, midY + edgeUy * hw + edge.inw[1] * hd];
      const c4: [number, number] = [midX - edgeUx * hw + edge.inw[0] * hd, midY - edgeUy * hw + edge.inw[1] * hd];

      const minX = Math.min(c1[0], c2[0], c3[0], c4[0]);
      const minY = Math.min(c1[1], c2[1], c3[1], c4[1]);
      const maxX = Math.max(c1[0], c2[0], c3[0], c4[0]);
      const maxY = Math.max(c1[1], c2[1], c3[1], c4[1]);

      if (placedBoxes.some(pb => boxesOverlap(minX - 4, minY - 4, maxX + 4, maxY + 4, pb.minX, pb.minY, pb.maxX, pb.maxY))) continue;
      if (!pointInPolygon([c1[0], c1[1]], ringM) || !pointInPolygon([c2[0], c2[1]], ringM) ||
          !pointInPolygon([c3[0], c3[1]], ringM) || !pointInPolygon([c4[0], c4[1]], ringM)) continue;

      placedBoxes.push({ minX, minY, maxX, maxY });
      placedLotBoxes.push({ minX: lotMinX, minY: lotMinY, maxX: lotMaxX, maxY: lotMaxY });
      placed = true;

      const pkDepth = Math.min(5, setbackM * 0.6);
      const pkWidth = Math.min(bW * 0.5, 6);
      const pkAlong = pos + bW * 0.7;
      const pkCx = edge.a[0] + edgeUx * pkAlong;
      const pkCy = edge.a[1] + edgeUy * pkAlong;
      const pkMidX = pkCx + edge.inw[0] * (pkDepth / 2);
      const pkMidY = pkCy + edge.inw[1] * (pkDepth / 2);
      const pkC1: [number, number] = [pkMidX - edgeUx * (pkWidth / 2) - edge.inw[0] * (pkDepth / 2), pkMidY - edgeUy * (pkWidth / 2) - edge.inw[1] * (pkDepth / 2)];
      const pkC2: [number, number] = [pkMidX + edgeUx * (pkWidth / 2) - edge.inw[0] * (pkDepth / 2), pkMidY + edgeUy * (pkWidth / 2) - edge.inw[1] * (pkDepth / 2)];
      const pkC3: [number, number] = [pkMidX + edgeUx * (pkWidth / 2) + edge.inw[0] * (pkDepth / 2), pkMidY + edgeUy * (pkWidth / 2) + edge.inw[1] * (pkDepth / 2)];
      const pkC4: [number, number] = [pkMidX - edgeUx * (pkWidth / 2) + edge.inw[0] * (pkDepth / 2), pkMidY - edgeUy * (pkWidth / 2) + edge.inw[1] * (pkDepth / 2)];

      const greenFrontA: [number, number] = [flA[0], flA[1]];
      const greenFrontB: [number, number] = [flB[0], flB[1]];
      const greenBackA: [number, number] = [frontCx - edgeUx * (bW / 2), frontCy - edgeUy * (bW / 2)];
      const greenBackB: [number, number] = [frontCx + edgeUx * (bW / 2), frontCy + edgeUy * (bW / 2)];

      const cornersLL = [c1, c2, c3, c4].map(toLatLng) as [number, number][];
      if (isNaN(cornersLL[0][0]) || isNaN(cornersLL[0][1])) continue;
      buildings.push({
        cornersLL, width: bW, depth: bD, stories,
        far: pieceMassing.far, heightFt: pieceMassing.heightFt,
        zoneClass: params.zone_class, zoneFamily: params.zone_family,
        lotCornersM: [flA, flB, rlB, rlA],
        greenCornersM: [greenFrontA, greenFrontB, greenBackB, greenBackA],
        parkCornersM: [pkC1, pkC2, pkC3, pkC4]
      });
      break;
    }
    if (!placed) break;
  }
  return buildings;
}

// ── Building colors (EXACT copy from buildings.js) ───────

export function buildingFillColor(family: string, stories: number): string {
  const alpha = Math.min(0.9, 0.6 + stories * 0.05);
  if (family === 'R') return `rgba(160,120,80,${alpha.toFixed(2)})`;
  if (family === 'B') return `rgba(90,120,155,${alpha.toFixed(2)})`;
  if (family === 'C') return `rgba(140,155,130,${alpha.toFixed(2)})`;
  return `rgba(180,140,100,${alpha.toFixed(2)})`;
}

export function buildingStrokeColor(family: string): string {
  if (family === 'R') return '#3d2b1a';
  if (family === 'B') return '#2d4a6b';
  if (family === 'C') return '#3d4a3a';
  return '#6b4c2a';
}

// ── Zone polygon colors (neutral palette aligned with teammate) ──

export function zoneFillColor(family: string, opacity: number = 0.35): string {
  if (family === 'R') return `rgba(195,180,165,${opacity})`;
  if (family === 'B') return `rgba(165,175,195,${opacity})`;
  if (family === 'C') return `rgba(170,185,165,${opacity})`;
  return `rgba(185,185,180,${opacity})`;
}

export function zoneStrokeColor(family: string): string {
  return 'rgba(60,60,60,0.55)';
}

// ── Extended building result with scene-coordinate extras ──

export interface ExtendedBuilding extends Building {
  /** Lot boundary corners in scene coords */
  lotCorners: Vector2D[];
  /** Greenery strip corners in scene coords */
  greenCorners: Vector2D[];
  /** Parking pad corners in scene coords */
  parkCorners: Vector2D[];
  zoneFamily: string;
  zoneClass: string;
  renderLot: boolean;
  renderGreen: boolean;
  renderPark: boolean;
  /** Building width in meters */
  width: number;
  /** Building depth in meters */
  depth: number;
  /** Whether this is a park/green space (not a building) */
  isPark?: boolean;
}

function meterToSceneVec(m: [number, number], refLat: number, sceneW: number, sceneH: number, bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }): Vector2D {
  const ll = toLatLng(m);
  return projectCoordinate({ lat: ll[0], lng: ll[1] }, sceneW, sceneH, 40, bbox);
}

// ── Main generation ──────────────────────────────────────

export function generateZoningBuildings(
  pieces: ZonePiece[],
  zoneParams: Record<string, ZoneConfigEntry>,
  sceneW: number = 840, sceneH: number = 600,
  bbox = { minLng: -87.618, maxLng: -87.601, minLat: 41.771, maxLat: 41.782 }
): ExtendedBuilding[] {
  const allBuildings: ExtendedBuilding[] = [];
  let idCounter = 0;

  // ── Pre-scan: pick 3–4 R pieces as full-block parks ──
  const rIndices: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const zc = pieces[i].zoneClass;
    if (!zc) continue;
    const resolved = resolveZoneClass(zc);
    const params = zoneParams[resolved];
    if (!params || params.zone_family !== 'R') continue;
    rIndices.push(i);
  }

  const fullBlockParkCount = rIndices.length <= 4
    ? Math.max(1, Math.min(rIndices.length, 4))
    : Math.min(4, 3 + ((rIndices.length + pieces.length) % 2)); // stable 3 or 4
  const stableR = [...rIndices].sort((a, b) => {
    const scoreA = stablePieceScore(pieces[a], a);
    const scoreB = stablePieceScore(pieces[b], b);
    return scoreA - scoreB;
  });
  const fullBlockParkSet = new Set(stableR.slice(0, fullBlockParkCount));

  for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx++) {
    const piece = pieces[pieceIdx];
    const zoneClass = piece.zoneClass;
    if (!zoneClass) continue;
    const resolved = resolveZoneClass(zoneClass);
    const params = zoneParams[resolved];
    if (!params) continue;

    const ring = piece.ring;
    if (!ring || ring.length < 4) continue;

    // Scene → GPS → meter ring
    const gpsRing: [number, number][] = ring.map(v => {
      const gps = unprojectCoordinate(v, sceneW, sceneH, 40, bbox);
      return [gps.lat, gps.lng] as [number, number];
    });

    const closedRing = gpsRing.slice();
    const fr = closedRing[0], lr = closedRing[closedRing.length - 1];
    if (fr[0] !== lr[0] || fr[1] !== lr[1]) closedRing.push([fr[0], fr[1]]);

    const centroid = ringCentroid(gpsRing);
    if (!centroid || isNaN(centroid[0]) || isNaN(centroid[1])) continue;
    setRefLat(centroid[0]);
    const centroidM = toMeters(centroid);
    const ringM = closedRing.map(toMeters);
    const refLat = centroid[0];

    const isR = (params.zone_family === 'R');

    if (isR) {
      const scenePiecePoly = closedRing.map(ll =>
        projectCoordinate({ lat: ll[0], lng: ll[1] }, sceneW, sceneH, 40, bbox)
      );

      // ── Full-block park (pre-selected) ──
      if (fullBlockParkSet.has(pieceIdx)) {
        allBuildings.push({
          id: `park_${idCounter++}`,
          polygon: scenePiecePoly,
          height: 0, stories: 0, density: 0,
          center: scenePiecePoly[0] || { x: 0, y: 0 },
          fillColor: 'rgba(100,160,80,0.40)',
          strokeColor: 'rgba(60,120,40,0.35)',
          lotCorners: [],
          greenCorners: [],
          parkCorners: [],
          zoneFamily: 'R',
          zoneClass: params.zone_class,
          renderLot: false,
          renderGreen: false,
          renderPark: false,
          width: 0,
          depth: 0,
          isPark: true,
        });
        continue;
      }

      const edges = findTwoOppositeEdges(ringM, centroidM);
      if (edges.edgeA) {
        const midDist = edges.edgeB ? distM(edges.edgeA.mid, edges.edgeB.mid) : 0;
        const halfDist = midDist > 0 ? midDist / 2 : 0;
        const alleyGap = 4;
        const totalDepth = halfDist > 0 ? Math.max(8, halfDist - alleyGap) : 18;

        const pieceAreaSqM = polygonAreaSqM(ringM);
        const pieceMassing = computePieceMassing(pieceAreaSqM, params);
        const edgeLenA = distM(ringM[edges.edgeA.idx], ringM[edges.edgeA.idx + 1]);
        const edgeLenB = edges.edgeB ? distM(ringM[edges.edgeB.idx], ringM[edges.edgeB.idx + 1]) : 0;
        const minLotSqM = (params.min_lot_area_raw || 1000) * 0.092903;
        const estLotW = Math.max(12, Math.sqrt(minLotSqM * 1.2));
        const rawEstLots = Math.max(1, Math.floor(edgeLenA / (estLotW + 4))) +
          (edges.edgeB ? Math.max(1, Math.floor(edgeLenB / (estLotW + 4))) : 0);
        const farScale = 1.0 + pieceMassing.far * 0.3;
        const adjustedEstLots = Math.max(3, Math.round(rawEstLots / farScale));

        const placedLotBoxes: LotBox[] = [];
        const bldgsA = generateAlongEdge(
          ringM[edges.edgeA.idx], ringM[edges.edgeA.idx + 1],
          [edges.edgeA.inwNx, edges.edgeA.inwNy], totalDepth, params,
          placedLotBoxes, pieceMassing, adjustedEstLots, pieceAreaSqM
        );
        const bldgsB = edges.edgeB
          ? generateAlongEdge(
              ringM[edges.edgeB.idx], ringM[edges.edgeB.idx + 1],
              [edges.edgeB.inwNx, edges.edgeB.inwNy], totalDepth, params,
              placedLotBoxes, pieceMassing, adjustedEstLots, pieceAreaSqM
            )
          : [];

        const allBldgs = [...bldgsA, ...bldgsB];

        // ── Park (~25% of piece area, stable probability + stable position) ──
        srand((stablePieceScore(piece, pieceIdx) + Math.round(pieceAreaSqM * 10) + params.max_height_raw * 19) | 0);
        const tryPark = rnd() < 0.70 && pieceAreaSqM >= 400;
        let parkPlaced = false;

        if (tryPark) {
          const parkAreaSqM = pieceAreaSqM * 0.25;
          const parkSide = Math.sqrt(parkAreaSqM);
          const parkHw = parkSide / 2;

          // Orient using edge direction
          let ax = 1, ay = 0;
          const aFr = ringM[edges.edgeA.idx];
          const aTo2 = ringM[edges.edgeA.idx + 1];
          const edx = aTo2[0] - aFr[0], edy = aTo2[1] - aFr[1];
          const elen = Math.hypot(edx, edy);
          if (elen > 1e-9) { ax = edx / elen; ay = edy / elen; }
          const ix = edges.edgeA.inwNx, iy = edges.edgeA.inwNy;

          // Compute ring-bbox to bound random offset
          const rbb = ringM.reduce(
            (acc, p) => ({ minX: Math.min(acc.minX, p[0]), maxX: Math.max(acc.maxX, p[0]), minY: Math.min(acc.minY, p[1]), maxY: Math.max(acc.maxY, p[1]) }),
            { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
          );
          const rw = rbb.maxX - rbb.minX, rh = rbb.maxY - rbb.minY;

          // Try up to 8 random offset positions, shrinking if needed
          placementLoop:
          for (let attempt = 0; attempt < 8; attempt++) {
            const offX = (rnd() - 0.5) * rw * 0.60;
            const offY = (rnd() - 0.5) * rh * 0.60;
            for (let shrink = 1.0; shrink >= 0.5; shrink -= 0.1) {
              const s = parkHw * shrink;
              const cx = centroidM[0] + offX;
              const cy = centroidM[1] + offY;
              const parkMeters: [number, number][] = [
                [cx + ax * (-s) + ix * (-s), cy + ay * (-s) + iy * (-s)],
                [cx + ax *  s    + ix * (-s), cy + ay *  s    + iy * (-s)],
                [cx + ax *  s    + ix *  s,   cy + ay *  s    + iy *  s],
                [cx + ax * (-s) + ix *  s,    cy + ay * (-s) + iy *  s],
              ];

              if (parkMeters.every(p => pointInPolygon(p, ringM))) {
                const parkPoly = parkMeters.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
                if (!parkPoly.every(p => !isNaN(p.x) && !isNaN(p.y))) continue;

                allBuildings.push({
                  id: `park_${idCounter++}`,
                  polygon: parkPoly,
                  height: 0, stories: 0, density: 0,
                  center: parkPoly[0],
                  fillColor: 'rgba(100,160,80,0.40)',
                  strokeColor: 'rgba(60,120,40,0.35)',
                  lotCorners: [],
                  greenCorners: [],
                  parkCorners: [],
                  zoneFamily: 'R',
                  zoneClass: params.zone_class,
                  renderLot: false,
                  renderGreen: false,
                  renderPark: false,
                  width: 0,
                  depth: 0,
                  isPark: true,
                });

                // Push buildings, skip those inside park
                for (const b of allBldgs) {
                  const bMeters = b.cornersLL.map(toMeters);
                  const bCx = bMeters.reduce((s, p) => s + p[0], 0) / bMeters.length;
                  const bCy = bMeters.reduce((s, p) => s + p[1], 0) / bMeters.length;
                  if (pointInPolygon([bCx, bCy], parkMeters)) continue;

                  const scenePoly = b.cornersLL.map(ll =>
                    projectCoordinate({ lat: ll[0], lng: ll[1] }, sceneW, sceneH, 40, bbox)
                  );
                  if (scenePoly.some(p => isNaN(p.x) || isNaN(p.y))) continue;

                  const sceneLot = b.lotCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
                  const sceneGreen = b.greenCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
                  const scenePark = b.parkCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));

                  allBuildings.push({
                    id: `zb_${idCounter++}`,
                    polygon: scenePoly,
                    height: b.stories * 3.5,
                    stories: b.stories,
                    density: params.max_far_raw,
                    center: scenePoly[0],
                    fillColor: buildingFillColor(b.zoneFamily, b.stories),
                    strokeColor: buildingStrokeColor(b.zoneFamily),
                    lotCorners: sceneLot,
                    greenCorners: sceneGreen,
                    parkCorners: scenePark,
                    zoneFamily: b.zoneFamily,
                    zoneClass: b.zoneClass,
                    renderLot: true,
                    renderGreen: params.landscaping_required,
                    renderPark: params.parking_requirement_num > 0 || params.non_accessory_parking_allowed,
                    width: b.width,
                    depth: b.depth,
                  });
                }

                parkPlaced = true;
                break placementLoop;
              }
            }
          }
        }

        if (parkPlaced) continue; // skip fall-through

        // ── Fallback: push all buildings normally ──
        for (const b of allBldgs) {
          const scenePoly = b.cornersLL.map(ll =>
            projectCoordinate({ lat: ll[0], lng: ll[1] }, sceneW, sceneH, 40, bbox)
          );
          if (scenePoly.some(p => isNaN(p.x) || isNaN(p.y))) continue;

          const sceneLot = b.lotCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
          const sceneGreen = b.greenCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
          const scenePark = b.parkCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));

          allBuildings.push({
            id: `zb_${idCounter++}`,
            polygon: scenePoly,
            height: b.stories * 3.5,
            stories: b.stories,
            density: params.max_far_raw,
            center: scenePoly[0],
            fillColor: buildingFillColor(b.zoneFamily, b.stories),
            strokeColor: buildingStrokeColor(b.zoneFamily),
            lotCorners: sceneLot,
            greenCorners: sceneGreen,
            parkCorners: scenePark,
            zoneFamily: b.zoneFamily,
            zoneClass: b.zoneClass,
            renderLot: true,
            renderGreen: params.landscaping_required,
            renderPark: params.parking_requirement_num > 0 || params.non_accessory_parking_allowed,
            width: b.width,
            depth: b.depth,
          });
        }
      }
    } else {
      const bldgs = generateCommercialVaried(ringM, centroidM, params);
      for (const b of bldgs) {
        const scenePoly = b.cornersLL.map(ll =>
          projectCoordinate({ lat: ll[0], lng: ll[1] }, sceneW, sceneH, 40, bbox)
        );
        if (scenePoly.some(p => isNaN(p.x) || isNaN(p.y))) continue;

        const sceneLot = b.lotCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
        const sceneGreen = b.greenCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));
        const scenePark = b.parkCornersM.map(m => meterToSceneVec(m, refLat, sceneW, sceneH, bbox));

        allBuildings.push({
          id: `zb_${idCounter++}`,
          polygon: scenePoly,
          height: b.stories * 3.5,
          stories: b.stories,
          density: params.max_far_raw,
          center: scenePoly[0],
          fillColor: buildingFillColor(b.zoneFamily, b.stories),
          strokeColor: buildingStrokeColor(b.zoneFamily),
          lotCorners: sceneLot,
          greenCorners: sceneGreen,
          parkCorners: scenePark,
          zoneFamily: b.zoneFamily,
          zoneClass: b.zoneClass,
          renderLot: true,
          renderGreen: params.landscaping_required,
          renderPark: params.parking_requirement_num > 0 || params.non_accessory_parking_allowed,
          width: b.width,
          depth: b.depth,
        });
      }
    }
  }

  const parkCount = allBuildings.filter(b => b.isPark).length;
  console.log(`[ZONING] Generated ${allBuildings.length} buildings, ${parkCount} parks.`);

  return allBuildings;
}

import { 
  Vector2D, Building, Tree, Streetlight, Agent, AgentType, 
  WeightConfig, SimulationParams, HeatmapCell, SimulationStats,
  Coordinate, EnvironmentalIndex
} from '../types';
import { SpatialFeatureRecord, SpatialFeatureWeight, Tract4207Dataset, buildIndicatorRiskFactor } from './tract4207Data';
import { 
  OUTLINE_COORDINATES, BOUNDING_BOX, generateStreetGrid, isPointInPolygon,
  projectCoordinate, unprojectCoordinate, StreetGrid, StreetNode, StreetEdge
} from '../constants/coordinates';
import { getOsmStreetGrid } from './osmRoads';

// Helper to generate unique IDs
export const generateId = () => Math.random().toString(36).substring(2, 9);

// ── OSM-aware street grid: prefer real roads, fall back to synthetic grid ──
function getRoadGrid(width: number, height: number, padding: number, outlineCoords: Coordinate[], bbox: typeof BOUNDING_BOX) {
  const osm = getOsmStreetGrid();
  if (osm && osm.edges.length > 0) {
    return osm;
  }
  console.warn('[ROAD] No custom road network loaded — falling back to synthetic 4×4 grid.');
  return generateStreetGrid(width, height, padding, outlineCoords, bbox);
}

const WALKABLE_ROAD_RADIUS = 16;
const PARK_ENTRY_MAX_DISTANCE = 42;
const PARK_VISIT_PROBABILITY = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getCrowdFactorAtHour(hour: number): number {
  const wrappedHour = ((hour % 24) + 24) % 24;
  if ((wrappedHour >= 7 && wrappedHour <= 9) || (wrappedHour >= 17 && wrappedHour <= 22)) return 1.25;
  if (wrappedHour >= 11 && wrappedHour <= 14) return 1.0;
  return 0.7;
}

export function getDaylightFactorAtHour(hour: number): number {
  const wrappedHour = ((hour % 24) + 24) % 24;
  if (wrappedHour < 5 || wrappedHour >= 21) return 0;
  if (wrappedHour >= 10 && wrappedHour <= 16) return 1;
  if (wrappedHour < 10) return clamp((wrappedHour - 5) / 5, 0, 1);
  return clamp((21 - wrappedHour) / 5, 0, 1);
}

export function areStreetlightsDaytimeOff(hour: number): boolean {
  const wrappedHour = ((hour % 24) + 24) % 24;
  return wrappedHour >= 7 && wrappedHour < 17;
}

export function getCriminalActivityFactorAtHour(hour: number): number {
  const wrappedHour = ((hour % 24) + 24) % 24;
  if (wrappedHour >= 20 || wrappedHour <= 4) return 1;
  if (wrappedHour >= 17) return clamp(0.55 + (wrappedHour - 17) * 0.15, 0.55, 1);
  if (wrappedHour <= 7) return clamp(0.55 + (7 - wrappedHour) * 0.06, 0.55, 1);
  return 0.24;
}

export function getResidentActivityFactorAtHour(hour: number): number {
  return clamp(getCrowdFactorAtHour(hour), 0.45, 1.25);
}

function getParkBuildings(buildings: Building[] = []): Building[] {
  return buildings.filter(b => b.isPark && b.polygon.length >= 3);
}

function sampleSegmentPoint(a: Vector2D, b: Vector2D, t: number): Vector2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function closestPointOnSegment(pt: Vector2D, a: Vector2D, b: Vector2D): Vector2D {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return { ...a };
  let t = ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return sampleSegmentPoint(a, b, t);
}

function closestPointOnPolygonEdges(pt: Vector2D, polygon: Vector2D[]): Vector2D {
  let best = polygon[0] || pt;
  let bestDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const next = polygon[(i + 1) % polygon.length];
    const candidate = closestPointOnSegment(pt, polygon[i], next);
    const dist = Math.hypot(candidate.x - pt.x, candidate.y - pt.y);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return { ...best };
}

function isSegmentInsidePolygon(a: Vector2D, b: Vector2D, polygon: Vector2D[]): boolean {
  for (let step = 0; step <= 8; step++) {
    const pt = sampleSegmentPoint(a, b, step / 8);
    if (!isPointInPolygon(pt, polygon)) return false;
  }
  return true;
}

function isSegmentClearOfBuildings(a: Vector2D, b: Vector2D, buildings: Building[]): boolean {
  return !buildings.some(building => !building.isPark && isLineOfSightBlocked(a, b, building));
}

function getDistanceToRoadGrid(point: Vector2D, grid: StreetGrid, nodes: Map<string, StreetNode>): number {
  let minDist = Infinity;

  for (const edge of grid.edges) {
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    minDist = Math.min(minDist, pointToSegmentDistance(point, fromNode.position, toNode.position));
  }

  if (!isFinite(minDist)) {
    for (const node of grid.nodes) {
      minDist = Math.min(minDist, Math.hypot(point.x - node.position.x, point.y - node.position.y));
    }
  }

  return minDist;
}

function buildAugmentedWalkableGraph(
  width: number,
  height: number,
  outlineCoords: Coordinate[],
  bbox: typeof BOUNDING_BOX,
  buildings: Building[] = [],
): { grid: StreetGrid; parkNodeIds: string[] } {
  const baseGrid = getRoadGrid(width, height, 40, outlineCoords, bbox);
  const parks = getParkBuildings(buildings);
  const nonParkBuildings = buildings.filter(b => !b.isPark);
  const augmentedGrid: StreetGrid = {
    nodes: [...baseGrid.nodes],
    edges: [...baseGrid.edges],
  };
  const parkNodeIds: string[] = [];
  let parkNodeCounter = 0;

  for (const park of parks) {
    const center = park.center;
    const entryCandidates = baseGrid.nodes
      .map(node => {
        const entryPoint = closestPointOnPolygonEdges(node.position, park.polygon);
        const connectorDist = Math.hypot(entryPoint.x - node.position.x, entryPoint.y - node.position.y);
        return { node, entryPoint, connectorDist };
      })
      .filter(candidate =>
        candidate.connectorDist <= PARK_ENTRY_MAX_DISTANCE &&
        isSegmentClearOfBuildings(candidate.node.position, candidate.entryPoint, nonParkBuildings)
      )
      .sort((a, b) => a.connectorDist - b.connectorDist)
      .slice(0, 3);

    if (entryCandidates.length === 0) continue;

    const entryNodeIds: string[] = [];
    for (const candidate of entryCandidates) {
      const entryId = `park_entry_${parkNodeCounter++}`;
      augmentedGrid.nodes.push({ id: entryId, position: candidate.entryPoint, isIntersection: false });
      augmentedGrid.edges.push({
        id: `park_link_${entryId}_${candidate.node.id}`,
        from: entryId,
        to: candidate.node.id,
        distance: Math.round(candidate.connectorDist * 100) / 100,
      });
      entryNodeIds.push(entryId);
      parkNodeIds.push(entryId);
    }

    const interiorPoints: Vector2D[] = [{ ...center }];
    for (let k = 0; k < 4; k++) {
      const rx = center.x + (Math.random() - 0.5) * 70;
      const ry = center.y + (Math.random() - 0.5) * 70;
      const pt = { x: rx, y: ry };
      if (isPointInPolygon(pt, park.polygon)) interiorPoints.push(pt);
    }

    for (const point of interiorPoints) {
      const interiorId = `park_inner_${parkNodeCounter++}`;
      augmentedGrid.nodes.push({ id: interiorId, position: point, isIntersection: false });
      parkNodeIds.push(interiorId);

      for (const entryId of entryNodeIds) {
        const entryNode = augmentedGrid.nodes.find(n => n.id === entryId);
        if (!entryNode) continue;
        if (!isSegmentInsidePolygon(point, entryNode.position, park.polygon)) continue;
        augmentedGrid.edges.push({
          id: `park_inner_link_${interiorId}_${entryId}`,
          from: interiorId,
          to: entryId,
          distance: Math.round(Math.hypot(point.x - entryNode.position.x, point.y - entryNode.position.y) * 100) / 100,
        });
      }
    }
  }

  return { grid: augmentedGrid, parkNodeIds };
}

// Standard Gamma PDF calculation
export function gammaPDF(x: number, shape: number, scale: number): number {
  if (x < 0) return 0;
  // Gamma function approximation for positive integers / floats (using Lanczos approximation)
  const gamma = (z: number): number => {
    const g = 7;
    const p = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507399635941352,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let x = p[0];
    for (let i = 1; i < g + 2; i++) {
      x += p[i] / (z + i);
    }
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  };
  
  const num = Math.pow(x, shape - 1) * Math.exp(-x / scale);
  const den = Math.pow(scale, shape) * gamma(shape);
  return num / den;
}

// Calculate pedestrian flow rate multiplier based on simulated hour (0-23)
export function getFlowRateAtHour(hour: number, shape: number = 4.5, scale: number = 1.5): number {
  const crowdFactor = getCrowdFactorAtHour(hour);
  const peak1 = gammaPDF(((hour % 24) + 24) % 24, shape, scale) * 3.5;
  return clamp(crowdFactor + peak1 * 0.08, 0.45, 1.45);
}

// Check if a line segment AB intersects segment CD
export function lineSegmentsIntersect(
  a: Vector2D, b: Vector2D, c: Vector2D, d: Vector2D
): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (det === 0) return false; // Parallel
  
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  
  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

// Check if line of sight is blocked by a building bounding box
export function isLineOfSightBlocked(
  start: Vector2D, end: Vector2D, building: Building
): boolean {
  const pts = building.polygon;
  const bounds = boundsOf(pts);
  if (Math.max(start.x, end.x) < bounds.minX || Math.min(start.x, end.x) > bounds.maxX
      || Math.max(start.y, end.y) < bounds.minY || Math.min(start.y, end.y) > bounds.maxY) return false;
  for (let i = 0; i < pts.length; i++) {
    const nextIdx = (i + 1) % pts.length;
    if (lineSegmentsIntersect(start, end, pts[i], pts[nextIdx])) {
      return true;
    }
  }
  return false;
}

// Get tree canopy obstruction ratio (fades vision by distance and coverage)
export function getTreeFoliageObscurity(
  start: Vector2D, end: Vector2D, trees: Tree[]
): number {
  let obscurity = 1.0; // 1.0 is clear, drops toward 0.2 (heavily obscured)
  
  trees.forEach(t => {
    // Distance from tree center to line segment
    const dist = pointToSegmentDistance(t.position, start, end);
    if (dist < t.canopyRadius) {
      // Tree lies on vision path, obscure vision
      const penetration = 1.0 - (dist / t.canopyRadius); // 0 to 1
      obscurity *= (1.0 - penetration * 0.45); // reduce visual certainty
    }
  });
  
  return Math.max(0.1, obscurity);
}

// Helper to calculate distance from a point to a line segment
export function pointToSegmentDistance(p: Vector2D, v: Vector2D, w: Vector2D): number {
  const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  
  return Math.hypot(
    p.x - (v.x + t * (w.x - v.x)),
    p.y - (v.y + t * (w.y - v.y))
  );
}

// Parametric generation of buildings in parcel zones between streets
export function generateBuildings(
  width: number, height: number, params: SimulationParams,
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX
): Building[] {
  const streetGrid = getRoadGrid(width, height, 40, outlineCoords, bbox);
  const buildings: Building[] = [];
  
  // Find cells/blocks between street node grid
  const cols = 4;
  const rows = 4;
  
  // Grid centers
  const xCoords: number[] = [];
  const yCoords: number[] = [];
  const outline = outlineCoords.map(c => projectCoordinate(c, width, height, 40, bbox));
  
  // Find bbox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  outline.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  for (let i = 0; i < cols; i++) {
    xCoords.push(minX + (maxX - minX) * (0.15 + 0.7 * (i / (cols - 1))));
  }
  for (let j = 0; j < rows; j++) {
    yCoords.push(minY + (maxY - minY) * (0.15 + 0.7 * (j / (rows - 1))));
  }

  let idCounter = 0;
  
  // Place 1 to 4 buildings per block cell based on density parameter
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const cellMinX = xCoords[c];
      const cellMaxX = xCoords[c + 1];
      const cellMinY = yCoords[r];
      const cellMaxY = yCoords[r + 1];
      
      const cellCenter = {
        x: (cellMinX + cellMaxX) / 2,
        y: (cellMinY + cellMaxY) / 2
      };
      
      // Check if parcel lies inside neighborhood boundary
      if (!isPointInPolygon(cellCenter, outline)) continue;
      
      // Determine how many sub-buildings to place in this cell
      // density ranges from 1 to 3
      const numSubDivs = Math.floor(params.buildingDensity + 0.8); // 1, 2 or 3
      
      const cellW = (cellMaxX - cellMinX) * 0.75;
      const cellH = (cellMaxY - cellMinY) * 0.75;
      
      // Slice parcel into sub-lots
      for (let s = 0; s < numSubDivs; s++) {
        // Parametric width & height scaled by density slider
        const densityFactor = 0.5 + (params.buildingDensity / 6); // 0.6 to 1.1
        const w = (cellW / numSubDivs) * densityFactor;
        const h = cellH * densityFactor * (0.7 + Math.random() * 0.3);
        
        // Compute sub-lot position
        const xOffset = (s - (numSubDivs - 1) / 2) * (cellW / numSubDivs);
        
        // Jitter offsets (building position randomness)
        const jitterX = (Math.random() - 0.5) * params.buildingJitter * 25;
        const jitterY = (Math.random() - 0.5) * params.buildingJitter * 25;
        
        const bCenter = {
          x: cellCenter.x + xOffset + jitterX,
          y: cellCenter.y + jitterY
        };
        
        // Enforce boundary safety check
        if (!isPointInPolygon(bCenter, outline)) continue;
        
        // Define vertices (rectangular wireframes)
        const polygon = [
          { x: bCenter.x - w / 2, y: bCenter.y - h / 2 },
          { x: bCenter.x + w / 2, y: bCenter.y - h / 2 },
          { x: bCenter.x + w / 2, y: bCenter.y + h / 2 },
          { x: bCenter.x - w / 2, y: bCenter.y + h / 2 },
        ];
        
        // Random story heights around buildingHeight parameter
        const heightVariance = 0.8 + Math.random() * 0.4;
        const stories = Math.max(1, Math.round(params.buildingHeight * heightVariance));
        const heightMeters = stories * 3.5; // 3.5m per story
        
        buildings.push({
          id: `b_${idCounter++}`,
          polygon,
          height: heightMeters,
          stories,
          density: params.buildingDensity,
          center: bCenter
        });
      }
    }
  }
  
  return buildings;
}

// Parametric generation of Streetlights along the street network
export function generateStreetlights(
  width: number, height: number, params: SimulationParams,
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX,
  tract4207Dataset?: Tract4207Dataset | null
): Streetlight[] {
  const featureWeights = tract4207Dataset?.featureWeights ?? [];

  const samplePositionsToStreetlights = (samples: SpatialFeatureRecord[], weights: SpatialFeatureWeight[] | undefined): Streetlight[] => {
    if (samples.length === 0) return [];

    const normalize = (values: number[]) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(max - min, 1e-6);
      return (value: number) => (value - min) / span;
    };

    const nsi = normalize(samples.map(s => s.NSI));
    const sai = normalize(samples.map(s => s.SAI));
    const sei = normalize(samples.map(s => s.SEI));
    const gei = normalize(samples.map(s => s.GEI));
    const vdi = normalize(samples.map(s => s.VDI));
    const wi = normalize(samples.map(s => s.WI));
    const ti = normalize(samples.map(s => s.TI));
    const tci = normalize(samples.map(s => s.TCI));
    const di = normalize(samples.map(s => s.DI));

    const featureBoost = (keyword: string) => {
      const match = weights?.find(w => w.indicator.toLowerCase().includes(keyword.toLowerCase()));
      if (!match) return 1;
      return Math.max(0.6, Math.min(1.8, 1 + match.importanceScore / 100 * (match.direction === 'negative_association' ? -1 : 1)));
    };

    const scored = samples.map((sample, index) => {
      const lightNeed = (
        (1 - nsi(index)) * featureBoost('Natural Surveillance') * 0.35 +
        sai(index) * featureBoost('Street Activity') * 0.15 +
        di(index) * featureBoost('Disorder') * 0.2 +
        tci(index) * featureBoost('Traffic Control') * 0.15 +
        (1 - sei(index)) * featureBoost('Street Lights One-Out') * 0.15
      );

      const lightScore = Math.max(0, lightNeed);
      return { sample, lightScore };
    });

    const targetCount = Math.max(12, Math.round(params.lightDensity * 22));
    const seen = new Set<string>();
    let idCounter = 0;

    return scored
      .sort((a, b) => b.lightScore - a.lightScore)
      .filter(item => {
        const key = `${item.sample.latitude.toFixed(5)}:${item.sample.longitude.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, targetCount)
      .map(item => {
        const position = projectCoordinate({ lat: item.sample.latitude, lng: item.sample.longitude }, width, height, 40, bbox);
        const roll = Math.random() * 100;
        const isBroken = roll < params.lightFailureRate;
        return {
          id: `light_${idCounter++}`,
          position,
          intensity: isBroken ? 0 : 1.0,
          radius: 130,
          status: isBroken ? 'off' : 'on',
          isBroken,
        };
        })
        .filter((item): item is Streetlight => item !== null);
  };

  if (tract4207Dataset && tract4207Dataset.samples.length > 0) {
    const lights = samplePositionsToStreetlights(tract4207Dataset.samples, tract4207Dataset.featureWeights);
    if (lights.length > 0) return lights;
  }

  const grid = getRoadGrid(width, height, 40, outlineCoords, bbox);
  const streetlights: Streetlight[] = [];
  let idCounter = 0;
  
  // Distribute streetlights at uniform intervals along street edges
  grid.edges.forEach(edge => {
    const fromNode = grid.nodes.find(n => n.id === edge.from)!;
    const toNode = grid.nodes.find(n => n.id === edge.to)!;
    
    // Number of lights along this edge based on lightDensity slider
    const spacing = Math.max(80, 280 / params.lightDensity);
    const count = Math.max(1, Math.floor(edge.distance / spacing));
    
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = fromNode.position.x + (toNode.position.x - fromNode.position.x) * t;
      const y = fromNode.position.y + (toNode.position.y - fromNode.position.y) * t;
      
      // Jitter streetlight position slightly off the center street to place them on sidewalks
      const angle = Math.atan2(toNode.position.y - fromNode.position.y, toNode.position.x - fromNode.position.x);
      const sideOffset = 10; // offset off-road to sidewalk
      const lx = x + Math.cos(angle + Math.PI / 2) * sideOffset;
      const ly = y + Math.sin(angle + Math.PI / 2) * sideOffset;
      
      // Simulate defective broken lights using lightFailureRate %
      const roll = Math.random() * 100;
      const isBroken = roll < params.lightFailureRate;
      
      streetlights.push({
        id: `light_${idCounter++}`,
        position: { x: lx, y: ly },
        intensity: isBroken ? 0 : 1.0,
        radius: 130, // Light reach radius
        status: isBroken ? 'off' : 'on',
        isBroken
      });
    }
  });
  
  return streetlights;
}

// Parametric generation of Trees along boundaries and lot open spaces
export function generateTrees(
  width: number, height: number, params: SimulationParams, buildings: Building[],
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX,
  tract4207Dataset?: Tract4207Dataset | null
): Tree[] {
  const featureWeights = tract4207Dataset?.featureWeights ?? [];

  const samplePositionsToTrees = (samples: SpatialFeatureRecord[], weights: SpatialFeatureWeight[] | undefined): Tree[] => {
    if (samples.length === 0) return [];

    const normalize = (values: number[]) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(max - min, 1e-6);
      return (value: number) => (value - min) / span;
    };

    const gei = normalize(samples.map(s => s.GEI));
    const wi = normalize(samples.map(s => s.WI));
    const ti = normalize(samples.map(s => s.TI));
    const nsi = normalize(samples.map(s => s.NSI));
    const sei = normalize(samples.map(s => s.SEI));
    const vdi = normalize(samples.map(s => s.VDI));

    const featureBoost = (keyword: string) => {
      const match = weights?.find(w => w.indicator.toLowerCase().includes(keyword.toLowerCase()));
      if (!match) return 1;
      return Math.max(0.6, Math.min(1.8, 1 + match.importanceScore / 100 * (match.direction === 'negative_association' ? -1 : 1)));
    };

    const scored = samples.map((sample, index) => {
      const treeScore = (
        gei(index) * featureBoost('Green Exposure') * 0.4 +
        wi(index) * featureBoost('Walkability') * 0.15 +
        ti(index) * featureBoost('Territoriality') * 0.15 +
        nsi(index) * featureBoost('Natural Surveillance') * 0.1 +
        (1 - vdi(index)) * featureBoost('Vehicle Dominance') * 0.1 +
        (1 - sei(index)) * featureBoost('Street Enclosure') * 0.1
      );
      return { sample, treeScore };
    });

    const targetCount = Math.max(18, Math.round(params.treeDensity * 1.4));
    const seen = new Set<string>();
    let idCounter = 0;

    return scored
      .sort((a, b) => b.treeScore - a.treeScore)
      .filter(item => {
        const key = `${item.sample.latitude.toFixed(5)}:${item.sample.longitude.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, targetCount)
      .map(item => {
        const pos = projectCoordinate({ lat: item.sample.latitude, lng: item.sample.longitude }, width, height, 40, bbox);
        return {
          id: `tree_${idCounter++}`,
          position: pos,
          canopyRadius: params.treeCanopy * (10 + Math.random() * 8),
          height: 4 + Math.random() * 5,
        };
      })
      .filter((item): item is Tree => item !== null);
  };

  if (tract4207Dataset && tract4207Dataset.samples.length > 0) {
    const trees = samplePositionsToTrees(tract4207Dataset.samples, tract4207Dataset.featureWeights);
    if (trees.length > 0) return trees;
  }

  const trees: Tree[] = [];
  const outline = outlineCoords.map(c => projectCoordinate(c, width, height, 40, bbox));
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  outline.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  const numTrees = Math.floor(params.treeDensity * 2.5);
  let attempts = 0;
  let idCounter = 0;
  
  while (trees.length < numTrees && attempts < numTrees * 6) {
    attempts++;
    const tx = minX + Math.random() * (maxX - minX);
    const ty = minY + Math.random() * (maxY - minY);
    const pos = { x: tx, y: ty };
    
    // Check inside neighborhood boundary
    if (!isPointInPolygon(pos, outline)) continue;
    
    // Do not intersect with building footings (with safe padding)
    let overlapsBuilding = false;
    for (let b of buildings) {
      if (pointToBuildingDistance(pos, b) < 15) {
        overlapsBuilding = true;
        break;
      }
    }
    
    if (!overlapsBuilding) {
      const canopy = params.treeCanopy * (10 + Math.random() * 8);
      trees.push({
        id: `tree_${idCounter++}`,
        position: pos,
        canopyRadius: canopy,
        height: 4 + Math.random() * 5
      });
    }
  }
  
  return trees;
}

// Distance from a point to a building polygon
export function pointToBuildingDistance(pt: Vector2D, b: Building): number {
  let minDist = Infinity;
  const pts = b.polygon;
  for (let i = 0; i < pts.length; i++) {
    const nextIdx = (i + 1) % pts.length;
    const dist = pointToSegmentDistance(pt, pts[i], pts[nextIdx]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

// Spawns agents (Residents and Criminals) at street graph nodes and park waypoints
export function spawnAgents(
  width: number, height: number, params: SimulationParams, activeAgents: Agent[],
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX,
  buildings?: Building[],
): Agent[] {
  const { grid: augmentedGrid, parkNodeIds } = buildAugmentedWalkableGraph(width, height, outlineCoords, bbox, buildings);

  const crowdFactor = getCrowdFactorAtHour(params.simHour);
  const criminalActivity = getCriminalActivityFactorAtHour(params.simHour);
  const daylightFactor = getDaylightFactorAtHour(params.simHour);
  const dynamicCriminalShare = clamp(params.criminalRatio * (0.28 + criminalActivity * 1.35 - daylightFactor * 0.18), 0.01, 0.55);

  // Pre-compute connected components so every agent stays on one connected subgraph
  const components = getConnectedComponents(augmentedGrid);

  const updatedAgents = [...activeAgents].filter(a => a.active);
  const activeResidents = updatedAgents.filter(a => a.type === 'resident').length;
  const activeCriminals = updatedAgents.filter(a => a.type === 'criminal').length;
  const targetCount = Math.max(6, Math.floor(24 * params.spawnRate * crowdFactor));
  const targetCriminalCount = Math.max(0, Math.round(targetCount * dynamicCriminalShare));
  const targetResidentCount = Math.max(2, targetCount - targetCriminalCount);
  const residentDeficit = Math.max(0, targetResidentCount - activeResidents);
  const criminalDeficit = Math.max(0, targetCriminalCount - activeCriminals);
  const spawnPlan: AgentType[] = [
    ...Array.from({ length: residentDeficit }, () => 'resident' as const),
    ...Array.from({ length: criminalDeficit }, () => 'criminal' as const),
  ];

  if (spawnPlan.length > 0) {
    for (const type of spawnPlan) {
      if (augmentedGrid.nodes.length < 2) continue;

      // Pick a random connected component that has at least 2 nodes
      const validComps = components.filter(c => c.length >= 2);
      if (validComps.length === 0) continue;
      const comp = chooseWeightedComponent(validComps);
      if (!comp) continue;

      const parkNodesInComp = comp.filter(id => parkNodeIds.includes(id));
      const roadNodesInComp = comp.filter(id => !parkNodeIds.includes(id));
      const prefersPark = parkNodesInComp.length > 0 && Math.random() < (type === 'resident' ? 0.55 : 0.22);

      const spawnPool = roadNodesInComp.length > 0 ? roadNodesInComp : comp;
      const startId = spawnPool[Math.floor(Math.random() * spawnPool.length)];
      let endId = startId;

      if (prefersPark) {
        const parkTargetPool = parkNodesInComp.filter(id => id !== startId);
        if (parkTargetPool.length > 0) {
          endId = parkTargetPool[Math.floor(Math.random() * parkTargetPool.length)];
        }
      }

      if (endId === startId && comp.length > 1) {
        let bestCandidate = comp.find(id => id !== startId) || startId;
        let bestPathLength = -1;
        for (const candidateId of comp) {
          if (candidateId === startId) continue;
          const candidatePath = findGridPath(startId, candidateId, augmentedGrid);
          if (candidatePath.length > bestPathLength) {
            bestCandidate = candidateId;
            bestPathLength = candidatePath.length;
          }
        }
        endId = bestCandidate;
      }
      
      const startNode = augmentedGrid.nodes.find(n => n.id === startId)!;
      const endNode = augmentedGrid.nodes.find(n => n.id === endId)!;
      
      // Find path through the augmented road + park graph
      const calculatedPath = findGridPath(startNode.id, endNode.id, augmentedGrid);
      if (calculatedPath.length === 0) continue;

      const waypoints = calculatedPath.map(id => augmentedGrid.nodes.find(n => n.id === id)!.position);

      updatedAgents.push({
        id: `agent_${generateId()}`,
        type,
        position: { ...startNode.position },
        target: { ...endNode.position },
        path: waypoints,
        pathIndex: 0,
        speed: (type === 'criminal' ? 0.8 : 0.6) * (0.8 + Math.random() * 0.4),
        angle: 0,
        visionAngle: type === 'criminal' ? 130 : 100, // Criminals scan wider
        visionRange: type === 'criminal' ? 160 : 120, // Criminals focus further
        active: true,
        stealth: type === 'criminal' ? 0.4 + Math.random() * 0.4 : 0.1, // Criminals utilize shadow cover
        destinationKind: parkNodeIds.includes(endId) ? 'park' : 'road',
        lingerTicksRemaining: parkNodeIds.includes(endId)
          ? Math.round(type === 'resident' ? 120 + Math.random() * 180 : 48 + Math.random() * 84)
          : Math.round(8 + Math.random() * 28),
      });
    }
  }
  
  return updatedAgents;
}

// ── Connected Components ──────────────────────────────────
// Build adjacency and compute connected components via BFS.

function buildAdjacency(grid: ReturnType<typeof generateStreetGrid>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of grid.nodes) adj.set(n.id, []);
  for (const e of grid.edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }
  return adj;
}

function getConnectedComponents(grid: ReturnType<typeof generateStreetGrid>): string[][] {
  const adj = buildAdjacency(grid);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of grid.nodes) {
    if (visited.has(node.id)) continue;
    const comp: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const nb of adj.get(cur) || []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

function chooseWeightedComponent(components: string[][]): string[] | null {
  if (components.length === 0) return null;
  const weighted = components.map(comp => ({
    comp,
    weight: Math.max(1, comp.length * comp.length),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.comp;
  }
  return weighted[weighted.length - 1].comp;
}

// Simple pathfinder on street network grid
function findGridPath(startId: string, endId: string, grid: ReturnType<typeof generateStreetGrid>): string[] {
  if (startId === endId) return [startId];

  const adj = buildAdjacency(grid);
  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const lastNodeId = path[path.length - 1];

    if (lastNodeId === endId) return path;

    const neighbors = adj.get(lastNodeId) || [];
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push([...path, nb]);
      }
    }
  }

  // No path exists between these nodes — components are disconnected
  return [];
}

// Update agent coordinates along their paths
export function updateAgents(
  agents: Agent[], buildings: Building[], speedFactor: number = 1.0
): Agent[] {
  return agents.map(agent => {
    if (!agent.active) return agent;

    if (agent.pathIndex >= agent.path.length) {
      if ((agent.lingerTicksRemaining ?? 0) > 0) {
        return {
          ...agent,
          lingerTicksRemaining: (agent.lingerTicksRemaining ?? 0) - 1,
        };
      }
      return { ...agent, active: false };
    }
    
    const targetPos = agent.path[agent.pathIndex];
    if (!targetPos) {
      return { ...agent, active: false };
    }
    
    const dist = Math.hypot(targetPos.x - agent.position.x, targetPos.y - agent.position.y);
    const step = agent.speed * speedFactor;
    
    let newPos = { ...agent.position };
    let newPathIndex = agent.pathIndex;
    let headingAngle = agent.angle;
    
    if (dist <= step) {
      // Reached waypoint, advance to next
      newPos = { ...targetPos };
      newPathIndex += 1;
      if (newPathIndex >= agent.path.length) {
        if ((agent.lingerTicksRemaining ?? 0) > 0) {
          return {
            ...agent,
            position: newPos,
            pathIndex: newPathIndex,
            angle: headingAngle,
            lingerTicksRemaining: (agent.lingerTicksRemaining ?? 0) - 1,
          };
        }
        return { ...agent, active: false };
      }
      
      const nextTarget = agent.path[newPathIndex];
      headingAngle = Math.atan2(nextTarget.y - newPos.y, nextTarget.x - newPos.x);
    } else {
      // Walk towards current waypoint
      headingAngle = Math.atan2(targetPos.y - agent.position.y, targetPos.x - agent.position.x);
      newPos.x += Math.cos(headingAngle) * step;
      newPos.y += Math.sin(headingAngle) * step;
    }
    
    return {
      ...agent,
      position: newPos,
      pathIndex: newPathIndex,
      angle: headingAngle
    };
  });
}

// Calculate static lighting illumination field at point P
export function getIlluminationAtPoint(
  pos: Vector2D, streetlights: Streetlight[], simHour?: number
): number {
  if (typeof simHour === 'number' && areStreetlightsDaytimeOff(simHour)) return 0;
  let lightSum = 0;
  
  streetlights.forEach(light => {
    if (light.status === 'off' || light.isBroken) return;
    
    const d = Math.hypot(pos.x - light.position.x, pos.y - light.position.y);
    if (d < light.radius) {
      // Light decays exponentially/quadratically with distance
      const attenuation = Math.pow(1.0 - d / light.radius, 1.8);
      lightSum += light.intensity * attenuation;
    }
  });
  
  return Math.min(1.0, lightSum);
}

// Returns a boolean if a person A has clear line of sight to person B (incorporating building shadow/block)
export function hasClearLineOfSight(
  observer: Vector2D, target: Vector2D, buildings: Building[]
): boolean {
  for (let b of buildings) {
    if (isLineOfSightBlocked(observer, target, b)) {
      return false;
    }
  }
  return true;
}

type HeatmapSample = Vector2D & { density: number; insidePark: boolean };
type HeatmapGeometry = {
  width: number;
  height: number;
  gridSpacing: number;
  outlineCoords: Coordinate[];
  bbox: typeof BOUNDING_BOX;
  roadGrid: StreetGrid;
  points: HeatmapSample[];
  lighting?: { lights: Streetlight[]; values: number[] };
  canopy?: { trees: Tree[]; values: number[] };
};

// The app replaces scene arrays when geometry, lights or trees change.
const heatmapGeometry = new WeakMap<Building[], HeatmapGeometry>();
const buildingBounds = new WeakMap<Vector2D[], { minX: number; minY: number; maxX: number; maxY: number }>();

function boundsOf(polygon: Vector2D[]) {
  const prior = buildingBounds.get(polygon);
  if (prior) return prior;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of polygon) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  buildingBounds.set(polygon, bounds);
  return bounds;
}

function getHeatmapGeometry(
  width: number, height: number, gridSpacing: number, buildings: Building[],
  outlineCoords: Coordinate[], bbox: typeof BOUNDING_BOX,
): HeatmapGeometry {
  const roadGrid = getRoadGrid(width, height, 40, outlineCoords, bbox);
  const prior = heatmapGeometry.get(buildings);
  if (prior && prior.width === width && prior.height === height && prior.gridSpacing === gridSpacing
      && prior.outlineCoords === outlineCoords && prior.bbox === bbox && prior.roadGrid === roadGrid) return prior;
  const outline = outlineCoords.map(point => projectCoordinate(point, width, height, 40, bbox));
  const { minX, maxX, minY, maxY } = boundsOf(outline);
  const parks = getParkBuildings(buildings);
  const nodes = new Map(roadGrid.nodes.map(node => [node.id, node]));
  const footprints = buildings.filter(building => !building.isPark).map(building => ({
    building,
    bounds: boundsOf(building.polygon),
    multiplier: 0.4 + 0.35 * clamp((building.height || 0) / 50, 0, 1)
      + 0.25 * clamp((building.density || 1) / 3, 0, 1),
  }));
  const points: HeatmapSample[] = [];
  for (let x = minX; x <= maxX; x += gridSpacing) {
    for (let y = minY; y <= maxY; y += gridSpacing) {
      const point = { x, y };
      if (!isPointInPolygon(point, outline)) continue;
      const insidePark = parks.some(park => isPointInPolygon(point, park.polygon));
      if (!insidePark && !(getDistanceToRoadGrid(point, roadGrid, nodes) <= WALKABLE_ROAD_RADIUS)) continue;
      let density = 0;
      let insideBuilding = false;
      for (const { building, bounds, multiplier } of footprints) {
        if (x + 40 < bounds.minX || x - 40 > bounds.maxX || y + 40 < bounds.minY || y - 40 > bounds.maxY) continue;
        const distance = pointToBuildingDistance(point, building);
        if (distance < 3) {
          insideBuilding = true;
          break;
        }
        if (distance < 40) density += (1 - distance / 40) * multiplier;
      }
      if (!insideBuilding) points.push({ ...point, insidePark, density: Math.min(1, density / 3) });
    }
  }
  const result = { width, height, gridSpacing, outlineCoords, bbox, roadGrid, points };
  heatmapGeometry.set(buildings, result);
  return result;
}

function canopyAtPoint(point: Vector2D, trees: Tree[]): number {
  let cover = 0;
  for (const tree of trees) {
    const radius = tree.canopyRadius * 1.5;
    const distance = Math.hypot(point.x - tree.position.x, point.y - tree.position.y);
    if (distance < radius) cover += 1 - distance / radius;
  }
  return Math.min(1, cover);
}

// Reverse analysis: calculate crime risk heatmap across grid coordinates
export function generateHeatmap(
  width: number, height: number, gridSpacing: number,
  buildings: Building[], streetlights: Streetlight[], trees: Tree[],
  agents: Agent[], weights: WeightConfig[],
  simHour: number,
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX,
  environmentalIndices: EnvironmentalIndex[] = []
): HeatmapCell[] {
  const heatmap: HeatmapCell[] = [];
  // Extract weight configuration factors
  const getWeight = (key: string): number => weights.find(w => w.key === key)?.weight ?? 0;

  const wLight = getWeight('light');
  const wBystander = getWeight('bystander');
  const wCriminal = getWeight('criminal');
  const wTree = getWeight('tree');
  const wDensity = getWeight('density');
  const nightActivity = getCriminalActivityFactorAtHour(simHour);
  const daylightFactor = getDaylightFactorAtHour(simHour);
  const geometry = getHeatmapGeometry(width, height, gridSpacing, buildings, outlineCoords, bbox);
  const lightsOff = areStreetlightsDaytimeOff(simHour);
  if (!lightsOff && geometry.lighting?.lights !== streetlights) {
    geometry.lighting = { lights: streetlights, values: geometry.points.map(point => getIlluminationAtPoint(point, streetlights)) };
  }
  if (geometry.canopy?.trees !== trees) {
    geometry.canopy = { trees, values: geometry.points.map(point => canopyAtPoint(point, trees)) };
  }

  const residents = agents.filter(a => a.active && a.type === 'resident');
  const criminals = agents.filter(a => a.active && a.type === 'criminal');

  const indicatorRiskFactor = buildIndicatorRiskFactor(environmentalIndices);
  const liveCriminalPressure = criminals.length > 0
    ? clamp(criminals.length / Math.max(1, residents.length + criminals.length), 0, 0.55)
    : 0;

  for (const [index, p] of geometry.points.entries()) {
    const { x, y } = p;
    const illumination = lightsOff ? 0 : geometry.lighting!.values[index];

    // 2. Bystander Surveillance: can active residents see this coordinate?
    let bystanderEyes = 0;
    residents.forEach(r => {
      const d = Math.hypot(p.x - r.position.x, p.y - r.position.y);
      if (d < r.visionRange) {
        // Check line-of-sight angle limits (vision cone)
        const angleToPoint = Math.atan2(p.y - r.position.y, p.x - r.position.x);
        let diff = Math.abs(angleToPoint - r.angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        const fovRad = (r.visionAngle * Math.PI) / 180;
        if (diff < fovRad / 2) {
          // Check building occlusion
          if (hasClearLineOfSight(r.position, p, buildings)) {
            // Tree foliage attenuates sight slightly
            const leafClog = getTreeFoliageObscurity(r.position, p, trees);
            bystanderEyes += (1.0 - d / r.visionRange) * leafClog;
          }
        }
      }
    });
    bystanderEyes = Math.min(1.0, bystanderEyes);

    // 3. Criminal Sight Field: can criminals monitor this location?
    let criminalEyes = 0;
    criminals.forEach(c => {
      const d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
      if (d < c.visionRange) {
        const angleToPoint = Math.atan2(p.y - c.position.y, p.x - c.position.x);
        let diff = Math.abs(angleToPoint - c.angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        const fovRad = (c.visionAngle * Math.PI) / 180;
        if (diff < fovRad / 2) {
          if (hasClearLineOfSight(c.position, p, buildings)) {
            const leafClog = getTreeFoliageObscurity(c.position, p, trees);
            criminalEyes += (1.0 - d / c.visionRange) * leafClog;
          }
        }
      }
    });
    criminalEyes = Math.min(1.0, criminalEyes);

    // 4. Canopy Density Cover / Hiding Factor
    const canopyCover = geometry.canopy.values[index];

    // ── Criminal proximity bonus ──────────────────────────
    let criminalProximityBonus = 0;
    let minCriminalDist = Infinity;
    for (const c of criminals) {
      const d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
      if (d < minCriminalDist) minCriminalDist = d;
    }
    if (minCriminalDist < 90) {
      criminalProximityBonus = (1 - minCriminalDist / 90) * (0.08 + nightActivity * 0.18);
    }

    // ── Park risk bonus ──────────────────────────────────
    const parkRiskBonus = p.insidePark ? 0.04 + nightActivity * 0.07 : 0;
    const darkness = (1 - illumination) * (1 - daylightFactor * 0.92);
    const surveillanceGap = 1 - bystanderEyes;

    const weightedRiskNumerator =
      darkness * wLight * (0.12 + (1 - daylightFactor) * 0.78) +
      surveillanceGap * wBystander * 1.0 +
      criminalEyes * wCriminal * 0.95 +
      canopyCover * wTree * 0.55 +
      p.density * wDensity * 1.2;
    const weightedRiskDenominator =
      wLight * (0.12 + (1 - daylightFactor) * 0.78) +
      wBystander * 1.0 +
      wCriminal * 0.95 +
      wTree * 0.55 +
      wDensity * 1.2;

    const factorRisk = weightedRiskDenominator > 0
      ? weightedRiskNumerator / weightedRiskDenominator
      : 0;
    const baseVal = 0.025 + nightActivity * 0.14 - daylightFactor * 0.04;

    let risk = (baseVal + factorRisk * (0.56 + nightActivity * 0.22 - daylightFactor * 0.08) + liveCriminalPressure * 0.18 + criminalProximityBonus + parkRiskBonus) * indicatorRiskFactor;
    risk = Math.max(0.01, Math.min(0.99, risk));

    heatmap.push({
      x,
      y,
      risk,
      illumination,
      bystanderEyes,
      criminalEyes
    });
  }

  return heatmap;
}

// Compute general safety stats for the dashboard panels
export function calculateStats(
  heatmap: HeatmapCell[], streetlights: Streetlight[], agents: Agent[]
): SimulationStats {
  if (heatmap.length === 0) {
    return {
      averageRisk: 0.3,
      safetyScore: 70,
      activeResidents: 0,
      activeCriminals: 0,
      brokenLightsCount: 0,
      totalLightsCount: 0,
      crimeIncidents: 0
    };
  }
  
  let totalRisk = 0;
  heatmap.forEach(cell => {
    totalRisk += cell.risk;
  });
  
  const averageRisk = totalRisk / heatmap.length;
  // Safety score is inverted of average risk (risk 0.0 -> safety 100, risk 1.0 -> safety 0)
  const safetyScore = Math.max(0, Math.min(100, Math.round((1.0 - averageRisk) * 100)));
  
  const activeResidents = agents.filter(a => a.active && a.type === 'resident').length;
  const activeCriminals = agents.filter(a => a.active && a.type === 'criminal').length;
  
  const brokenLightsCount = streetlights.filter(l => l.isBroken || l.status === 'off').length;
  const totalLightsCount = streetlights.length;
  
  // Incidents count is simulated dynamically based on risk overlapping with criminals
  const highRiskAreas = heatmap.filter(c => c.risk > 0.7 && c.criminalEyes > 0.4).length;
  const crimeIncidents = Math.round(highRiskAreas / 12);

  return {
    averageRisk,
    safetyScore,
    activeResidents,
    activeCriminals,
    brokenLightsCount,
    totalLightsCount,
    crimeIncidents
  };
}

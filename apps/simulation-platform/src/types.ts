export interface Vector2D {
  x: number;
  y: number;
}

export interface Coordinate {
  lng: number;
  lat: number;
}

export type AgentType = 'resident' | 'criminal';

export interface Agent {
  id: string;
  type: AgentType;
  position: Vector2D;
  target: Vector2D;
  path: Vector2D[];
  pathIndex: number;
  speed: number;
  angle: number; // movement heading angle
  visionAngle: number; // FOV angle (e.g. 120 degrees)
  visionRange: number; // visual reach in local coordinates
  active: boolean;
  stealth: number; // how hard they are to see in dark
  lingerTicksRemaining?: number; // how long the agent pauses at the destination
  destinationKind?: 'road' | 'park';
}

export interface Building {
  id: string;
  polygon: Vector2D[]; // Normalized vertices
  height: number;      // Parametric height
  stories: number;     // Floor levels
  density: number;     // Density factor
  center: Vector2D;
  fillColor?: string;  // Optional RGBA fill for zoning-aware rendering
  strokeColor?: string;// Optional RGBA stroke for zoning-aware rendering
  isPark?: boolean;    // Whether this is a park/green space (not a building)
}

export interface Tree {
  id: string;
  position: Vector2D;
  canopyRadius: number;
  height: number;
}

export interface Streetlight {
  id: string;
  position: Vector2D;
  intensity: number;
  radius: number;
  status: 'on' | 'off';
  isBroken: boolean;
}

export interface WeightConfig {
  key: string;
  name: string;
  category: 'environment' | 'surveillance' | 'criminal';
  weight: number; // Influence weight (-1.0 to 1.0)
  description: string;
}

export interface SimulationParams {
  buildingHeight: number;       // Slider: height of buildings (stories)
  buildingDensity: number;      // Slider: building lot size/filling
  buildingJitter: number;       // Slider: position randomness
  treeDensity: number;          // Slider: number of trees
  treeCanopy: number;           // Slider: canopy size
  lightDensity: number;         // Slider: number of streetlights
  lightFailureRate: number;     // Slider: percentage of damaged lights
  simHour: number;              // Current simulated hour (0-23)
  spawnRate: number;            // Overall spawn multiplier
  criminalRatio: number;        // Ratio of criminals spawned (0-0.5)
  showVisionCones: boolean;     // Render criminal FOV paths
  showHeatmap: boolean;         // Render crime probability heatmap
  heatmapOpacity: number;       // Heatmap opacity slider
  showPastCrimes: boolean;      // Toggle historical crime markers
  showEnvironmentalIndices: boolean; // Toggle environmental indices visualizer
}

export interface HeatmapCell {
  x: number;
  y: number;
  risk: number; // calculated crime probability (0 to 1)
  illumination: number;
  bystanderEyes: number; // resident eyes on this spot
  criminalEyes: number;  // criminal eyes on this spot
}

export interface SimulationStats {
  averageRisk: number;
  safetyScore: number;          // 0-100 overall safety index
  activeResidents: number;
  activeCriminals: number;
  brokenLightsCount: number;
  totalLightsCount: number;
  crimeIncidents: number;       // simulated events
}

export interface PastCrime {
  id: string;
  lat: number;
  lng: number;
  type: 'Theft' | 'Assault' | 'Vandalism' | 'Robbery' | 'Burglary';
  time: string;
  severity: 'low' | 'medium' | 'high';
}

export interface EnvironmentalIndex {
  key: string;
  name: string;
  value: number; // 0-100 or 0-1.0
  description: string;
  category: 'safety' | 'environment' | 'surveillance' | 'social';
  lat: number;
  lng: number;
}


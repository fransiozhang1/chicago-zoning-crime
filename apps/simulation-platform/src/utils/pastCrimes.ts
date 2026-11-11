import { PastCrime } from '../types';
import { Tract } from '../constants/tracts';
import { DEATH_CRIMES_4207 } from '../constants/deathCrimes4207';

// A simple deterministic seeded random generator so crime spots are stable
function makeSeededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function isLatLngInPolygon(
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  const px = point.lng;
  const py = point.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    
    const intersect = ((yi > py) !== (yj > py))
        && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-10) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const CRIME_TYPES = ['Theft', 'Assault', 'Vandalism', 'Robbery', 'Burglary'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;

const CRIME_DESCRIPTIONS = {
  Theft: 'Vehicle retail theft reported near commercial store',
  Assault: 'Street fight/physical altercation reported late night',
  Vandalism: 'Graffiti and property damage on public building',
  Robbery: 'Armed mugging reported near transit stop alley',
  Burglary: 'Residential forced entry reported in evening hours'
};

export function generatePastCrimesForTract(tract: Tract, count: number = 18): PastCrime[] {
  if (tract.id === '420700' || tract.id.includes('4207')) {
    return DEATH_CRIMES_4207;
  }

  const rand = makeSeededRandom(tract.id);
  const crimes: PastCrime[] = [];
  const bbox = tract.boundingBox;
  
  let attempts = 0;
  while (crimes.length < count && attempts < count * 50) {
    attempts++;
    // Pick random coordinates within bounding box
    const lat = bbox.minLat + rand() * (bbox.maxLat - bbox.minLat);
    const lng = bbox.minLng + rand() * (bbox.maxLng - bbox.minLng);
    
    const candidate = { lat, lng };
    if (isLatLngInPolygon(candidate, tract.coordinates)) {
      const typeIdx = Math.floor(rand() * CRIME_TYPES.length);
      const type = CRIME_TYPES[typeIdx];
      const severity = SEVERITIES[Math.floor(rand() * SEVERITIES.length)];
      
      // Generate a realistic past date in 2025/2026
      const month = String(Math.floor(rand() * 12) + 1).padStart(2, '0');
      const day = String(Math.floor(rand() * 28) + 1).padStart(2, '0');
      const hour = String(Math.floor(rand() * 24)).padStart(2, '0');
      const min = String(Math.floor(rand() * 60)).padStart(2, '0');
      const year = rand() > 0.5 ? '2025' : '2026';
      const time = `${year}-${month}-${day} ${hour}:${min}`;
      
      crimes.push({
        id: `past_crime_${tract.id}_${crimes.length}`,
        lat,
        lng,
        type,
        time,
        severity
      });
    }
  }
  
  return crimes;
}

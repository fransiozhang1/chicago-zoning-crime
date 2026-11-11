import { PastCrime } from '../types';
import { CHICAGO_TRACTS } from './tracts';
import deathCrimesCsv from '../../death_crimes_4207.csv?raw';

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

function parseDelimitedCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let value = '';
  let inQuotes = false;

  const pushValue = () => {
    current.push(value.trim());
    value = '';
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      pushValue();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++;
      pushValue();
      if (current.length > 1 || current[0] !== '') {
        rows.push(current);
      }
      current = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || current.length > 0) {
    pushValue();
    if (current.length > 1 || current[0] !== '') {
      rows.push(current);
    }
  }

  return rows;
}

function toNumber(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isLatLngInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  const px = point.lng;
  const py = point.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-10) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const tract4207 = CHICAGO_TRACTS.find(t => t.id === '420700') || CHICAGO_TRACTS[0];
const rand = makeSeededRandom('4207-death-crimes');

const rawRows = parseDelimitedCsv(deathCrimesCsv);
const header = rawRows.shift() || [];

export const DEATH_CRIMES_4207: PastCrime[] = rawRows
  .filter(row => (row[5] ?? '').trim() === '4207')
  .map((row, index) => {
    const lat = toNumber(row[6] ?? '');
    const lng = toNumber(row[7] ?? '');
    const year = row[1] ?? '2025';
    const month = String(row[2] ?? '1').padStart(2, '0');
    const day = String(row[3] ?? '1').padStart(2, '0');
    const timeRaw = String(row[4] ?? '0').padStart(4, '0');
    const time = `${year}-${month}-${day} ${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}`;

    let finalLat = lat;
    let finalLng = lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isLatLngInPolygon({ lat, lng }, tract4207.coordinates)) {
      let found = false;
      let attempts = 0;
      while (!found && attempts < 200) {
        attempts++;
        const latCand = tract4207.boundingBox.minLat + (tract4207.boundingBox.maxLat - tract4207.boundingBox.minLat) * (0.12 + rand() * 0.76);
        const lngCand = tract4207.boundingBox.minLng + (tract4207.boundingBox.maxLng - tract4207.boundingBox.minLng) * (0.12 + rand() * 0.76);
        if (isLatLngInPolygon({ lat: latCand, lng: lngCand }, tract4207.coordinates)) {
          finalLat = latCand;
          finalLng = lngCand;
          found = true;
        }
      }
      if (!found) {
        finalLat = tract4207.center.lat + (index % 11) * 0.0002;
        finalLng = tract4207.center.lng + (index % 7) * 0.0002;
      }
    }

    return {
      id: `death_crime_4207_${index}`,
      lat: finalLat,
      lng: finalLng,
      type: 'Robbery',
      time,
      severity: 'medium',
    } as PastCrime;
  })
  .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));

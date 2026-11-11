import { Building, Coordinate, Vector2D } from '../types';
import { Tract } from '../constants/tracts';
import { unprojectCoordinate } from '../constants/coordinates';

interface ExportCadOptions {
  buildings: Building[];
  tract: Tract;
  width: number;
  height: number;
  padding?: number;
}

interface CadPoint {
  x: number;
  y: number;
}

const EARTH_RADIUS_METERS = 6378137;

function toLocalMeters(coord: Coordinate, origin: Coordinate): CadPoint {
  const latRad = coord.lat * (Math.PI / 180);
  const lngRad = coord.lng * (Math.PI / 180);
  const originLatRad = origin.lat * (Math.PI / 180);
  const originLngRad = origin.lng * (Math.PI / 180);

  return {
    x: (lngRad - originLngRad) * Math.cos((latRad + originLatRad) / 2) * EARTH_RADIUS_METERS,
    y: (latRad - originLatRad) * EARTH_RADIUS_METERS,
  };
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

function ensureClosed(points: CadPoint[]): CadPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
    return points;
  }
  return [...points, first];
}

function polylineEntity(layer: string, points: CadPoint[]): string {
  const closedPoints = ensureClosed(points);
  const body = closedPoints
    .map(point => `0\nVERTEX\n8\n${layer}\n10\n${formatNumber(point.x)}\n20\n${formatNumber(point.y)}\n30\n0.000`)
    .join('\n');

  return [
    '0',
    'POLYLINE',
    '8',
    layer,
    '66',
    '1',
    '70',
    '1',
    body,
    '0',
    'SEQEND',
  ].join('\n');
}

function buildingToGeoPolygon(
  polygon: Vector2D[],
  width: number,
  height: number,
  tract: Tract,
  padding: number
): Coordinate[] {
  return polygon.map(point =>
    unprojectCoordinate(point, width, height, padding, tract.boundingBox)
  );
}

export function buildNeighborhoodCadDxf({
  buildings,
  tract,
  width,
  height,
  padding = 40,
}: ExportCadOptions): string {
  const origin = tract.center;
  const boundaryPoints = tract.coordinates.map(coord => toLocalMeters(coord, origin));

  const buildingEntities = buildings
    .filter(building => building.polygon.length >= 3)
    .map(building => {
      const geoPolygon = buildingToGeoPolygon(building.polygon, width, height, tract, padding);
      const localPoints = geoPolygon.map(coord => toLocalMeters(coord, origin));
      const layer = building.isPark ? 'PARKS' : 'BUILDINGS';
      return polylineEntity(layer, localPoints);
    });

  const entities = [
    polylineEntity('TRACT_BOUNDARY', boundaryPoints),
    ...buildingEntities,
  ].join('\n');

  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    entities,
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');
}


import { Coordinate, EnvironmentalIndex } from '../types';

export interface SpatialFeatureRecord {
  imageId: string;
  filename: string;
  latitude: number;
  longitude: number;
  NSI: number;
  SAI: number;
  SEI: number;
  GEI: number;
  VDI: number;
  WI: number;
  TI: number;
  TCI: number;
  DI: number;
}

export interface SpatialFeatureWeight {
  indicator: string;
  mean: number;
  std?: number;
  importanceScore: number;
  importanceRank: number;
  spearmanRho: number;
  direction: 'positive_association' | 'negative_association' | 'unclear';
}

export interface Tract4207Dataset {
  samples: SpatialFeatureRecord[];
  featureWeights: SpatialFeatureWeight[];
}

const INDICATOR_KEYS = ['NSI', 'SAI', 'SEI', 'GEI', 'VDI', 'WI', 'TI', 'TCI', 'DI'] as const;

const INDICATOR_META: Record<(typeof INDICATOR_KEYS)[number], { name: string; category: EnvironmentalIndex['category']; description: string; direction: 'positive' | 'negative' }> = {
  NSI: { name: '自然监视 (Natural Surveillance)',  category: 'surveillance',  description: '街道沿线合法视线对公共空间的被动监视密度。', direction: 'positive' },
  SAI: { name: '街道活动 (Street Activity)',       category: 'social',       description: '公共空间中行人和经济活动的聚集频次。', direction: 'positive' },
  SEI: { name: '围合度 (Street Enclosure)',        category: 'environment',  description: '建筑高度与街道宽度比形成的物理围合感。', direction: 'negative' },
  GEI: { name: '绿化暴露 (Green Exposure)',        category: 'environment',  description: '植被冠层在街景中的视觉占比。', direction: 'negative' },
  VDI: { name: '车辆主导 (Vehicle Dominance)',     category: 'environment',  description: '车行道宽度与车速对步行环境的压制程度。', direction: 'negative' },
  WI:  { name: '步行性 (Walkability)',             category: 'social',       description: '人行道宽度、过街设施与街道连续性的综合得分。', direction: 'positive' },
  TI:  { name: '领域性 (Territoriality)',          category: 'surveillance',  description: '建筑临街面、栅栏、标识等对空间主权的暗示强度。', direction: 'positive' },
  TCI: { name: '交通控制 (Traffic Control)',       category: 'safety',       description: '信号灯、减速带、斑马线等交通约束设施的密度。', direction: 'positive' },
  DI:  { name: '失序度 (Disorder)',                category: 'safety',       description: '涂鸦、垃圾、破损设施等物理失序现象的严重程度。', direction: 'negative' },
};

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

    if (!inQuotes && (char === ',')) {
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
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseSpatialFeatureWeightsCsv(text: string): SpatialFeatureWeight[] {
  const rows = parseDelimitedCsv(text);
  const header = rows.shift();
  if (!header) return [];

  const headerIndex = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  return rows
    .map(row => ({
      indicator: row[headerIndex.get('indicator') ?? 0] ?? '',
      mean: toNumber(row[headerIndex.get('mean') ?? 1] ?? '0'),
      std: toNumber(row[headerIndex.get('std') ?? 2] ?? '0'),
      importanceScore: toNumber(row[headerIndex.get('importance_score') ?? 3] ?? '0'),
      importanceRank: Math.round(toNumber(row[headerIndex.get('importance_rank') ?? 4] ?? '0')),
      spearmanRho: toNumber(row[headerIndex.get('spearman_rho') ?? 5] ?? '0'),
      direction: (row[headerIndex.get('direction') ?? 6] ?? 'unclear') as SpatialFeatureWeight['direction'],
    }))
    .filter(item => item.indicator.length > 0)
    .sort((a, b) => a.importanceRank - b.importanceRank);
}

export function parseSpatialSamplesCsv(text: string): SpatialFeatureRecord[] {
  const rows = parseDelimitedCsv(text);
  const header = rows.shift();
  if (!header) return [];

  const headerIndex = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  return rows
    .map(row => ({
      imageId: row[headerIndex.get('image_id') ?? 0] ?? '',
      filename: row[headerIndex.get('filename') ?? 1] ?? '',
      latitude: toNumber(row[headerIndex.get('latitude') ?? 2] ?? '0'),
      longitude: toNumber(row[headerIndex.get('longitude') ?? 3] ?? '0'),
      NSI: toNumber(row[headerIndex.get('nsi') ?? 4] ?? '0'),
      SAI: toNumber(row[headerIndex.get('sai') ?? 5] ?? '0'),
      SEI: toNumber(row[headerIndex.get('sei') ?? 6] ?? '0'),
      GEI: toNumber(row[headerIndex.get('gei') ?? 7] ?? '0'),
      VDI: toNumber(row[headerIndex.get('vdi') ?? 8] ?? '0'),
      WI: toNumber(row[headerIndex.get('wi') ?? 9] ?? '0'),
      TI: toNumber(row[headerIndex.get('ti') ?? 10] ?? '0'),
      TCI: toNumber(row[headerIndex.get('tci') ?? 11] ?? '0'),
      DI: toNumber(row[headerIndex.get('di') ?? 12] ?? '0'),
    }))
    .filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
}

function normalize(values: number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-6);
  return (value: number) => Math.max(0, Math.min(1, (value - min) / span));
}

function weightedCentroid(samples: SpatialFeatureRecord[], score: (sample: SpatialFeatureRecord) => number): Coordinate {
  let total = 0;
  let lat = 0;
  let lng = 0;

  samples.forEach(sample => {
    const weight = Math.max(0.0001, score(sample));
    total += weight;
    lat += sample.latitude * weight;
    lng += sample.longitude * weight;
  });

  if (total === 0) {
    const fallback = samples[0];
    return fallback ? { lat: fallback.latitude, lng: fallback.longitude } : { lat: 41.7767, lng: -87.6110 };
  }

  return {
    lat: lat / total,
    lng: lng / total,
  };
}

function buildFeatureNormalizers(samples: SpatialFeatureRecord[]) {
  const nsi = normalize(samples.map(s => s.NSI));
  const sai = normalize(samples.map(s => s.SAI));
  const sei = normalize(samples.map(s => s.SEI));
  const gei = normalize(samples.map(s => s.GEI));
  const vdi = normalize(samples.map(s => s.VDI));
  const wi = normalize(samples.map(s => s.WI));
  const ti = normalize(samples.map(s => s.TI));
  const tci = normalize(samples.map(s => s.TCI));
  const di = normalize(samples.map(s => s.DI));

  return {
    nsi,
    sai,
    sei,
    gei,
    vdi,
    wi,
    ti,
    tci,
    di,
    invSei: (value: number) => 1 - sei(value),
    invVdi: (value: number) => 1 - vdi(value),
    invDi: (value: number) => 1 - di(value),
  };
}

function mapIndicatorValue(samples: SpatialFeatureRecord[], key: (typeof INDICATOR_KEYS)[number]): { value: number; lat: number; lng: number } {
  const norm = buildFeatureNormalizers(samples);

  // Map each indicator key to the raw spatial feature and compute its average
  const featureKey: keyof SpatialFeatureRecord = {
    NSI: 'NSI', SAI: 'SAI', SEI: 'SEI', GEI: 'GEI',
    VDI: 'VDI', WI: 'WI', TI: 'TI', TCI: 'TCI', DI: 'DI',
  }[key] as keyof SpatialFeatureRecord;

  const rawValues = samples.map(s => {
    const raw = s[featureKey] as number;
    return raw;
  });

  // Use normalized average scaled to 0-100
  const normFunc = norm[key.toLowerCase() as keyof typeof norm] as (v: number) => number;
  const scores = rawValues.map(v => (typeof normFunc === 'function') ? normFunc(v) : 0);
  const average = scores.reduce((sum, v) => sum + v, 0) / Math.max(scores.length, 1);
  const scaled = Math.round(average * 100);

  // Weighted centroid based on spatial presence
  const weightedPoint = weightedCentroid(samples, (s) => {
    const raw = s[featureKey] as number;
    return (typeof normFunc === 'function') ? normFunc(raw) : 0;
  });

  return { value: scaled, lat: weightedPoint.lat, lng: weightedPoint.lng };
}

export function buildEnvironmentalIndicesFromSamples(samples: SpatialFeatureRecord[]): EnvironmentalIndex[] {
  if (samples.length === 0) {
    return [];
  }

  return INDICATOR_KEYS.map(key => {
    const mapped = mapIndicatorValue(samples, key);
    const meta = INDICATOR_META[key];
    return {
      key,
      name: meta.name,
      value: mapped.value,
      description: meta.description,
      category: meta.category,
      lat: mapped.lat,
      lng: mapped.lng,
    };
  });
}

/**
 * Build a risk adjustment factor from the 9 environmental indicators.
 * Returns a coefficient in [0.5, 1.5] applied per-heatmap-cell.
 */
export function buildIndicatorRiskFactor(indices: EnvironmentalIndex[]): number {
  if (indices.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const idx of indices) {
    const meta = INDICATOR_META[idx.key as (typeof INDICATOR_KEYS)[number]];
    if (!meta) continue;
    const weight = 1.0;
    // Positive indicators (higher = safer) reduce risk, negative (higher = worse) increase risk
    const normalized = idx.value / 100;
    const contribution = meta.direction === 'positive' ? (1 - normalized) : normalized;
    weightedSum += contribution * weight;
    totalWeight += weight;
  }

  const avg = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  return Math.max(0.4, Math.min(1.6, 0.5 + avg));
}

export function load4207DatasetFromRaw(samplesCsv: string, weightsCsv: string): Tract4207Dataset {
  return {
    samples: parseSpatialSamplesCsv(samplesCsv),
    featureWeights: parseSpatialFeatureWeightsCsv(weightsCsv),
  };
}

export function getSpatialWeightByKeyword(weights: SpatialFeatureWeight[], keyword: string): number {
  const match = weights.find(item => item.indicator.toLowerCase().includes(keyword.toLowerCase()));
  return match?.importanceScore ?? 0;
}

export function getDirectionalWeight(weights: SpatialFeatureWeight[], keyword: string): number {
  const weight = getSpatialWeightByKeyword(weights, keyword);
  const match = weights.find(item => item.indicator.toLowerCase().includes(keyword.toLowerCase()));
  if (!match) return 0;
  return match.direction === 'negative_association' ? -weight : weight;
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Building, Tree, Streetlight, HeatmapCell, Agent,
  SimulationParams, WeightConfig, SimulationStats, EnvironmentalIndex,
  Coordinate,
} from '../types';
import {
  spawnAgents, updateAgents, generateHeatmap, calculateStats,
  getFlowRateAtHour,
} from '../utils/simulation';
import { useLanguage } from '../i18n';
import {
  FileText, Loader2, TrendingUp, AlertTriangle, Lightbulb,
  Sparkles, MapPin, ShieldAlert, Clock,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */
interface HourlySample {
  hour: number;
  stats: SimulationStats;
  hotCells: HeatmapCell[];
  agentCounts: { residents: number; criminals: number };
  brokenLights: number;
  totalLights: number;
}

interface DangerCluster {
  gridKey: string;
  centerX: number;
  centerY: number;
  lat: number;
  lng: number;
  maxRisk: number;
  avgIllumination: number;
  avgBystander: number;
  avgCriminal: number;
  hitHours: number[];
  hitCount: number;
}

interface Suggestion {
  icon: 'light' | 'tree' | 'criminal' | 'bystander' | 'general';
  title: string;
  description: string;
  param: string;
  direction: 'up' | 'down';
  severity: 'high' | 'medium' | 'low';
  currentValue: string;
  recommendedValue: string;
}

interface ReportData {
  samples: HourlySample[];
  clusters: DangerCluster[];
  suggestions: Suggestion[];
  avgSafetyScore: number;
  peakRisk: number;
  worstHour: number;
  safestHour: number;
  isNightDangerous: boolean;
  overallVerdict: string;
}

/* ── Props ─────────────────────────────────────────────── */
interface ReportGeneratorProps {
  open: boolean;
  onClose: () => void;
  buildings: Building[];
  streetlights: Streetlight[];
  trees: Tree[];
  params: SimulationParams;
  weights: WeightConfig[];
  environmentalIndices: EnvironmentalIndex[];
  tractCoords: Coordinate[];
  tractBbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

const SIM_W = 840; const SIM_H = 600;
const TICK_MINUTES = 15;
const SAMPLE_EVERY = 4;
const TOTAL_TICKS = 24 * 4;

/* ── Helpers ─────────────────────────────────────────────── */
function pixelToLatLng(px: number, py: number, bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }) {
  const lng = bbox.minLng + (px / SIM_W) * (bbox.maxLng - bbox.minLng);
  const lat = bbox.maxLat - (py / SIM_H) * (bbox.maxLat - bbox.minLat);
  return { lat, lng };
}

function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function brokenLightsAvg(samples: HourlySample[]): number {
  let sum = 0, count = 0;
  for (const s of samples) {
    if (s.totalLights > 0) { sum += s.brokenLights / s.totalLights; count++; }
  }
  return count > 0 ? sum / count : 0;
}

/* ── Component ─────────────────────────────────────────── */
export default function ReportGenerator({
  open, onClose, buildings, streetlights, trees, params, weights, environmentalIndices,
  tractCoords, tractBbox,
}: ReportGeneratorProps) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const runningRef = useRef(false);

  const runSimulation = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setProgress(0);
    setProgressLabel(t('report.runningInit'));

    const samples: HourlySample[] = [];
    const cellAccum = new Map<string, { risks: number[]; illuminations: number[]; bystanders: number[]; criminals: number[]; hours: number[] }>();

    // Initial spawn
    let agents: Agent[] = spawnAgents(
      SIM_W, SIM_H,
      { ...params, simHour: 0, spawnRate: 1.2 },
      [], tractCoords, tractBbox, buildings,
    );

    await new Promise(r => setTimeout(r, 20));
    setProgress(2);
    setProgressLabel(t('report.runningPatrol'));

    // Tick loop: 0..95
    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
      const hour = (tick * TICK_MINUTES) / 60;
      const hourF = hour % 24;
      const isNight = hourF >= 20 || hourF <= 5;
      const crowdMul = getFlowRateAtHour(hourF);

      const tickParams: SimulationParams = {
        ...params,
        simHour: hourF,
        spawnRate: 0.8 + crowdMul * 0.4,
        criminalRatio: Math.max(0.05, params.criminalRatio * (isNight ? 1.6 : 0.55)),
      };

      agents = spawnAgents(SIM_W, SIM_H, tickParams, agents, tractCoords, tractBbox, buildings);
      agents = updateAgents(agents, buildings, 1.0);

      if (tick % SAMPLE_EVERY === 0) {
        const sampleHour = Math.round(hourF);
        const hmap = generateHeatmap(SIM_W, SIM_H, 12, buildings, streetlights, trees, agents, weights,
          hourF, tractCoords, tractBbox, environmentalIndices);
        const stats = calculateStats(hmap, streetlights, agents);
        const hotCells = hmap.filter(c => c.risk >= 0.35);

        samples.push({
          hour: sampleHour, stats, hotCells,
          agentCounts: {
            residents: agents.filter(a => a.active && a.type === 'resident').length,
            criminals: agents.filter(a => a.active && a.type === 'criminal').length,
          },
          brokenLights: streetlights.filter(l => l.isBroken).length,
          totalLights: streetlights.length,
        });

        for (const cell of hotCells) {
          const key = `${Math.round(cell.x / 24)},${Math.round(cell.y / 24)}`;
          const e = cellAccum.get(key) || { risks: [], illuminations: [], bystanders: [], criminals: [], hours: [] };
          e.risks.push(cell.risk);
          e.illuminations.push(cell.illumination);
          e.bystanders.push(cell.bystanderEyes);
          e.criminals.push(cell.criminalEyes);
          e.hours.push(sampleHour);
          cellAccum.set(key, e);
        }
      }

      const pct = Math.round(((tick + 1) / TOTAL_TICKS) * 100);
      setProgress(pct);
      const hh = String(Math.floor(hourF)).padStart(2, '0');
      setProgressLabel(t('report.runningActive', { hh, count: agents.filter(a => a.active).length }));
      await new Promise(r => setTimeout(r, 40));
    }

    /* ════ Analysis ════ */
    setProgress(96);
    setProgressLabel(t('report.runningAnalyze'));
    await new Promise(r => setTimeout(r, 100));

    const allRisks = samples.map(s => s.stats.averageRisk);
    const allScores = samples.map(s => s.stats.safetyScore);

    let worstHour = samples[0];
    let safestHour = samples[0];
    for (const s of samples) {
      if (s.stats.averageRisk > worstHour.stats.averageRisk) worstHour = s;
      if (s.stats.safetyScore > safestHour.stats.safetyScore) safestHour = s;
    }

    const avgSafetyScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
    const peakRisk = Math.max(...allRisks);

    const isNightDangerous = (() => {
      const nightScores = samples.filter(s => s.hour >= 20 || s.hour <= 5).map(s => s.stats.safetyScore);
      const dayScores = samples.filter(s => s.hour > 5 && s.hour < 20).map(s => s.stats.safetyScore);
      const nightAvg = nightScores.length ? nightScores.reduce((a, b) => a + b, 0) / nightScores.length : avgSafetyScore;
      const dayAvg = dayScores.length ? dayScores.reduce((a, b) => a + b, 0) / dayScores.length : avgSafetyScore;
      return nightAvg < dayAvg - 10;
    })();

    // Build danger clusters
    const clusters: DangerCluster[] = [];
    for (const [key, acc] of cellAccum) {
      if (acc.risks.length < 2) continue;
      const [sx, sy] = key.split(',').map(Number);
      const cx = sx * 24 + 12;
      const cy = sy * 24 + 12;
      const { lat, lng } = pixelToLatLng(cx, cy, tractBbox);
      clusters.push({
        gridKey: key, centerX: cx, centerY: cy, lat, lng,
        maxRisk: Math.max(...acc.risks),
        avgIllumination: acc.illuminations.reduce((a, b) => a + b, 0) / acc.illuminations.length,
        avgBystander: acc.bystanders.reduce((a, b) => a + b, 0) / acc.bystanders.length,
        avgCriminal: acc.criminals.reduce((a, b) => a + b, 0) / acc.criminals.length,
        hitHours: [...new Set(acc.hours)].sort((a, b) => a - b),
        hitCount: acc.risks.length,
      });
    }
    clusters.sort((a, b) => b.maxRisk - a.maxRisk);

    /* ════ Generate suggestions ════ */
    const suggestions: Suggestion[] = [];
    const topClusters = clusters.slice(0, 5);

    if (topClusters.length > 0) {
      const avgIllumTop = topClusters.reduce((s, c) => s + c.avgIllumination, 0) / topClusters.length;
      const avgBystTop = topClusters.reduce((s, c) => s + c.avgBystander, 0) / topClusters.length;
      const avgCrimTop = topClusters.reduce((s, c) => s + c.avgCriminal, 0) / topClusters.length;
      const nightHits = topClusters.reduce((s, c) => s + c.hitHours.filter(h => h >= 20 || h <= 5).length, 0);
      const totalHits = topClusters.reduce((s, c) => s + c.hitCount, 0);

      if (avgIllumTop < 0.40) {
        const targetDensity = Math.min(3.0, +(params.lightDensity + 0.4).toFixed(1));
        const reason = nightHits > totalHits * 0.6 ? t('report.sugLightingReason1') : t('report.sugLightingReason2');
        let failureNote = '';
        if (params.lightFailureRate > 20) {
          failureNote = t('report.sugWithFailure', { current: params.lightFailureRate.toString(), target: String(Math.max(5, params.lightFailureRate - 15)) });
        }
        suggestions.push({
          icon: 'light', title: t('report.sugLighting'),
          param: 'lightDensity', direction: 'up' as const, severity: 'high' as const,
          currentValue: `${params.lightDensity.toFixed(1)}x`,
          recommendedValue: `${targetDensity}x`,
          description: t('report.sugLightingDesc', {
            count: topClusters.length, illumPct: Math.round(avgIllumTop * 100),
            reason, current: params.lightDensity.toFixed(1), target: targetDensity.toString(), failureNote,
          }),
        });
      }

      if (params.lightFailureRate > 25 && avgIllumTop < 0.5) {
        suggestions.push({
          icon: 'light', title: t('report.sugFailureRate'),
          param: 'lightFailureRate', direction: 'down' as const, severity: 'medium' as const,
          currentValue: `${params.lightFailureRate}%`,
          recommendedValue: `${Math.max(0, params.lightFailureRate - 20)}%`,
          description: t('report.sugFailureRateDesc', {
            current: params.lightFailureRate.toString(),
            brokenPct: Math.round(brokenLightsAvg(samples) * 100),
          }),
        });
      }

      if (params.treeDensity > 35 && avgIllumTop < 0.45) {
        const targetTrees = Math.max(10, params.treeDensity - 15);
        suggestions.push({
          icon: 'tree', title: t('report.sugTree'),
          param: 'treeDensity', direction: 'down' as const, severity: 'medium' as const,
          currentValue: `${params.treeDensity}棵`,
          recommendedValue: `${targetTrees}棵`,
          description: t('report.sugTreeDesc', { current: params.treeDensity, target: targetTrees }),
        });
      }

      if (avgBystTop < 0.30) {
        suggestions.push({
          icon: 'bystander', title: t('report.sugBystander'),
          param: 'spawnRate', direction: 'up' as const, severity: 'high' as const,
          currentValue: `${params.spawnRate.toFixed(1)}x`,
          recommendedValue: `${Math.min(3.0, +(params.spawnRate + 0.4).toFixed(1))}x`,
          description: t('report.sugBystanderDesc', { bystPct: Math.round(avgBystTop * 100) }),
        });
      }

      if (avgCrimTop > 0.45 && peakRisk > 0.6) {
        const targetRatio = Math.max(0.05, +(params.criminalRatio * 0.7).toFixed(2));
        suggestions.push({
          icon: 'criminal', title: t('report.sugCriminal'),
          param: 'criminalRatio', direction: 'down' as const, severity: 'high' as const,
          currentValue: `${Math.round(params.criminalRatio * 100)}%`,
          recommendedValue: `${Math.round(targetRatio * 100)}%`,
          description: t('report.sugCriminalDesc', {
            crimPct: Math.round(avgCrimTop * 100),
            current: Math.round(params.criminalRatio * 100),
            target: Math.round(targetRatio * 100),
          }),
        });
      }
    }

    if (isNightDangerous && suggestions.length > 0) {
      let worstInfo = '';
      if (worstHour.hour >= 20 || worstHour.hour <= 5) {
        worstInfo = t('report.worstAt', {
          hour: String(worstHour.hour).padStart(2, '0'),
          risk: Math.round(worstHour.stats.averageRisk * 100),
        }) + '。';
      }
      suggestions.unshift({
        icon: 'general', title: t('report.sugNightRisk'),
        param: '', direction: 'up' as const, severity: 'high' as const,
        currentValue: '', recommendedValue: '',
        description: t('report.sugNightRiskDesc', { worstInfo }),
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        icon: 'general', title: t('report.sugNoIssues'),
        param: '', direction: 'up' as const, severity: 'low' as const,
        currentValue: '', recommendedValue: '',
        description: t('report.sugNoIssuesDesc', {
          avgScore: avgSafetyScore, peakRisk: Math.round(peakRisk * 100),
        }),
      });
    }

    const overallVerdict = avgSafetyScore >= 70 ? t('report.verdictSafe')
      : avgSafetyScore >= 50 ? t('report.verdictModerate')
      : t('report.verdictDangerous');

    setReport({
      samples, clusters: clusters.slice(0, 5), suggestions,
      avgSafetyScore, peakRisk,
      worstHour: worstHour.hour, safestHour: safestHour.hour,
      isNightDangerous, overallVerdict,
    });
    setProgress(100);
    setProgressLabel(t('report.runningDone'));
    setPhase('done');
    runningRef.current = false;
  }, [params, weights, buildings, streetlights, trees, environmentalIndices, tractCoords, tractBbox, t]);

  useEffect(() => {
    if (open && phase === 'idle') runSimulation();
    if (!open) { setPhase('idle'); setProgress(0); setReport(null); }
  }, [open]);

  if (!open) return null;

  /* ── Render helpers ────────────────────────────────────── */
  const sev = (s: 'high' | 'medium' | 'low') =>
    s === 'high' ? 'text-red-600 bg-red-50 border-red-200' :
    s === 'medium' ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-emerald-600 bg-emerald-50 border-emerald-200';

  const scoreColor = (s: number) => s >= 65 ? '#10b981' : s >= 45 ? '#f59e0b' : '#ef4444';

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto overscroll-contain"
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-5 py-4 rounded-t-2xl z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-neutral-900" />
            <span className="text-sm font-bold text-neutral-900">{t('report.title')}</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-lg leading-none">&times;</button>
        </div>

        {/* ── Running ── */}
        {phase === 'running' && (
          <div className="flex flex-col items-center gap-4 py-12 px-6">
            <Loader2 className="w-10 h-10 text-neutral-700 animate-spin" />
            <span className="text-sm font-mono text-neutral-700">{progressLabel}</span>
            <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
              <div className="h-full bg-neutral-900 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-mono text-neutral-500">{progress}%</span>
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && report && (
          <div className="px-5 py-4 flex flex-col gap-5 pb-6">

            {/* Overall verdict */}
            <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-200">
              <div className="text-xs font-mono text-neutral-500 uppercase tracking-wider mb-2">{t('report.verdict')}</div>
              <div className="text-sm font-bold mb-3" style={{ color: scoreColor(report.avgSafetyScore) }}>
                {report.overallVerdict}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-neutral-400">{t('report.avgScore')}</div>
                  <div className="text-2xl font-extrabold font-mono" style={{ color: scoreColor(report.avgSafetyScore) }}>{report.avgSafetyScore}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">{t('report.peakRisk')}</div>
                  <div className="text-2xl font-extrabold font-mono text-red-600">{(report.peakRisk * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">{t('report.worstHour')}</div>
                  <div className="text-lg font-extrabold font-mono text-red-600">{String(report.worstHour).padStart(2, '0')}:00</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">{t('report.safestHour')}</div>
                  <div className="text-lg font-extrabold font-mono text-emerald-600">{String(report.safestHour).padStart(2, '0')}:00</div>
                </div>
              </div>
              {report.isNightDangerous && (
                <div className="mt-3 text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> {t('report.nightWarning')}
                </div>
              )}
            </div>

            {/* 24H trend chart */}
            <div>
              <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider flex items-center gap-1 mb-2">
                <TrendingUp className="w-3.5 h-3.5" /> {t('report.trend')}
              </span>
              <div className="h-24 bg-neutral-50 border border-neutral-200 rounded-lg p-1.5">
                <svg viewBox="0 0 240 80" className="w-full h-full">
                  <line x1="0" y1="40" x2="240" y2="40" stroke="#e5e5e5" strokeWidth="0.5" strokeDasharray="4,4" />
                  <path d={report.samples.map((s, i) => {
                    const x = s.hour * 10;
                    const y = 75 - (s.stats.safetyScore / 100) * 60;
                    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                  }).join(' ')} fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
                  <path d={report.samples.map((s, i) => {
                    const x = s.hour * 10;
                    const y = 75 - (s.stats.averageRisk * 80);
                    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                  }).join(' ')} fill="none" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="3,2" strokeLinecap="round" />
                  <text x="2" y="78" fill="#a3a3a3" fontSize="6" fontFamily="monospace">0</text>
                  <text x="110" y="78" fill="#a3a3a3" fontSize="6" fontFamily="monospace">12</text>
                  <text x="226" y="78" fill="#a3a3a3" fontSize="6" fontFamily="monospace">24</text>
                </svg>
              </div>
              <div className="flex items-center gap-4 mt-1 text-[9px] font-mono text-neutral-500 px-1">
                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-emerald-500 inline-block"></span> {t('report.safetyScore')}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-red-500 inline-block" style={{ borderTop: '1px dashed red' }}></span> {t('report.riskLevel')}</span>
              </div>
            </div>

            {/* Danger clusters */}
            {report.clusters.length > 0 && (
              <div>
                <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider flex items-center gap-1 mb-2">
                  <MapPin className="w-3.5 h-3.5 text-red-500" /> {t('report.dangerZones', { count: report.clusters.length })}
                </span>
                <div className="flex flex-col gap-2">
                  {report.clusters.map((c, i) => (
                    <div key={i} className={`p-3 rounded-lg border ${c.maxRisk > 0.65 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold font-mono">
                          {formatLatLng(c.lat, c.lng)}
                          <span className="text-neutral-400 ml-1">{c.hitCount} hits · {c.hitHours.length}h</span>
                        </span>
                        <span className="text-xs font-extrabold font-mono" style={{ color: c.maxRisk > 0.65 ? '#dc2626' : '#d97706' }}>
                          {(c.maxRisk * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[10px] text-neutral-600">
                        <div><span className="text-neutral-400">{t('report.light')}</span> <span className="font-bold" style={{ color: c.avgIllumination < 0.35 ? '#dc2626' : '#10b981' }}>{(c.avgIllumination * 100).toFixed(0)}%</span></div>
                        <div><span className="text-neutral-400">{t('report.surveillance')}</span> <span className="font-bold" style={{ color: c.avgBystander < 0.3 ? '#dc2626' : '#10b981' }}>{(c.avgBystander * 100).toFixed(0)}%</span></div>
                        <div><span className="text-neutral-400">{t('report.blindSpot')}</span> <span className="font-bold" style={{ color: c.avgCriminal > 0.5 ? '#dc2626' : '#10b981' }}>{(c.avgCriminal * 100).toFixed(0)}%</span></div>
                      </div>
                      <div className="mt-1.5 text-[9px] text-neutral-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t('report.active')}{c.hitHours.slice(0, 8).map(h => `${h}:00`).join(', ')}{c.hitHours.length > 8 ? '...' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            <div>
              <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider flex items-center gap-1 mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> {t('report.suggestions')}
              </span>
              <div className="flex flex-col gap-2">
                {report.suggestions.map((sug, i) => (
                  <div key={i} className={`p-3 rounded-lg border ${sev(sug.severity)}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {sug.icon === 'light' && <Lightbulb className="w-4 h-4" />}
                      {sug.icon === 'tree' && <Sparkles className="w-4 h-4" />}
                      {sug.icon === 'criminal' && <AlertTriangle className="w-4 h-4" />}
                      {sug.icon === 'bystander' && <ShieldAlert className="w-4 h-4" />}
                      {sug.icon === 'general' && <ShieldAlert className="w-4 h-4" />}
                      <span className="text-xs font-bold">{sug.title}</span>
                      {sug.param && (
                        <span className={`ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded border font-bold ${
                          sug.direction === 'up' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'
                        }`}>
                          {sug.currentValue} → {sug.recommendedValue}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] leading-relaxed opacity-85">{sug.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 pt-2 border-t border-neutral-200">
              <button onClick={runSimulation}
                className="flex-1 py-2.5 rounded-xl bg-neutral-900 text-white text-xs font-bold active:scale-95 transition-transform">
                {t('report.reRun')}
              </button>
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl bg-neutral-100 border border-neutral-300 text-neutral-700 text-xs font-bold active:scale-95 transition-transform">
                {t('report.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import {
  SimulationParams, SimulationStats, Streetlight, WeightConfig,
  EnvironmentalIndex} from '../types';
import { Tract4207Dataset } from '../utils/tract4207Data';
import { ZONING_CONFIG, ZONE_CLASS_KEYS, ZoneConfigEntry } from '../constants/zoningConfig';
import { getFlowRateAtHour } from '../utils/simulation';
import { useLanguage } from '../i18n';
import {
  Activity, Play, Pause, RefreshCw,
} from 'lucide-react';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onToggle: () => void;
  params: SimulationParams;
  onChangeParams: (p: Partial<SimulationParams>) => void;
  weights: WeightConfig[];
  stats: SimulationStats;
  streetlights: Streetlight[];
  isPlaying: boolean;
  onTogglePlay: () => void;
  onResetParams: () => void;
  environmentalIndices: EnvironmentalIndex[];
  zoneParams: Record<string, ZoneConfigEntry>;
  onChangeZoneParam: (zc: string, u: Partial<ZoneConfigEntry>) => void;
  activeZoneClass: string;
  onSelectZoneClass: (zc: string) => void;
  localModelLoaded: boolean;
  localModelLineCount: number;
}

type TabId = 'stats' | 'zoning' | 'agent' | 'layers';

function getSafetyVerdict(score: number, t: (k: string) => string) {
  if (score >= 75) return { color: '#10b981', bg: '#ecfdf5', label: t('mobile.safetyHigh') };
  if (score >= 45) return { color: '#f59e0b', bg: '#fffbeb', label: t('mobile.safetyMed') };
  return { color: '#ef4444', bg: '#fef2f2', label: t('mobile.safetyLow') };
}

function MiniGauge({ score }: { score: number }) {
  const color = score >= 75 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="41" fill="none" stroke="#f3f4f6" strokeWidth="8" />
        <circle cx="50" cy="50" r="41" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray="257.6" strokeDashoffset={257.6 - (257.6 * score) / 100}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-extrabold font-mono text-neutral-900">{score}</span>
      </div>
    </div>
  );
}

/* ── Stats Tab ───────────────────────────────────────────── */
function StatsTab({ stats, streetlights, weights }: {
  stats: SimulationStats; streetlights: Streetlight[]; weights: WeightConfig[];
}) {
  const { t } = useLanguage();
  const v = getSafetyVerdict(stats.safetyScore, t);
  const activeLights = streetlights.filter(l => l.status === 'on' && !l.isBroken).length;
  const lightPct = streetlights.length > 0 ? Math.round((activeLights / streetlights.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200" style={{ background: v.bg }}>
        <MiniGauge score={stats.safetyScore} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-bold text-neutral-900">{t('mobile.safetyScore')}</span>
          <span className="text-[11px] font-medium" style={{ color: v.color }}>{v.label}{t('mobile.riskLevel')}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-neutral-50 rounded-lg p-2.5 text-center border border-neutral-200">
          <div className="text-lg font-extrabold font-mono text-red-600">{(stats.averageRisk * 100).toFixed(0)}%</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">{t('mobile.avgRisk')}</div>
        </div>
        <div className="bg-neutral-50 rounded-lg p-2.5 text-center border border-neutral-200">
          <div className="text-lg font-extrabold font-mono text-neutral-900">{stats.activeResidents}/{stats.activeCriminals}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">{t('mobile.agents')}</div>
        </div>
        <div className="bg-neutral-50 rounded-lg p-2.5 text-center border border-neutral-200">
          <div className="text-lg font-extrabold font-mono text-emerald-600">{lightPct}%</div>
          <div className="text-[10px] text-neutral-400 mt-0.5">{t('mobile.lights')}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">{t('mobile.riskFactor')}</span>
        {weights.map(w => {
          const pct = Math.round((Math.abs(w.weight) / weights.reduce((s, x) => s + Math.abs(x.weight), 0.1)) * 100);
          const shortName = t(`weightsMeta.${w.key}.short`);
          return (
            <div key={w.key} className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-600 w-20 truncate">{shortName}</span>
              <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-neutral-800" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-neutral-500 w-8 text-right">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Zoning Tab ──────────────────────────────────────────── */
function ZoningTab({
  zoneParams, activeZoneClass, onSelectZoneClass, onChangeZoneParam
}: {
  zoneParams: Record<string, ZoneConfigEntry>;
  activeZoneClass: string;
  onSelectZoneClass: (zc: string) => void;
  onChangeZoneParam: (zc: string, u: Partial<ZoneConfigEntry>) => void;
}) {
  const { t } = useLanguage();
  const active = zoneParams[activeZoneClass] || ZONING_CONFIG[activeZoneClass];
  if (!active) return <div className="p-4 text-xs text-neutral-400">{t('mobile.noConfig')}</div>;
  const upd = (u: Partial<ZoneConfigEntry>) => onChangeZoneParam(activeZoneClass, u);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap gap-1">
        {ZONE_CLASS_KEYS.map(zc => (
          <button key={zc} onClick={() => onSelectZoneClass(zc)}
            className={`px-2 py-1 rounded text-[10px] font-mono font-semibold transition-all border ${
              zc === activeZoneClass ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-neutral-100 text-neutral-500 border-transparent'
            }`}>{zc}</button>
        ))}
      </div>
      {[
        { label: t('mobile.zoningLabels.far'), value: active.max_far_raw.toFixed(1), min: 0, max: 10, step: 0.1, key: 'max_far_raw' as const, desc: active.max_far_desc },
        { label: t('mobile.zoningLabels.height'), value: `${active.max_height_raw}ft`, min: 20, max: 120, step: 1, key: 'max_height_raw' as const, desc: active.max_height_desc },
        { label: t('mobile.zoningLabels.lotArea'), value: `${active.min_lot_area_raw}`, min: 0, max: 10000, step: 100, key: 'min_lot_area_raw' as const, desc: active.min_lot_area_desc },
        { label: t('mobile.zoningLabels.setback'), value: `${active.front_setback_raw}ft`, min: 5, max: 50, step: 1, key: 'front_setback_raw' as const, desc: active.front_setback_desc },
        { label: t('mobile.zoningLabels.parking'), value: active.parking_requirement_num.toFixed(1), min: 0, max: 50, step: 0.5, key: 'parking_requirement_num' as const, desc: active.parking_req_desc },
      ].map(s => (
        <div key={s.key} className="flex flex-col gap-1 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-neutral-700">{s.label}</span>
            <span className="text-[10px] font-bold font-mono bg-white px-1.5 py-0.5 rounded border border-neutral-200">{s.value}</span>
          </div>
          <input type="range" min={s.min} max={s.max} step={s.step}
            value={(active as any)[s.key]}
            onChange={e => upd({ [s.key]: s.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value) })}
            className="w-full accent-neutral-900 h-1 rounded" />
          <span className="text-[9px] text-neutral-400">{s.desc}</span>
        </div>
      ))}
      <div className="flex flex-col gap-1 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
        <span className="text-[10px] font-mono text-neutral-400 uppercase">{t('mobile.usePerms')}</span>
        {[
          { key: 'residential_use_allowed' as const, on: t('mobile.yesRes'), off: t('mobile.noRes') },
          { key: 'commercial_use_allowed' as const, on: t('mobile.yesCom'), off: t('mobile.noCom') },
          { key: 'residential_mixed' as const, on: t('mobile.yesMixed'), off: t('mobile.noMixed') },
        ].map(c => (
          <label key={c.key} className="flex items-center justify-between cursor-pointer py-0.5 text-[10px] font-mono">
            <span>{active[c.key] ? c.on : c.off}</span>
            <input type="checkbox" checked={active[c.key]} onChange={e => upd({ [c.key]: e.target.checked })} className="w-3.5 h-3.5 accent-neutral-900 rounded" />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
        <span className="text-[10px] font-mono text-neutral-400 uppercase">{t('mobile.siteDesign')}</span>
        {[
          { key: 'landscaping_required' as const, on: t('mobile.yesGreen'), off: t('mobile.noGreen') },
          { key: 'buffer_required' as const, on: t('mobile.yesBuffer'), off: t('mobile.noBuffer') },
          { key: 'non_accessory_parking_allowed' as const, on: t('mobile.yesParking'), off: t('mobile.noParking') },
        ].map(c => (
          <label key={c.key} className="flex items-center justify-between cursor-pointer py-0.5 text-[10px] font-mono">
            <span>{active[c.key] ? c.on : c.off}</span>
            <input type="checkbox" checked={active[c.key]} onChange={e => upd({ [c.key]: e.target.checked })} className="w-3.5 h-3.5 accent-neutral-900 rounded" />
          </label>
        ))}
      </div>
    </div>
  );
}

/* ── Agent Tab ───────────────────────────────────────────── */
function AgentTab({ isPlaying, onTogglePlay, onResetParams, params, onChangeParams }: {
  isPlaying: boolean; onTogglePlay: () => void; onResetParams: () => void;
  params: SimulationParams; onChangeParams: (p: Partial<SimulationParams>) => void;
}) {
  const { t } = useLanguage();
  const displayHour = Math.floor(params.simHour);
  const displayMinute = Math.round((params.simHour - displayHour) * 60);
  const formattedTime = `${displayHour.toString().padStart(2, '0')}:${displayMinute.toString().padStart(2, '0')}`;
  const points: { hour: number; rate: number }[] = [];
  for (let h = 0; h < 24; h++) points.push({ hour: h, rate: getFlowRateAtHour(h) });
  const maxRate = Math.max(...points.map(p => p.rate), 0.1);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex gap-2">
        <button onClick={onTogglePlay}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm border transition-all ${
            isPlaying ? 'bg-neutral-100 border-neutral-300 text-neutral-800' : 'bg-neutral-900 text-white border-transparent'
          }`}>
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          {isPlaying ? t('mobile.pause') : t('mobile.start')}
        </button>
        <button onClick={onResetParams} className="px-3 py-2.5 rounded-xl border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 transition-all">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <div className="relative h-16 bg-white border border-neutral-200 rounded-lg p-1 overflow-hidden">
        <svg viewBox="0 0 240 60" className="w-full h-full">
          <path d={`M 0 50 ${points.map(p => `L ${p.hour * 10} ${50 - (p.rate / maxRate) * 40}`).join(' ')} L 240 50 Z`} fill="rgba(16,185,129,0.08)" />
          <path d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.hour * 10} ${50 - (p.rate / maxRate) * 40}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="1.8" />
          <line x1={params.simHour * 10} y1="2" x2={params.simHour * 10} y2="58" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="2,2" />
        </svg>
      </div>
      <div className="flex flex-col gap-1 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-mono text-neutral-700">{t('mobile.simClock')}</span>
          <span className="text-[10px] font-bold font-mono bg-white px-1.5 py-0.5 rounded border border-neutral-200">{formattedTime}</span>
        </div>
        <input type="range" min="0" max="23.95" step="0.05" value={params.simHour}
          onChange={e => onChangeParams({ simHour: parseFloat(e.target.value) })} className="w-full accent-neutral-900 h-1 rounded" />
      </div>
      <div className="flex flex-col gap-1 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-mono text-neutral-700">{t('mobile.spawnRate')}</span>
          <span className="text-[10px] font-bold font-mono bg-white px-1.5 py-0.5 rounded border border-neutral-200">{params.spawnRate.toFixed(1)}x</span>
        </div>
        <input type="range" min="0.2" max="3.0" step="0.1" value={params.spawnRate}
          onChange={e => onChangeParams({ spawnRate: parseFloat(e.target.value) })} className="w-full accent-neutral-900 h-1 rounded" />
      </div>
      <div className="flex flex-col gap-1 bg-red-50/50 p-2.5 rounded-lg border border-red-100">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-mono text-red-700 font-bold">{t('mobile.criminalRatio')}</span>
          <span className="text-[10px] font-bold font-mono bg-white px-1.5 py-0.5 rounded border border-red-200 text-red-600">{Math.round(params.criminalRatio * 100)}%</span>
        </div>
        <input type="range" min="0.0" max="0.5" step="0.05" value={params.criminalRatio}
          onChange={e => onChangeParams({ criminalRatio: parseFloat(e.target.value) })} className="w-full accent-red-600 h-1 rounded" />
      </div>
    </div>
  );
}

/* ── Layers Tab ──────────────────────────────────────────── */
function LayersTab({ params, onChangeParams }: {
  params: SimulationParams; onChangeParams: (p: Partial<SimulationParams>) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {[
        { key: 'showPastCrimes', label: t('mobile.layers.pastCrimes') },
        { key: 'showHeatmap', label: t('mobile.layers.heatmap') },
        { key: 'showVisionCones', label: t('mobile.layers.visionCones') },
        { key: 'showEnvironmentalIndices', label: t('mobile.layers.envIndices') },
      ].map(c => (
        <label key={c.key} className="flex items-center justify-between cursor-pointer py-2.5 px-3 bg-neutral-50 rounded-lg border border-neutral-200 active:bg-neutral-100 transition-colors">
          <span className="text-sm text-neutral-800">{c.label}</span>
          <input type="checkbox" checked={(params as any)[c.key]} onChange={e => onChangeParams({ [c.key]: e.target.checked })} className="w-5 h-5 accent-neutral-900 rounded" />
        </label>
      ))}
      {params.showHeatmap && (
        <div className="flex flex-col gap-1 bg-neutral-50 p-3 rounded-lg border border-neutral-200 mt-1">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-neutral-600">{t('mobile.layers.heatmapOpacity')}</span>
            <span className="text-[10px] font-mono font-bold">{(params.heatmapOpacity * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min="0.1" max="0.9" step="0.05" value={params.heatmapOpacity}
            onChange={e => onChangeParams({ heatmapOpacity: parseFloat(e.target.value) })} className="w-full accent-neutral-900 h-1 rounded" />
        </div>
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */
export default function MobileBottomSheet({
  isOpen, onToggle, params, onChangeParams, weights, stats, streetlights,
  isPlaying, onTogglePlay, onResetParams, environmentalIndices,
  zoneParams, onChangeZoneParam, activeZoneClass, onSelectZoneClass,
  localModelLoaded, localModelLineCount,
}: MobileBottomSheetProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabId>('stats');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'stats', label: t('mobile.tabs.stats') },
    { id: 'zoning', label: t('mobile.tabs.zoning') },
    { id: 'agent', label: t('mobile.tabs.agent') },
    { id: 'layers', label: t('mobile.tabs.layers') },
  ];

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-[500] bg-black/20" onClick={onToggle}
          style={{ pointerEvents: isOpen ? 'auto' : 'none' }} />
      )}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[510] bg-white rounded-t-2xl shadow-2xl flex flex-col
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ maxHeight: '40vh', height: 'auto' }}
      >
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 bg-neutral-300 rounded-full" />
        </div>
        <div className="flex border-b border-neutral-200 shrink-0">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-all ${
                activeTab === tab.id ? 'text-neutral-900 border-b-2 border-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {activeTab === 'stats' && <StatsTab stats={stats} streetlights={streetlights} weights={weights} />}
          {activeTab === 'zoning' && <ZoningTab zoneParams={zoneParams} activeZoneClass={activeZoneClass} onSelectZoneClass={onSelectZoneClass} onChangeZoneParam={onChangeZoneParam} />}
          {activeTab === 'agent' && <AgentTab isPlaying={isPlaying} onTogglePlay={onTogglePlay} onResetParams={onResetParams} params={params} onChangeParams={onChangeParams} />}
          {activeTab === 'layers' && <LayersTab params={params} onChangeParams={onChangeParams} />}
        </div>
      </div>
    </>
  );
}

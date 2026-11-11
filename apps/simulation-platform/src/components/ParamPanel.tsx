import React from 'react';
import { SimulationParams, WeightConfig, SimulationStats, Streetlight, EnvironmentalIndex } from '../types';
import { Tract4207Dataset } from '../utils/tract4207Data';
import { getFlowRateAtHour } from '../utils/simulation';
import { ZONING_CONFIG, ZONE_CLASS_KEYS, ZoneConfigEntry, resolveZoneClass } from '../constants/zoningConfig';
import { 
  Building2, Sun, Users, Settings2, Sliders, 
  HelpCircle, RefreshCw, BarChart2, AlertCircle, Sparkles, SlidersHorizontal,
  Shield, Play, Pause
} from 'lucide-react';
import DataStats from './DataStats';
import { useLanguage } from '../i18n';

function getIndexColorClass(key: string, value: number): string {
  // Indicators where higher values increase risk (negative direction)
  const negativeIndicators = ['SEI', 'GEI', 'VDI', 'DI'];
  const isNegative = negativeIndicators.includes(key);

  if (isNegative) {
    // High = bad (red), Low = good (green)
    return value > 60 ? 'text-red-600 bg-red-50 border-red-200' : value > 35 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-emerald-600 bg-emerald-50 border-emerald-200';
  }
  // Positive indicators: High = good (green), Low = bad (red)
  return value > 60 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : value > 35 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
}

interface ParamPanelProps {
  params: SimulationParams;
  onChangeParams: (params: Partial<SimulationParams>) => void;
  weights: WeightConfig[];
  onChangeWeights: (weights: WeightConfig[]) => void;
  onResetParams: () => void;

  // Real-time HUD assessment variables
  stats: SimulationStats;
  streetlights: Streetlight[];
  isPlaying: boolean;
  onTogglePlay: () => void;

  // 9 Environmental Indices
  environmentalIndices: EnvironmentalIndex[];
  onChangeIndices: (indices: EnvironmentalIndex[]) => void;
  tract4207Dataset?: Tract4207Dataset | null;

  // Zoning state
  zoneParams: Record<string, ZoneConfigEntry>;
  onChangeZoneParam: (zoneClass: string, updates: Partial<ZoneConfigEntry>) => void;
  activeZoneClass: string;
  onSelectZoneClass: (zoneClass: string) => void;
  localModelLoaded: boolean;
  localModelLineCount: number;
}

export default function ParamPanel({
  params,
  onChangeParams,
  weights,
  onChangeWeights,
  onResetParams,
  stats,
  streetlights,
  isPlaying,
  onTogglePlay,
  environmentalIndices = [],
  onChangeIndices,
  tract4207Dataset,
  zoneParams,
  onChangeZoneParam,
  activeZoneClass,
  onSelectZoneClass,
  localModelLoaded,
  localModelLineCount,
}: ParamPanelProps) {
  const { t } = useLanguage();

  const getLocalizedWeightName = (weight: WeightConfig) => {
    const translated = t(`weightsMeta.${weight.key}.name`);
    return translated === `weightsMeta.${weight.key}.name` ? weight.name : translated;
  };

  const getLocalizedWeightDescription = (weight: WeightConfig) => {
    const translated = t(`weightsMeta.${weight.key}.description`);
    return translated === `weightsMeta.${weight.key}.description` ? weight.description : translated;
  };

  const getLocalizedIndexName = (idx: EnvironmentalIndex) => {
    const translated = t(`indicesMeta.${idx.key}.name`);
    const fallback = idx.name.split(' (')[0];
    return translated === `indicesMeta.${idx.key}.name` ? fallback : translated;
  };

  const getLocalizedIndexDescription = (idx: EnvironmentalIndex) => {
    const translated = t(`indicesMeta.${idx.key}.description`);
    return translated === `indicesMeta.${idx.key}.description` ? idx.description : translated;
  };

  const handleWeightSliderChange = (key: string, val: number) => {
    const newWeights = weights.map(w => {
      if (w.key === key) {
        return { ...w, weight: val };
      }
      return w;
    });
    onChangeWeights(newWeights);
  };

  // Group CHICAGO_TRACTS by neighborhood (kept for reference)

  // Generate GAMA ABM simulation crowd flow profile points for visual chart
  const gamaChartPoints: { hour: number; rate: number }[] = [];
  for (let h = 0; h < 24; h++) {
    gamaChartPoints.push({
      hour: h,
      rate: getFlowRateAtHour(h)
    });
  }
  const maxRate = Math.max(...gamaChartPoints.map(p => p.rate), 0.1);
  const displayHour = Math.floor(params.simHour);
  const displayMinute = Math.round((params.simHour - displayHour) * 60);
  const formattedSimTime = `${displayHour.toString().padStart(2, '0')}:${displayMinute.toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-5 w-full bg-white text-neutral-800 font-sans p-5 md:p-6 md:pt-8" id="parameters-sidebar-panel">
      
      {/* Global Platform Title (Moved here from App.tsx as requested) */}
      <div className="flex flex-col gap-1.5 border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5.5 h-5.5 text-neutral-900 shrink-0" />
          <h1 className="text-sm md:text-base font-extrabold font-sans tracking-wide text-neutral-950 uppercase leading-snug">
            {t('app.title')}
          </h1>
        </div>
        <p className="text-[9px] text-neutral-500 font-mono tracking-wider leading-relaxed uppercase">
          {t('app.subtitle')}
        </p>
      </div>

      {/* Simulation Controls & Engine Status */}
      <div className="flex flex-col gap-2 bg-neutral-50 border border-neutral-200 p-3 rounded-lg text-xs font-mono shadow-inner">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-500 font-bold">{t('engine.status')}:</span>
            <span className="flex items-center gap-1 font-bold text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {t('engine.active')}
            </span>
          </div>
          <span className="text-[10px] text-neutral-400">{t('engine.fps')}</span>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            onClick={onTogglePlay}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md font-bold cursor-pointer transition-all duration-300 border text-[10px] uppercase shadow-sm ${
              isPlaying 
                ? 'bg-neutral-100 border-neutral-300 text-neutral-800 hover:bg-neutral-200' 
                : 'bg-neutral-900 text-white border-transparent hover:bg-neutral-800'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" /> {t('engine.pause')}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> {t('engine.start')}
              </>
            )}
          </button>
          
          <button
            onClick={onResetParams}
            className="flex items-center justify-center gap-1.5 text-[10px] font-mono border border-neutral-300 hover:border-neutral-800 px-3 py-2 bg-white hover:bg-neutral-100 rounded-md text-neutral-600 hover:text-neutral-900 transition-all cursor-pointer font-bold shadow-sm"
            title="Reset all settings"
            id="btn-reset-params"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {t('engine.reset')}
          </button>
        </div>
      </div>

      {/* Real-time Assessment results integrated right inside control panel */}
      <div className="flex flex-col gap-2 border-b border-neutral-200 pb-4">
        <DataStats
          stats={stats}
          streetlights={streetlights}
          weights={weights}
          params={params}
        />
      </div>

      {/* PARAM 1: BUILDING URBAN FORMS — ZONING-BASED */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2 border-b border-neutral-200 pb-1.5">
          <Building2 className="w-4 h-4 text-neutral-900" />
          <span className="text-xs font-bold font-mono tracking-wider text-neutral-900">{t('sections.zoning')}</span>
        </div>

        {/* Zone tabs */}
        <div className="flex flex-wrap gap-1.5">
          {ZONE_CLASS_KEYS.map(zc => {
            const cfg = zoneParams[zc] || ZONING_CONFIG[zc];
            if (!cfg) return null;
            return (
              <button
                key={zc}
                onClick={() => onSelectZoneClass(zc)}
                title={cfg.full_name}
                className={`px-2.5 py-1 rounded text-[10px] font-mono font-semibold cursor-pointer transition-all border ${
                  zc === activeZoneClass
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-neutral-100 text-neutral-500 border-transparent hover:bg-neutral-200 hover:text-neutral-700'
                }`}
              >
                {zc}
              </button>
            );
          })}
        </div>

        {/* Active zone building params */}
        {(() => {
          const activeParams = zoneParams[activeZoneClass] || ZONING_CONFIG[activeZoneClass];
          if (!activeParams) return <div className="text-[10px] text-neutral-400">{t('zoning.noConfig')}</div>;
          const upd = (u: Partial<ZoneConfigEntry>) => onChangeZoneParam(activeZoneClass, u);

          return (
            <div className="flex flex-col gap-3 text-xs">
              {/* FAR */}
              <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>{t('zoning.far')} <span className="text-[9px] text-neutral-400 font-normal">{t('zoning.farSub')}</span></span>
                  <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{activeParams.max_far_raw.toFixed(1)}</span>
                </div>
                <input type="range" min="0" max="10" step="0.1" value={activeParams.max_far_raw}
                  onChange={(e) => upd({ max_far_raw: parseFloat(e.target.value) })}
                  className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize" />
                <span className="text-[9px] text-neutral-400">{activeParams.max_far_desc}</span>
              </div>

              {/* Height */}
              <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>{t('zoning.height')} <span className="text-[9px] text-neutral-400 font-normal">{t('zoning.heightSub')}</span></span>
                  <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{activeParams.max_height_raw}ft</span>
                </div>
                <input type="range" min="20" max="120" step="1" value={activeParams.max_height_raw}
                  onChange={(e) => upd({ max_height_raw: parseInt(e.target.value) })}
                  className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize" />
                <span className="text-[9px] text-neutral-400">{activeParams.max_height_desc}</span>
              </div>

              {/* Lot area */}
              <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>{t('zoning.lotArea')}</span>
                  <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{activeParams.min_lot_area_raw}</span>
                </div>
                <input type="range" min="0" max="10000" step="100" value={activeParams.min_lot_area_raw}
                  onChange={(e) => upd({ min_lot_area_raw: parseInt(e.target.value) })}
                  className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize" />
                <span className="text-[9px] text-neutral-400">{activeParams.min_lot_area_desc}</span>
              </div>

              {/* Setback */}
              <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>{t('zoning.setback')} <span className="text-[9px] text-neutral-400 font-normal">{t('zoning.setbackSub')}</span></span>
                  <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{activeParams.front_setback_raw}ft</span>
                </div>
                <input type="range" min="5" max="50" step="1" value={activeParams.front_setback_raw}
                  onChange={(e) => upd({ front_setback_raw: parseInt(e.target.value) })}
                  className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize" />
                <span className="text-[9px] text-neutral-400">{activeParams.front_setback_desc}</span>
              </div>

              {/* Parking */}
              <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>{t('zoning.parking')} <span className="text-[9px] text-neutral-400 font-normal">{t('zoning.parkingSub')}</span></span>
                  <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{activeParams.parking_requirement_num.toFixed(1)}</span>
                </div>
                <input type="range" min="0" max="50" step="0.5" value={activeParams.parking_requirement_num}
                  onChange={(e) => upd({ parking_requirement_num: parseFloat(e.target.value) })}
                  className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize" />
                <span className="text-[9px] text-neutral-400">{activeParams.parking_req_desc}</span>
              </div>

              {/* Use permissions toggles */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-neutral-200">
                <span className="text-[9px] text-neutral-500 font-mono uppercase tracking-wider">{t('zoning.usePerms')}</span>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.residential_use_allowed ? t('zoning.yesRes') : t('zoning.noRes')}</span>
                  <input type="checkbox" checked={activeParams.residential_use_allowed}
                    onChange={(e) => upd({ residential_use_allowed: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.commercial_use_allowed ? t('zoning.yesCom') : t('zoning.noCom')}</span>
                  <input type="checkbox" checked={activeParams.commercial_use_allowed}
                    onChange={(e) => upd({ commercial_use_allowed: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.residential_mixed ? t('zoning.yesMixed') : t('zoning.noMixed')}</span>
                  <input type="checkbox" checked={activeParams.residential_mixed}
                    onChange={(e) => upd({ residential_mixed: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
              </div>

              {/* Site design toggles */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-neutral-200">
                <span className="text-[9px] text-neutral-500 font-mono uppercase tracking-wider">{t('zoning.siteDesign')}</span>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.landscaping_required ? t('zoning.yesGreen') : t('zoning.noGreen')}</span>
                  <input type="checkbox" checked={activeParams.landscaping_required}
                    onChange={(e) => upd({ landscaping_required: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.buffer_required ? t('zoning.yesBuffer') : t('zoning.noBuffer')}</span>
                  <input type="checkbox" checked={activeParams.buffer_required}
                    onChange={(e) => upd({ buffer_required: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer py-0.5 hover:bg-neutral-50 px-1 rounded text-[10px] font-mono">
                  <span>{activeParams.non_accessory_parking_allowed ? t('zoning.yesParking') : t('zoning.noParking')}</span>
                  <input type="checkbox" checked={activeParams.non_accessory_parking_allowed}
                    onChange={(e) => upd({ non_accessory_parking_allowed: e.target.checked })}
                    className="w-3.5 h-3.5 accent-neutral-900 rounded" />
                </label>
              </div>
            </div>
          );
        })()}
      </div>

      {/* PARAM 2: LIGHTING & CANOPY COVERS */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2 border-b border-neutral-200 pb-1.5">
          <Sun className="w-4 h-4 text-neutral-900" />
          <span className="text-xs font-bold font-mono tracking-wider text-neutral-900">{t('sections.illumination')}</span>
        </div>

        <div className="flex flex-col gap-3 text-xs">
          {/* Light Pole Density */}
          <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span>{t('illumination.lightDensity')}</span>
              <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{params.lightDensity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={params.lightDensity}
              onChange={(e) => onChangeParams({ lightDensity: parseFloat(e.target.value) })}
              className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-light-density"
            />
          </div>

          {/* Broken failure rate */}
          <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span className="flex items-center gap-1 font-bold text-neutral-800">
                <span>{t('illumination.lightFailure')}</span>
                <span title="Simulates dark zones due to maintenance failure">
                  <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
                </span>
              </span>
              <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200 shadow-sm">{params.lightFailureRate.toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={params.lightFailureRate}
              onChange={(e) => onChangeParams({ lightFailureRate: parseFloat(e.target.value) })}
              className="w-full accent-red-600 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-light-failure"
            />
          </div>

          {/* Tree density */}
          <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span>{t('illumination.treeDensity')}</span>
              <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{params.treeDensity} {t('illumination.treeCount')}</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={params.treeDensity}
              onChange={(e) => onChangeParams({ treeDensity: parseInt(e.target.value) })}
              className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-tree-density"
            />
          </div>

          {/* Tree canopy size */}
          <div className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span>{t('illumination.treeCanopy')}</span>
              <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">{params.treeCanopy.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={params.treeCanopy}
              onChange={(e) => onChangeParams({ treeCanopy: parseFloat(e.target.value) })}
              className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-tree-canopy"
            />
          </div>
        </div>
      </div>

      {/* PARAM 3: ENVIRONMENTAL INDICATORS */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
          <div className="flex items-center gap-1.5 text-neutral-900">
            <Sparkles className="w-4 h-4 text-neutral-950" />
            <span className="text-xs font-bold font-mono tracking-wider">{t('sections.spatial')}</span>
          </div>
          <span className="text-[10px] font-mono text-neutral-500 font-bold bg-white px-1.5 py-0.5 rounded border border-neutral-200">
            {t('spatial.status')}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {environmentalIndices.map((idx) => {
            const badgeStyle = getIndexColorClass(idx.key, idx.value);

            return (
              <div key={idx.key} className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
                  <span>
                    {getLocalizedIndexName(idx)}
                    <span className="text-[9px] text-neutral-400 font-normal"> ({idx.key})</span>
                  </span>
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shadow-sm ${badgeStyle}`}>
                    {idx.value}
                  </span>
                </div>
                {/* Fixed display bar (no slider — indicators are policy-driven constants) */}
                <div className="w-full bg-neutral-200 h-1.5 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{
                      width: `${idx.value}%`,
                      backgroundColor: idx.value > 70 ? '#16a34a' : idx.value > 40 ? '#eab308' : '#dc2626'
                    }}
                  />
                </div>
                <span className="text-[9px] text-neutral-400">{getLocalizedIndexDescription(idx)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* PARAM 4: GAMA ABM MULTI-AGENT SIMULATION */}
      <div className="flex flex-col gap-3.5 bg-neutral-50 p-3 rounded-lg border border-neutral-200 shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
          <div className="flex items-center gap-1.5 text-neutral-900">
            <Users className="w-4 h-4 text-neutral-900" />
            <span className="text-xs font-bold font-mono tracking-wider">{t('sections.gama')}</span>
          </div>
          <span className="text-[10px] font-mono text-neutral-900 bg-white px-1.5 py-0.5 rounded border border-neutral-200 shadow-sm font-bold">
            {t('engine.rate')}: {(getFlowRateAtHour(params.simHour) * params.spawnRate).toFixed(2)}x
          </span>
        </div>

        {/* Link / branding badge */}
        <div className="flex items-center justify-between text-[9px] font-sans text-neutral-500 bg-white p-2 rounded border border-neutral-100">
          <span className="flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {localModelLoaded ? `${t('gama.engine')} ${t('gama.modelLoaded')}` : `${t('gama.engine')} ${t('gama.modelMissing')}`}
          </span>
          <span className="text-neutral-900 font-bold" aria-label={t('gama.modelPath')}>`gama-model/chicago_crime.gaml`</span>
        </div>

        <div className="text-[10px] text-neutral-500 bg-white p-2 rounded border border-neutral-100 leading-relaxed">
          {t('gama.localModelInfo', { lineCount: localModelLineCount })}
        </div>

        {/* Hour slider */}
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
            <span>{t('gama.clock')}</span>
            <span className="font-bold text-neutral-950 bg-white px-2 py-0.5 rounded border border-neutral-200 shadow-sm">
              {formattedSimTime}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="23.95"
            step="0.05"
            value={params.simHour}
            onChange={(e) => onChangeParams({ simHour: parseFloat(e.target.value) })}
            className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
            id="slider-sim-hour"
          />
        </div>

        {/* Mini SVG GAMA ABM Flow Curve Grapher */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[9px] text-neutral-500 font-mono flex items-center gap-1">
            <BarChart2 className="w-3.5 h-3.5 text-neutral-500" /> {t('gama.flowTitle')}
          </span>
          <div className="relative h-20 bg-white border border-neutral-200 rounded p-1 mt-0.5 overflow-hidden shadow-inner">
            <svg viewBox="0 0 240 80" className="w-full h-full overflow-visible">
              {/* Grid lines */}
              <line x1="0" y1="70" x2="240" y2="70" stroke="#f0f0f0" strokeWidth="1" />
              <line x1="120" y1="0" x2="120" y2="80" stroke="#f5f5f5" strokeDasharray="3,3" />
              
              {/* Fill area under GAMA curve */}
              <path
                d={`M 0 70 ` + gamaChartPoints.map(p => {
                  const sx = p.hour * 10;
                  const sy = 70 - (p.rate / maxRate) * 55;
                  return `L ${sx} ${sy}`;
                }).join(' ') + ` L 240 70 Z`}
                fill="rgba(16,185,129,0.04)"
              />
              
              {/* GAMA curve line */}
              <path
                d={gamaChartPoints.map((p, idx) => {
                  const sx = p.hour * 10;
                  const sy = 70 - (p.rate / maxRate) * 55;
                  return `${idx === 0 ? 'M' : 'L'} ${sx} ${sy}`;
                }).join(' ')}
                fill="none"
                stroke="#10b981"
                strokeWidth="1.8"
              />

              {/* Current hour vertical indicator bar */}
              <line 
                x1={params.simHour * 10} 
                y1="5" 
                x2={params.simHour * 10} 
                y2="75" 
                stroke="#dc2626" 
                strokeWidth="1.5" 
                strokeDasharray="2,2" 
              />
              
              {/* Tiny text markers */}
              <text x="5" y="77" fill="#a3a3a3" fontSize="6" fontFamily="monospace">00:00</text>
              <text x="110" y="77" fill="#a3a3a3" fontSize="6" fontFamily="monospace">12:00</text>
              <text x="215" y="77" fill="#a3a3a3" fontSize="6" fontFamily="monospace">24:00</text>
            </svg>
          </div>
        </div>

        <div className="flex flex-col gap-3 text-xs mt-1 border-t border-dashed border-neutral-200 pt-3">
          {/* Spawner Multiplier */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded border border-neutral-100 shadow-sm">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span>{t('gama.spawnRate')}</span>
              <span className="font-bold text-neutral-950 bg-neutral-50 px-1.5 py-0.5 rounded border border-neutral-200">{params.spawnRate.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.1"
              value={params.spawnRate}
              onChange={(e) => onChangeParams({ spawnRate: parseFloat(e.target.value) })}
              className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-gama-spawn-rate"
            />
          </div>

          {/* Criminal Spawn Ratio */}
          <div className="flex flex-col gap-1.5 bg-white p-2.5 rounded border border-neutral-100 shadow-sm">
            <div className="flex justify-between items-center text-neutral-700 font-mono text-[11px]">
              <span className="text-red-600 font-bold flex items-center gap-1">{t('gama.criminalRatio')}</span>
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">{Math.round(params.criminalRatio * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="0.5"
              step="0.05"
              value={params.criminalRatio}
              onChange={(e) => onChangeParams({ criminalRatio: parseFloat(e.target.value) })}
              className="w-full accent-red-600 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-criminal-ratio"
            />
          </div>
        </div>
      </div>

      {/* PARAM 5: WEIGHTED RISK FACTORS */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
          <div className="flex items-center gap-1.5 text-neutral-900">
            <SlidersHorizontal className="w-4 h-4 text-neutral-900" />
            <span className="text-xs font-bold font-mono tracking-wider">{t('sections.weights')}</span>
          </div>
        </div>

        {/* Dynamic Sliders for CSV values */}
        <div className="flex flex-col gap-3.5 mt-1">
          {weights.map((w) => {
            const isPos = w.weight >= 0;
            const isCriminalOrTree = w.key === 'criminal' || w.key === 'tree' || w.key === 'density';
            const accentColor = isCriminalOrTree ? 'accent-red-600' : 'accent-neutral-900';
            const badgeColor = isCriminalOrTree ? 'text-red-600 border-red-200 bg-red-50' : 'text-neutral-800 border-neutral-300 bg-neutral-50';

            return (
              <div key={w.key} className="flex flex-col gap-1.5 bg-neutral-50 p-2.5 rounded border border-neutral-100 shadow-sm pb-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-neutral-800 flex items-center gap-1 font-sans">
                    {getLocalizedWeightName(w)}
                    <span className="text-[9px] text-neutral-400 font-mono">({w.key})</span>
                  </span>
                  <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] border shadow-sm ${badgeColor}`}>
                    {isPos ? '+' : ''}{w.weight.toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-normal font-sans mb-0.5">{getLocalizedWeightDescription(w)}</p>
                <input
                  type="range"
                  min={w.key === 'light' || w.key === 'bystander' ? '-1.0' : '-0.5'}
                  max={w.key === 'light' || w.key === 'bystander' ? '1.0' : '1.5'}
                  step="0.05"
                  value={w.weight}
                  onChange={(e) => handleWeightSliderChange(w.key, parseFloat(e.target.value))}
                  className={`w-full ${accentColor} bg-neutral-200 h-1 rounded cursor-ew-resize`}
                  id={`slider-weight-${w.key}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* RENDER VISIBILITY SWITCHES */}
      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 text-[11px] font-mono text-neutral-700">
        <label className="flex items-center justify-between cursor-pointer py-1.5 hover:bg-neutral-50 px-1.5 rounded transition-colors border border-transparent hover:border-neutral-200">
          <span>{t('visibility.pastCrimes')}</span>
          <input
            type="checkbox"
            checked={params.showPastCrimes}
            onChange={(e) => onChangeParams({ showPastCrimes: e.target.checked })}
            className="w-4 h-4 accent-neutral-900 bg-neutral-100 rounded cursor-pointer border border-neutral-300"
            id="checkbox-show-past-crimes"
          />
        </label>

        
        <label className="flex items-center justify-between cursor-pointer py-1.5 hover:bg-neutral-50 px-1.5 rounded transition-colors border border-transparent hover:border-neutral-200">
          <span>{t('visibility.heatmap')}</span>
          <input
            type="checkbox"
            checked={params.showHeatmap}
            onChange={(e) => onChangeParams({ showHeatmap: e.target.checked })}
            className="w-4 h-4 accent-neutral-900 bg-neutral-100 rounded cursor-pointer border border-neutral-300"
            id="checkbox-show-heatmap"
          />
        </label>
        
        <label className="flex items-center justify-between cursor-pointer py-1.5 hover:bg-neutral-50 px-1.5 rounded transition-colors border border-transparent hover:border-neutral-200">
          <span>{t('visibility.visionCones')}</span>
          <input
            type="checkbox"
            checked={params.showVisionCones}
            onChange={(e) => onChangeParams({ showVisionCones: e.target.checked })}
            className="w-4 h-4 accent-neutral-900 bg-neutral-100 rounded cursor-pointer border border-neutral-300"
            id="checkbox-show-vision-cones"
          />
        </label>

        {params.showHeatmap && (
          <div className="flex flex-col gap-1.5 mt-1 bg-neutral-50 p-2 rounded border border-neutral-100">
            <div className="flex justify-between items-center text-neutral-500 text-[10px]">
              <span>{t('visibility.opacity')}</span>
              <span className="text-neutral-950 font-bold font-mono">{(params.heatmapOpacity * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              value={params.heatmapOpacity}
              onChange={(e) => onChangeParams({ heatmapOpacity: parseFloat(e.target.value) })}
              className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded cursor-ew-resize"
              id="slider-heatmap-opacity"
            />
          </div>
        )}

      </div>

    </div>
  );
}

import React, { useState } from 'react';
import { SimulationStats, Streetlight, WeightConfig, SimulationParams } from '../types';
import { 
  ShieldAlert, Activity, ShieldCheck, SunDim, Users2, 
  TrendingUp, HelpCircle, HardHat, AlertTriangle, Sparkles, ChevronDown, ChevronUp, BarChart3
} from 'lucide-react';
import { useLanguage } from '../i18n';

interface DataStatsProps {
  stats: SimulationStats;
  streetlights: Streetlight[];
  weights: WeightConfig[];
  params: SimulationParams;
}

export default function DataStats({
  stats,
  streetlights,
  weights,
  params
}: DataStatsProps) {
  const { t } = useLanguage();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const getLocalizedWeightShortName = (weight: WeightConfig) => {
    const translated = t(`weightsMeta.${weight.key}.short`);
    if (translated !== `weightsMeta.${weight.key}.short`) return translated;
    return weight.name.split('系数')[0].split('投影')[0].split('阻断')[0];
  };
  
  // Calculate operating streetlight percentage
  const totalLights = streetlights.length;
  const activeLights = streetlights.filter(l => l.status === 'on' && !l.isBroken).length;
  const activeLightPercent = totalLights > 0 ? (activeLights / totalLights) * 100 : 0;

  // Retrieve factors weight contribution
  const getWeightImpact = (key: string) => {
    const w = weights.find(item => item.key === key)?.weight ?? 0;
    return Math.abs(w);
  };

  const totalWeights = weights.reduce((acc, curr) => acc + Math.abs(curr.weight), 0.1);

  // Safety rating descriptions
  const getSafetyVerdict = (score: number) => {
    if (score >= 75) return { 
      label: t('stats.verdictHigh'), 
      color: 'text-emerald-600', 
      border: 'border-emerald-200',
      bg: 'bg-emerald-50',
      desc: t('stats.verdictHighDesc'),
    };
    if (score >= 45) return { 
      label: t('stats.verdictMed'), 
      color: 'text-amber-600', 
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      desc: t('stats.verdictMedDesc'),
    };
    return { 
      label: t('stats.verdictLow'), 
      color: 'text-red-600', 
      border: 'border-red-200',
      bg: 'bg-red-50',
      desc: t('stats.verdictLowDesc'),
    };
  };

  const verdict = getSafetyVerdict(stats.safetyScore);

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="flex items-center justify-between w-full px-3.5 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-mono font-bold text-neutral-800 hover:bg-neutral-100 cursor-pointer select-none transition-all"
        id="btn-expand-stats"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-neutral-950 animate-pulse" />
          <span>{t('stats.collapsed')} (Score: {stats.safetyScore})</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full bg-neutral-50/50 border border-neutral-200 p-4 rounded-lg text-neutral-800 font-sans select-none transition-all" id="analytics-stats-dashboard">
      
      {/* Title Section (Clickable header to collapse) */}
      <div className="flex items-center justify-between border-b border-neutral-200 pb-2 cursor-pointer hover:opacity-85" onClick={() => setIsCollapsed(true)}>
        <div className="flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-neutral-900 animate-pulse" />
          <span className="text-[10px] font-bold font-mono tracking-wider text-neutral-900 uppercase">
            {t('stats.results')}
          </span>
        </div>
        <ChevronUp className="w-3.5 h-3.5 text-neutral-500" />
      </div>

      {/* RADIAL SAFETY SCORE METER */}
      <div className={`flex flex-col gap-2.5 bg-white border ${verdict.border} p-2.5 rounded shadow-sm transition-all duration-300`}>
        <div className="flex items-center justify-between border-b border-neutral-100 pb-1.5">
          <span className="text-[9px] font-mono tracking-widest text-neutral-500 uppercase">{t('stats.safety')}</span>
          <ShieldCheck className={`w-3.5 h-3.5 ${verdict.color}`} />
        </div>

        <div className="flex items-center gap-3 py-0.5">
          {/* Radial SVG Gauge */}
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="41"
                fill="none"
                stroke="#f3f4f6"
                strokeWidth="8"
              />
              <circle
                cx="50"
                cy="50"
                r="41"
                fill="none"
                stroke={stats.safetyScore >= 75 ? '#10b981' : stats.safetyScore >= 45 ? '#f59e0b' : '#ef4444'}
                strokeWidth="8"
                strokeDasharray="257.6"
                strokeDashoffset={257.6 - (257.6 * stats.safetyScore) / 100}
                strokeLinecap="round"
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold font-mono text-neutral-900 tracking-tighter">
                {stats.safetyScore}
              </span>
              <span className="text-[7px] font-mono text-neutral-400 font-bold tracking-widest leading-none">{t('stats.score')}</span>
            </div>
          </div>

          {/* Verdict details */}
          <div className="flex flex-col gap-1 min-w-0">
            <span className={`text-[9px] font-bold font-mono tracking-wide ${verdict.color} px-1.5 py-0.5 rounded ${verdict.bg} border ${verdict.border} inline-block self-start`}>
              {verdict.label}
            </span>
            <p className="text-[9px] text-neutral-500 leading-normal font-sans">
              {verdict.desc}
            </p>
          </div>
        </div>
      </div>

      {/* REAL-TIME KEY PERFORMANCE INDICATORS */}
      <div className="flex flex-col gap-2.5 bg-neutral-50 border border-neutral-200 p-2.5 rounded shadow-inner">
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          {/* Risk Level */}
          <div className="flex flex-col bg-white p-2 rounded border border-neutral-100 shadow-sm">
            <span className="text-neutral-400 text-[8px]">{t('stats.avgRisk')}</span>
            <span className="text-sm font-bold text-red-600 mt-0.5">
              {(stats.averageRisk * 100).toFixed(1)}%
            </span>
          </div>

          {/* Pedestrian count */}
          <div className="flex flex-col bg-white p-2 rounded border border-neutral-100 shadow-sm">
            <span className="text-neutral-400 text-[8px]">{t('stats.agents')}</span>
            <span className="text-sm font-bold text-neutral-800 mt-0.5">
              {stats.activeResidents}<span className="text-neutral-400 text-xs font-normal mx-0.5">/</span><span className="text-red-500">{stats.activeCriminals}</span>
            </span>
          </div>

          {/* Streetlight Active */}
          <div className="flex flex-col bg-white p-2 rounded border border-neutral-100 shadow-sm">
            <span className="text-neutral-400 text-[8px]">{t('stats.lights')}</span>
            <span className="text-sm font-bold mt-0.5">
              <span className={activeLightPercent < 70 ? 'text-amber-600' : 'text-emerald-600'}>
                {activeLightPercent.toFixed(0)}%
              </span>
              <span className="text-[8px] text-neutral-400 font-normal ml-1">
                ({stats.brokenLightsCount} {t('stats.brokenUnit')})
              </span>
            </span>
          </div>

          {/* Crime prediction coefficient */}
          <div className="flex flex-col bg-white p-2 rounded border border-neutral-100 shadow-sm">
            <span className="text-neutral-400 text-[8px]">{t('stats.hotspots')}</span>
            <span className="text-sm font-bold text-red-600 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>{stats.crimeIncidents} {t('stats.unit')}</span>
            </span>
          </div>
        </div>
      </div>

      {/* CRIME FACTORS CONTRIBUTION CHART */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-1">
          <span className="text-[9px] font-mono tracking-widest text-neutral-500 uppercase">{t('stats.influence')}</span>
          <BarChart3 className="w-3.5 h-3.5 text-neutral-500" />
        </div>

        {/* Custom stacked bar visualization representing weights distribution */}
        <div className="flex flex-col gap-1.5 py-0.5 text-[9px] font-mono">
          {weights.slice(0, 4).map((w, idx) => {
            const rawContribution = getWeightImpact(w.key);
            const percentage = Math.round((rawContribution / totalWeights) * 100);
            
            // Subtle gray-scale matching bar colors
            const barColors = [
              'bg-neutral-800', // Darkness
              'bg-emerald-600', // Bystanders
              'bg-red-500',     // Criminals
              'bg-amber-600',   // Canopy
            ];

            return (
              <div key={w.key} className="flex flex-col gap-0.5 bg-neutral-50/50 p-1 rounded border border-neutral-100">
                <div className="flex justify-between text-neutral-500">
                  <span className="text-neutral-700 font-sans">{getLocalizedWeightShortName(w)}</span>
                  <span className="font-bold text-neutral-900">{percentage}%</span>
                </div>
                {/* Visual bar tracker */}
                <div className="w-full bg-neutral-200 h-1 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${barColors[idx % barColors.length]}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

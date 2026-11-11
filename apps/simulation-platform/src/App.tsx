import React, { useState, useEffect, useRef } from 'react';
import { 
  Building, Tree, Streetlight, Agent, HeatmapCell, 
  SimulationParams, WeightConfig, SimulationStats,
  EnvironmentalIndex
} from './types';
import { 
  generateStreetlights, generateTrees, 
  spawnAgents, updateAgents, generateHeatmap, calculateStats 
} from './utils/simulation';
import MapCanvas from './components/MapCanvas';
import ParamPanel from './components/ParamPanel';
import PolicyImportModal from './components/PolicyImportModal';
import { Tract, CHICAGO_TRACTS } from './constants/tracts';
import { generateEnvironmentalIndicesForTract } from './utils/environmentalIndices';
import { buildEnvironmentalIndicesFromSamples, load4207DatasetFromRaw, Tract4207Dataset } from './utils/tract4207Data';
import samplesCsv from '../4207_indices - 9features.csv?raw';
import featureWeightsCsv from '../tract_4207_spatial_features.csv?raw';
import { generateZoningBuildings, ExtendedBuilding } from './utils/zoningBuildingGenerator';
import { computeZonePieces, ZonePiece } from './utils/zoningData';
import { ZONING_CONFIG, ZoneConfigEntry } from './constants/zoningConfig';
import { preloadOsmRoads } from './utils/osmRoads';
import zoningCsv from './data/zoning_wkt.csv?raw';
import gamaModelText from '../gama-model/chicago_crime.gaml?raw';
import { Download, FileSearch, Menu, X } from 'lucide-react';
import { useLanguage } from './i18n';
import { analyzePolicyFile, applyPolicyChangesToZone, ZoningPolicyAnalysis } from './utils/zoningPolicy';
import { buildNeighborhoodCadDxf } from './utils/cadExport';

const DEFAULT_WEIGHTS: WeightConfig[] = [
  { key: 'light', name: '夜间照明照度阻断比率', category: 'environment', weight: 0.70, description: '路灯照度辐射范围对犯罪行为的物理遏制系数。' },
  { key: 'bystander', name: '旁观居民监视威慑系数', category: 'surveillance', weight: 0.85, description: '行人群体中合法居民视线（Eyes on the Street）投射的群防群治震慑度。' },
  { key: 'criminal', name: '罪犯侦查窥视死角增益', category: 'criminal', weight: 0.60, description: '罪犯视线全覆盖但缺乏旁观者注视时的窥害乘积。' },
  { key: 'tree', name: '密集绿植投影暗室掩护率', category: 'environment', weight: 0.40, description: '密集树木冠层及荫蔽处为罪犯提供的隐藏和潜伏逃逸增量。' },
  { key: 'density', name: '空间建筑盲区物理聚集率', category: 'environment', weight: 0.35, description: '建筑高耸与高密度造成的小路、死角及视觉死角形成概率。' },
];

const DEFAULT_PARAMS: SimulationParams = {
  buildingHeight: 5, buildingDensity: 1.8, buildingJitter: 0.20,
  treeDensity: 35, treeCanopy: 1.1, lightDensity: 1.7, lightFailureRate: 15,
  simHour: 22, spawnRate: 1.0, criminalRatio: 0.25,
  showVisionCones: true, showHeatmap: true, heatmapOpacity: 0.50,
  showPastCrimes: false, showEnvironmentalIndices: true
};

export default function App() {
  const { language, toggleLanguage, t } = useLanguage();
  const [params, setParams] = useState<SimulationParams>(DEFAULT_PARAMS);
  const [weights, setWeights] = useState<WeightConfig[]>(DEFAULT_WEIGHTS);
  const paramsRef = useRef(params);
  const lastClockAdvanceRef = useRef(0);
  const lastSimStepRef = useRef(0);

  const defaultTract = CHICAGO_TRACTS.find(t => t.id === '420700') || CHICAGO_TRACTS[0];
  const [selectedTract] = useState<Tract>(defaultTract);

  const [buildings, setBuildings] = useState<ExtendedBuilding[]>([]);
  const [streetlights, setStreetlights] = useState<Streetlight[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [environmentalIndices, setEnvironmentalIndices] = useState<EnvironmentalIndex[]>([]);
  const [tract4207Dataset, setTract4207Dataset] = useState<Tract4207Dataset | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [stats, setStats] = useState<SimulationStats>({
    averageRisk: 0.35, safetyScore: 65,
    activeResidents: 0, activeCriminals: 0,
    brokenLightsCount: 0, totalLightsCount: 0, crimeIncidents: 0
  });

  const [zonePieces, setZonePieces] = useState<ZonePiece[]>([]);
  const [zoneParams, setZoneParams] = useState<Record<string, ZoneConfigEntry>>({ ...ZONING_CONFIG });
  const [activeZoneClass, setActiveZoneClass] = useState<string>('RT-4');

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const animationRef = useRef<number | null>(null);
  const tickCounter = useRef<number>(0);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyAnalysis, setPolicyAnalysis] = useState<ZoningPolicyAnalysis | null>(null);
  const [policyAnalyzing, setPolicyAnalyzing] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyApplied, setPolicyApplied] = useState(false);
  const policyBaselineRef = useRef<ZoneConfigEntry | null>(null);

  const CANVAS_WIDTH = 840;
  const CANVAS_HEIGHT = 600;

  // ── Initial data load ──────────────────────────────────
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTract4207Dataset(load4207DatasetFromRaw(samplesCsv, featureWeightsCsv));
      preloadOsmRoads(CANVAS_WIDTH, CANVAS_HEIGHT, 40, selectedTract.coordinates, selectedTract.boundingBox);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const pieces = computeZonePieces(zoningCsv, CANVAS_WIDTH, CANVAS_HEIGHT, selectedTract.boundingBox);
      setZonePieces(pieces);
    }, 400);
    return () => clearTimeout(timer);
  }, [selectedTract]);

  // ── Building generation ────────────────────────────────
  useEffect(() => {
    if (zonePieces.length === 0) return;
    const timer = setTimeout(() => {
      regenAll(zonePieces, zoneParams, tract4207Dataset, selectedTract, params, weights);
    }, 100);
    return () => clearTimeout(timer);
  }, [zonePieces, zoneParams, selectedTract, tract4207Dataset]);

  const regenInitDone = useRef(false);
  useEffect(() => {
    if (!regenInitDone.current) { regenInitDone.current = true; return; }
    if (zonePieces.length === 0) return;
    regenAll(zonePieces, zoneParams, tract4207Dataset, selectedTract, params, weights);
  }, [params.buildingHeight, params.buildingDensity, params.buildingJitter,
      params.treeDensity, params.treeCanopy, params.lightDensity, params.lightFailureRate]);

  function regenAll(
    pieces: ZonePiece[], zp: Record<string, ZoneConfigEntry>,
    ds: Tract4207Dataset | null,
    tract: Tract, p: SimulationParams, w: WeightConfig[]
  ) {
    const use4207 = tract.id === '420700' ? ds : null;
    const genBuildings = pieces.length > 0
      ? generateZoningBuildings(pieces, zp, CANVAS_WIDTH, CANVAS_HEIGHT, tract.boundingBox)
      : [];
    const genLights = generateStreetlights(CANVAS_WIDTH, CANVAS_HEIGHT, p, tract.coordinates, tract.boundingBox, use4207);
    const genTrees = generateTrees(CANVAS_WIDTH, CANVAS_HEIGHT, p, genBuildings, tract.coordinates, tract.boundingBox, use4207);
    const indices = use4207?.samples.length
      ? buildEnvironmentalIndicesFromSamples(use4207.samples)
      : generateEnvironmentalIndicesForTract(tract);

    setBuildings(genBuildings);
    setStreetlights(genLights);
    setTrees(genTrees);
    setEnvironmentalIndices(indices);

    const initialAgents = spawnAgents(CANVAS_WIDTH, CANVAS_HEIGHT, p, [], tract.coordinates, tract.boundingBox, genBuildings);
    setAgents(initialAgents);
    const h = generateHeatmap(CANVAS_WIDTH, CANVAS_HEIGHT, 12, genBuildings, genLights, genTrees, initialAgents, w, p.simHour, tract.coordinates, tract.boundingBox, indices);
    setHeatmap(h);
    setStats(calculateStats(h, genLights, initialAgents));
  }

  useEffect(() => {
    if (buildings.length === 0) return;
    if (isPlaying) return;

    const respawned = spawnAgents(
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      params,
      [],
      selectedTract.coordinates,
      selectedTract.boundingBox,
      buildings
    );
    setAgents(respawned);
    const h = generateHeatmap(
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      12,
      buildings,
      streetlights,
      trees,
      respawned,
      weights,
      params.simHour,
      selectedTract.coordinates,
      selectedTract.boundingBox,
      environmentalIndices
    );
    setHeatmap(h);
    setStats(calculateStats(h, streetlights, respawned));
  }, [params.simHour, params.spawnRate, params.criminalRatio, weights, isPlaying, buildings, streetlights, trees, selectedTract, environmentalIndices]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      lastSimStepRef.current = 0;
      lastClockAdvanceRef.current = 0;
      return;
    }

    const run = (now: number) => {
      if (now - lastSimStepRef.current < 80) {
        animationRef.current = requestAnimationFrame(run);
        return;
      }
      lastSimStepRef.current = now;
      tickCounter.current += 1;
      const currentParams = paramsRef.current;

      if (now - lastClockAdvanceRef.current >= 400) {
        lastClockAdvanceRef.current = now;
        const nextHour = (currentParams.simHour + 0.05) % 24;
        const nextParams = { ...currentParams, simHour: nextHour };
        paramsRef.current = nextParams;
        setParams(nextParams);
      }

      setAgents(prev => {
        const liveParams = paramsRef.current;
        const spawned = spawnAgents(CANVAS_WIDTH, CANVAS_HEIGHT, liveParams, prev, selectedTract.coordinates, selectedTract.boundingBox, buildings);
        const updated = updateAgents(spawned, buildings, 1.2);
        if (tickCounter.current % 8 === 0) {
          const h = generateHeatmap(
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            12,
            buildings,
            streetlights,
            trees,
            updated,
            weights,
            liveParams.simHour,
            selectedTract.coordinates,
            selectedTract.boundingBox,
            environmentalIndices
          );
          setHeatmap(h);
          setStats(calculateStats(h, streetlights, updated));
        }
        return updated;
      });
      animationRef.current = requestAnimationFrame(run);
    };

    animationRef.current = requestAnimationFrame(run);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, buildings, streetlights, trees, weights, selectedTract]);

  // ── Toggle Play/Pause ──────────────────────────────────
  const handleTogglePlay = () => {
    setIsPlaying(prev => !prev);
  };

  const handleToggleStreetlight = (id: string) => {
    setStreetlights(prev => {
      const updated = prev.map(light => {
        if (light.id !== id) return light;
        const nextStatus: Streetlight['status'] = light.status === 'on' ? 'off' : 'on';
        return {
          ...light,
          status: nextStatus,
          intensity: nextStatus === 'on' ? 1.0 : 0,
        };
      });
      const liveParams = paramsRef.current;
      const h = generateHeatmap(CANVAS_WIDTH, CANVAS_HEIGHT, 12, buildings, updated, trees, agents, weights, liveParams.simHour, selectedTract.coordinates, selectedTract.boundingBox, environmentalIndices);
      setHeatmap(h);
      setStats(calculateStats(h, updated, agents));
      return updated;
    });
  };

  const handleReset = () => {
    setParams(DEFAULT_PARAMS);
    setWeights(DEFAULT_WEIGHTS);
    setZoneParams({ ...ZONING_CONFIG });
    policyBaselineRef.current = null;
    setPolicyApplied(false);
  };
  const handleUpdateZoneParam = (zc: string, u: Partial<ZoneConfigEntry>) => setZoneParams(prev => ({ ...prev, [zc]: { ...(prev[zc] || ZONING_CONFIG[zc]), ...u } }));

  const handleUploadPolicyFile = async (file: File) => {
    if (policyApplied || policyAnalyzing) return;
    setPolicyError(null);
    setPolicyAnalysis(null);
    setPolicyAnalyzing(true);
    try {
      const analysis = await analyzePolicyFile(file, zoneParams);
      setPolicyAnalysis(analysis);
      if (analysis.applicableChanges.length === 0) {
        setPolicyError(t('policy.noApplicable'));
      }
    } catch (error) {
      console.error(error);
      const scenarioError = file.name.toLowerCase().endsWith('.json') && error instanceof Error;
      setPolicyError(scenarioError ? error.message : t('policy.parseError'));
    } finally {
      setPolicyAnalyzing(false);
    }
  };

  const handleApplyPolicy = () => {
    if (!policyAnalysis || policyAnalysis.applicableChanges.length === 0) return;
    const targetZoneClass = policyAnalysis.targetZoneClass;
    const baseline = policyBaselineRef.current || zoneParams[targetZoneClass] || ZONING_CONFIG[targetZoneClass];
    if (!policyBaselineRef.current) policyBaselineRef.current = baseline;
    const updatedZone = applyPolicyChangesToZone(baseline, policyAnalysis.applicableChanges);
    setZoneParams(prev => ({ ...prev, [targetZoneClass]: updatedZone }));
    setActiveZoneClass(targetZoneClass);
    setPolicyApplied(true);
  };

  const handleRevertPolicy = () => {
    if (!policyBaselineRef.current || !policyAnalysis) return;
    const targetZoneClass = policyAnalysis.targetZoneClass;
    setZoneParams(prev => ({ ...prev, [targetZoneClass]: policyBaselineRef.current as ZoneConfigEntry }));
    setActiveZoneClass(targetZoneClass);
    policyBaselineRef.current = null;
    setPolicyApplied(false);
  };

  const handleExportCad = () => {
    const dxf = buildNeighborhoodCadDxf({
      buildings,
      tract: selectedTract,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = `${selectedTract.id || 'chicago-tract'}-block-export.dxf`;
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-neutral-100 text-neutral-800" id="main-crime-simulation-app">

      <section className="absolute inset-0" id="visualizer-section">
        <MapCanvas
          buildings={buildings} streetlights={streetlights} trees={trees}
          agents={agents} heatmap={heatmap} params={params}
          onToggleStreetlight={handleToggleStreetlight} selectedTract={selectedTract}
          environmentalIndices={environmentalIndices}
          tract4207Dataset={tract4207Dataset} zonePieces={zonePieces} zoneParams={zoneParams}
          sidebarOpen={sidebarOpen}
        />
      </section>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-6 left-6 z-[600] w-12 h-12 bg-neutral-900 text-white rounded-full shadow-xl flex items-center justify-center active:scale-95 transition-transform duration-200"
        aria-label={t('app.toggleMenu')}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <button
        onClick={toggleLanguage}
        className="fixed bottom-6 left-20 z-[600] w-12 h-12 bg-white text-neutral-900 border border-neutral-300 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform duration-200"
        aria-label={t('app.toggleLang')}
      >
        <span className="text-xs font-bold font-mono">
          {language === 'zh' ? 'EN' : '中'}
        </span>
      </button>

      <button
        onClick={() => setPolicyModalOpen(true)}
        className={`fixed bottom-6 left-[8.5rem] z-[600] h-12 rounded-full border px-4 shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform duration-200 ${
          policyApplied
            ? 'bg-emerald-600 text-white border-emerald-700'
            : 'bg-white text-neutral-900 border-neutral-300'
        }`}
        aria-label={t('policy.open')}
      >
        <FileSearch className="w-4 h-4" />
        <span className="text-[11px] font-bold font-mono hidden md:inline">{t('policy.short')}</span>
      </button>

      <button
        onClick={handleExportCad}
        className="fixed bottom-6 left-[15.25rem] z-[600] h-12 rounded-full border px-4 shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform duration-200 bg-white text-neutral-900 border-neutral-300"
        aria-label={t('cad.export')}
      >
        <Download className="w-4 h-4" />
        <span className="text-[11px] font-bold font-mono hidden md:inline">{t('cad.short')}</span>
      </button>

      <div
        className={`fixed top-0 right-0 h-full w-[360px] max-w-[90vw] bg-white shadow-2xl z-[550] overflow-y-auto transition-transform duration-300 ease-out ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        id="controller-sidebar-section"
      >
        <ParamPanel
          params={params}
          onChangeParams={(newParams) => {
            setParams(prev => ({ ...prev, ...newParams }));
          }}
          weights={weights}
          onChangeWeights={setWeights}
          onResetParams={handleReset}
          stats={stats}
          streetlights={streetlights}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          environmentalIndices={environmentalIndices}
          tract4207Dataset={tract4207Dataset}
          onChangeIndices={setEnvironmentalIndices}
          zoneParams={zoneParams}
          onChangeZoneParam={handleUpdateZoneParam}
          activeZoneClass={activeZoneClass}
          onSelectZoneClass={setActiveZoneClass}
          localModelLoaded={gamaModelText.trim().length > 0}
          localModelLineCount={gamaModelText.split('\n').length}
        />
      </div>
      <PolicyImportModal
        open={policyModalOpen}
        analysis={policyAnalysis}
        analyzing={policyAnalyzing}
        error={policyError}
        policyApplied={policyApplied}
        onClose={() => setPolicyModalOpen(false)}
        onUpload={handleUploadPolicyFile}
        onApply={handleApplyPolicy}
        onRevert={handleRevertPolicy}
      />
    </div>
  );
}

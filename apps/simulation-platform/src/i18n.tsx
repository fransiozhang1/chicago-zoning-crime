import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Language = 'zh' | 'en';

// ── Translation dictionaries ──────────────────────────────────
type Translations = Record<string, string | Record<string, unknown>>;

const translations: Record<Language, Translations> = {
  zh: {
    app: {
      title: '芝加哥街区治安数字孪生平台',
      subtitle: 'PARAMETRIC ENVIRONMENT & MULTI-AGENT PROJECTION',
      toggleMenu: '切换菜单',
      toggleLang: '切换语言',
    },
    map: {
      title: 'GIS SPATIAL MONITOR / 芝加哥街区孪生仿真网格',
    },
    engine: {
      status: '引擎状态',
      active: '活跃中',
      fps: 'FPS: 60 / 实时',
      start: '启动引擎',
      pause: '暂停引擎',
      reset: '重置配置',
      rate: '倍率',
    },
    sections: {
      zoning: '1. ZONING CONTROL / 分区建筑控制',
      illumination: '2. ILLUMINATION & CANOPY / 照度与树木遮蔽',
      spatial: '3. SPATIAL INDICATORS / 9大环境指标',
      gama: '4. GAMA PLATFORM ABM / 主体行为仿真',
      weights: '5. REVERSE RISK WEIGHTS / 反推特征权重',
    },
    zoning: {
      far: '容积率 (FAR)',
      farSub: 'Floor Area Ratio',
      height: '建筑高度 (ft)',
      heightSub: 'Max Height',
      lotArea: '最小地块面积 (sqft)',
      setback: '前退距 (ft)',
      setbackSub: 'Front Setback',
      parking: '停车位需求',
      parkingSub: 'Parking / Unit',
      usePerms: '使用许可',
      yesRes: '✓ 住宅',
      noRes: '✗ 住宅',
      yesCom: '✓ 商业',
      noCom: '✗ 商业',
      yesMixed: '✓ 混合用途',
      noMixed: '✗ 混合用途',
      siteDesign: '场地设计',
      yesGreen: '✓ 绿化带',
      noGreen: '✗ 绿化带',
      yesBuffer: '✓ 缓冲带',
      noBuffer: '✗ 缓冲带',
      yesParking: '✓ 独立停车场',
      noParking: '✗ 独立停车场',
      noConfig: '无可用分区配置',
    },
    illumination: {
      lightDensity: '路灯架设分布密度',
      lightFailure: '路灯损坏故障率',
      treeDensity: '绿植树木种植总量',
      treeCount: '棵',
      treeCanopy: '树木冠幅尺度 (视线荫蔽度)',
    },
    gama: {
      engine: '仿真引擎: GAMA Multi-Agent Platform',
      modelLoaded: '已载入',
      modelMissing: '未找到',
      modelPath: '本地模型路径',
      localModelInfo: '已导入本地 GAMA 模型（{lineCount} 行）。浏览器当前直接运行主体仿真，无需 Docker 或 WebSocket 后端。',
      clock: '数字孪生时钟 (24H 昼夜演变)',
      flowTitle: 'GAMA ABM 24H Spawning Flow Profile / 主体流动曲线',
      spawnRate: '主体流动频次 (Spawn Rate)',
      criminalRatio: '高危安全隐患主体占比 (Risk Agent Ratio)',
    },
    spatial: {
      status: 'STATUS: ACTIVE',
      expand: '展开 9 大指标',
      collapse: '收起 9 大指标',
      points: 'POINTS',
      importLabel: '导入指标数据 (4207_indices - 9features.csv)',
    },
    visibility: {
      pastCrimes: '显示过往犯罪地点 (Show Past Crimes)',
      indicators: '显示9大环境空间指标 (Show Spatial Indicators)',
      heatmap: '显示实时热力图 (Show Risk Heatmap)',
      visionCones: '显示主体视线波束 (Show Vision Cones)',
      opacity: '热力图覆盖不透明度',
      hidePastCrimes: '隐藏图上犯罪点',
      hiddenPastCrimes: '显示图上犯罪点',
    },
    weights: {
      importHint: '支持实时微调反推权重或直接导入.csv格式配置文件，以即时重构风险预测。',
      importCsv: '导入 CSV',
      exportCsv: '导出 CSV',
    },
    policy: {
      open: '打开政策导入',
      short: '政策',
      title: '政策文件导入',
      subtitle: '上传 PDF 并提取可写回当前分区菜单的政策参数',
      upload: '上传政策 PDF 或情景 JSON',
      analyzing: '解析中...',
      helper: '导入政策 PDF 可检查 RT-4 / ADU 条文，也可导入带出处的 RAG 情景 JSON。确认后才会应用参数。',
      revertBeforeUpload: '请先撤销当前政策，再导入新的文件。',
      file: '文件',
      targetZone: '目标分区',
      matched: '识别条款',
      applicable: '可应用参数',
      applicableList: '可直接写回菜单的参数',
      referenceOnly: '仅作参考的政策条款',
      noApplicable: '文档已识别，但没有找到能够直接映射到当前菜单控件的参数。',
      emptyTitle: '还没有上传政策文件',
      emptyDesc: '选择一个 PDF 后，系统会自动提取文中与 RT-4 菜单参数相关的政策变化。',
      apply: '确认更改',
      revert: '取消政策变化',
      appliedHint: '当前政策改动已应用到 RT-4 菜单参数，可随时撤销。',
      pendingHint: '解析完成后，点击确认更改即可把识别结果写回菜单。',
      parseError: 'PDF 解析失败，请确认文件内容可复制或不是扫描图片版。',
    },
    cad: {
      export: '导出街区 CAD',
      short: 'CAD',
    },
    weightsMeta: {
      light: {
        name: '夜间照明照度阻断比率',
        short: '夜间照明照度',
        description: '路灯照度辐射范围对犯罪行为的物理遏制系数。',
      },
      bystander: {
        name: '旁观居民监视威慑系数',
        short: '旁观居民监视威慑',
        description: '行人群体中合法居民视线（Eyes on the Street）投射的群防群治震慑度。',
      },
      criminal: {
        name: '罪犯侦查窥视死角增益',
        short: '罪犯侦查窥视死角增益',
        description: '罪犯视线全覆盖但缺乏旁观者注视时的窥害乘积。',
      },
      tree: {
        name: '密集绿植投影暗室掩护率',
        short: '密集绿植',
        description: '密集树木冠层及荫蔽处为罪犯提供的隐藏和潜伏逃逸增量。',
      },
      density: {
        name: '空间建筑盲区物理聚集率',
        short: '空间建筑盲区',
        description: '建筑高耸与高密度造成的小路、死角及视觉死角形成概率。',
      },
    },
    indicesMeta: {
      NSI: {
        name: '自然监视',
        description: '街道沿线合法视线对公共空间的被动监视密度。',
      },
      SAI: {
        name: '街道活动',
        description: '公共空间中行人和经济活动的聚集频次。',
      },
      SEI: {
        name: '围合度',
        description: '建筑高度与街道宽度比形成的物理围合感。',
      },
      GEI: {
        name: '绿化暴露',
        description: '植被冠层在街景中的视觉占比。',
      },
      VDI: {
        name: '车辆主导',
        description: '车行道宽度与车速对步行环境的压制程度。',
      },
      WI: {
        name: '步行性',
        description: '人行道宽度、过街设施与街道连续性的综合得分。',
      },
      TI: {
        name: '领域性',
        description: '建筑临街面、栅栏、标识等对空间主权的暗示强度。',
      },
      TCI: {
        name: '交通控制',
        description: '信号灯、减速带、斑马线等交通约束设施的密度。',
      },
      DI: {
        name: '失序度',
        description: '涂鸦、垃圾、破损设施等物理失序现象的严重程度。',
      },
      LUM: {
        name: '夜间公共照明度',
        description: '结合自然监视与街景可视性估计的照明覆盖强度。',
      },
      GRN: {
        name: '密集绿植投影',
        description: '由绿化暴露、步行环境与冠层遮蔽共同推导的树木适宜性。',
      },
      DEN: {
        name: '微观建筑盲区',
        description: '由街道围合、车辆主导与失序程度共同推导的建筑密度压力。',
      },
      EYE: {
        name: '街道旁观监视',
        description: '来自自然监视与街景可见度的街面观察强度。',
      },
      OPN: {
        name: '空间视线通透',
        description: '由街道围合反推的视觉通透程度。',
      },
      ACT: {
        name: '街道动态活力',
        description: '基于街道活动与步行性记录的空间流动活跃度。',
      },
      INF: {
        name: '基建完好程度',
        description: '基于交通控制、路灯状态与街景密度推导的基础设施健康度。',
      },
      HIS: {
        name: '历史犯罪频次',
        description: '基于失序度与历史风险关联推导的犯罪记忆强度。',
      },
      SEC: {
        name: '安防监控覆盖',
        description: '基于领域性与监视强度推导的安防覆盖率。',
      },
    },
    stats: {
      collapsed: '查看仿真分析结果',
      results: 'SIM RESULTS / 仿真结果评估',
      safety: 'SAFETY RATING / 治安评分',
      score: '得分',
      avgRisk: '平均犯罪风险',
      agents: '活动流出 居民/罪犯',
      lights: '路灯运转率 (故障)',
      brokenUnit: '盏',
      hotspots: '治安隐患点',
      unit: '个',
      influence: 'INFLUENCE / 风险特征因子占比',
      verdictHigh: '安全等级：高 (SECURE)',
      verdictHighDesc: '街区照度极佳，居民视线网密布，犯罪死角较少。',
      verdictMed: '安全等级：中 (MODERATE)',
      verdictMedDesc: '存在部分照明缺失或树木过密导致的盲区，建议维护路灯。',
      verdictLow: '安全等级：低 (HIGH RISK)',
      verdictLowDesc: '大面积处于暗淡无光、合法流出人流疏松状态，极易诱发犯罪。',
    },
    mobile: {
      tabs: { stats: '仿真结果', zoning: '分区控制', agent: '主体仿真', layers: '图层显示' },
      safetyScore: '公共安全评分',
      riskLevel: '风险等级',
      safetyHigh: '安全',
      safetyMed: '中等',
      safetyLow: '危险',
      avgRisk: '平均风险',
      agents: '居民/罪犯',
      lights: '路灯运行率',
      riskFactor: '风险因子贡献',
      noConfig: '无可用分区配置',
      usePerms: '使用许可',
      siteDesign: '场地设计',
      yesRes: '✓ 住宅', noRes: '✗ 住宅',
      yesCom: '✓ 商业', noCom: '✗ 商业',
      yesMixed: '✓ 混合用途', noMixed: '✗ 混合用途',
      yesGreen: '✓ 绿化带', noGreen: '✗ 绿化带',
      yesBuffer: '✓ 缓冲带', noBuffer: '✗ 缓冲带',
      yesParking: '✓ 独立停车场', noParking: '✗ 独立停车场',
      pause: '暂停', start: '启动引擎',
      simClock: '仿真时钟',
      spawnRate: '生成速率',
      criminalRatio: '罪犯比率',
      zoningLabels: {
        far: '容积率 FAR', height: '建筑高度', lotArea: '地块面积',
        setback: '前退距离', parking: '停车位需求',
      },
      layers: {
        pastCrimes: '历史犯罪标记', heatmap: '实时风险热力图',
        visionCones: '主体视线波束', envIndices: '环境空间指标',
        heatmapOpacity: '热力图不透明度',
      },
    },
    legend: {
      residential: '住宅 (R)', business: '商业 (B)', mixed: '混合 (C)',
      residents: '居民', criminals: '罪犯', trees: '树木',
      lightsOn: '路灯 (开)', lightsFault: '路灯 (坏)',
      pastCrimes: '历史案发地点', hazardPoints: '实时隐患点',
      safe: '安全', risk: '隐患',
    },
    report: {
      title: '全天安全评估报告',
      runningInit: '初始化主体...',
      runningPatrol: '00:00 开始全天巡逻...',
      runningActive: '{hh}:00 — {count} 主体活跃中',
      runningAnalyze: '分析数据中...',
      runningDone: '报告生成完毕',
      verdict: '判定结论',
      avgScore: '全天平均安全评分',
      peakRisk: '峰值风险指数',
      worstHour: '最危险时间',
      safestHour: '最安全时间',
      nightWarning: '夜间（20:00–05:00）风险显著高于白天，建议针对性加强夜防措施',
      trend: '24小时安全趋势',
      safetyScore: '安全评分',
      riskLevel: '风险水平',
      dangerZones: '重复高危区 TOP {count}',
      zoneHighRisk: '高风险',
      zoneMediumRisk: '中风险',
      light: '照明:',
      surveillance: '监视:',
      blindSpot: '死角:',
      active: '活跃: ',
      suggestions: '参数优化建议',
      reRun: '重新评估',
      close: '关闭报告',
      verdictSafe: '整体安全可控',
      verdictModerate: '存在中等风险，建议优化',
      verdictDangerous: '高风险区域占比显著，强烈建议调整参数',
      sugNightRisk: '夜间风险显著偏高',
      sugNightRiskDesc: '模拟显示 20:00–05:00 安全评分均值显著低于白天时段。{worstInfo}建议在夜间提高路灯密度并增加居民活动。',
      sugLighting: '增强夜间照明覆盖',
      sugLightingDesc: 'Top {count} 高危区域平均照明仅 {illumPct}%。{reason} 建议将路灯密度从 {current}x 提至 {target}x{failureNote}。',
      sugLightingReason1: '夜间（20:00-05:00）风险显著上升，光线不足是主要因素。',
      sugLightingReason2: '多处建筑遮挡降低了路灯有效辐射范围。',
      sugFailureRate: '降低路灯故障率',
      sugFailureRateDesc: '当前故障率 {current}%，模拟中发现 {brokenPct}% 的路灯处于损坏状态，在高危区域形成连续暗区。',
      sugTree: '优化植被配置',
      sugTreeDesc: '树木密度 {current} 棵与低照明叠加形成视觉盲区。建议减至 {target} 棵，或缩小冠层系数以降低掩护效果。',
      sugBystander: '增强公共监视覆盖',
      sugBystanderDesc: '高危区旁观监视指数仅 {bystPct}%（正常应 > 60%）。提升生成速率可增加合法居民流量，天然抑制犯罪机会。',
      sugCriminal: '降低犯罪主体密度',
      sugCriminalDesc: '罪犯视野死角增益平均 {crimPct}%，远超安全阈值。建议将罪犯比例从 {current}% 降至 {target}%，模拟增加警力巡逻的效果。',
      sugNoIssues: '当前参数配置良好',
      sugNoIssuesDesc: '全天安全评分均值 {avgScore}，峰值风险 {peakRisk}%。各时段风险均匀可控。如需进一步优化，可微调路灯密度或主体生成速率。',
      sugWithFailure: '，同时将故障率从 {current}% 降至 {target}%',
      worstAt: '尤其 {hour}:00 是全天最危险时刻（风险 {risk}%）',
    },
  },
  en: {
    app: {
      title: 'CHICAGO URBAN SAFETY TWIN',
      subtitle: 'PARAMETRIC ENVIRONMENT & MULTI-AGENT PROJECTION',
      toggleMenu: 'Toggle menu',
      toggleLang: 'Switch language',
    },
    map: {
      title: 'GIS SPATIAL MONITOR / Chicago Urban Safety Digital Twin',
    },
    engine: {
      status: 'Engine',
      active: 'ACTIVE',
      fps: 'FPS: 60 / REAL-TIME',
      start: 'START ENGINE',
      pause: 'PAUSE ENGINE',
      reset: 'RESET CONFIG',
      rate: 'RATE',
    },
    sections: {
      zoning: '1. ZONING CONTROL / 分区建筑控制',
      illumination: '2. ILLUMINATION & CANOPY / 照度与树木遮蔽',
      spatial: '3. SPATIAL INDICATORS / 9 Environmental Indicators',
      gama: '4. GAMA PLATFORM ABM / Multi-Agent Simulation',
      weights: '5. REVERSE RISK WEIGHTS / Inverse Feature Weights',
    },
    zoning: {
      far: 'FAR (Floor Area Ratio)',
      farSub: 'Floor Area Ratio',
      height: 'Max Height (ft)',
      heightSub: 'Max Height',
      lotArea: 'Min Lot Area (sqft)',
      setback: 'Front Setback (ft)',
      setbackSub: 'Front Setback',
      parking: 'Parking / Unit',
      parkingSub: 'Parking / Unit',
      usePerms: 'USE PERMISSIONS',
      yesRes: '✓ Residential',
      noRes: '✗ Residential',
      yesCom: '✓ Commercial',
      noCom: '✗ Commercial',
      yesMixed: '✓ Mixed-Use',
      noMixed: '✗ Mixed-Use',
      siteDesign: 'SITE DESIGN',
      yesGreen: '✓ Landscaping',
      noGreen: '✗ Landscaping',
      yesBuffer: '✓ Buffer Zone',
      noBuffer: '✗ Buffer Zone',
      yesParking: '✓ Standalone Parking',
      noParking: '✗ Standalone Parking',
      noConfig: 'No zone configuration available',
    },
    illumination: {
      lightDensity: 'Streetlight Density',
      lightFailure: 'Light Failure Rate',
      treeDensity: 'Tree Count',
      treeCount: 'trees',
      treeCanopy: 'Tree Canopy Scale (Visual Shelter)',
    },
    gama: {
      engine: 'Engine: GAMA Multi-Agent Platform',
      modelLoaded: 'loaded',
      modelMissing: 'missing',
      modelPath: 'Local model path',
      localModelInfo: 'Local GAMA model imported ({lineCount} lines). The browser now runs the agent simulation directly without Docker or a WebSocket backend.',
      clock: 'Digital Twin Clock (24H Day/Night)',
      flowTitle: 'GAMA ABM 24H Spawning Flow Profile',
      spawnRate: 'Spawn Rate (Agent Flow)',
      criminalRatio: 'Risk Agent Ratio (Criminal Share)',
    },
    spatial: {
      status: 'STATUS: ACTIVE',
      expand: 'Expand 9 Indicators',
      collapse: 'Collapse 9 Indicators',
      points: 'POINTS',
      importLabel: 'Import Indicator Data (4207_indices - 9features.csv)',
    },
    visibility: {
      pastCrimes: 'Show Past Crimes',
      indicators: 'Show 9 Spatial Indicators',
      heatmap: 'Show Real-time Risk Heatmap',
      visionCones: 'Show Agent Vision Cones',
      opacity: 'Heatmap Opacity',
      hidePastCrimes: 'Hide Crime Markers',
      hiddenPastCrimes: 'Show Crime Markers',
    },
    weights: {
      importHint: 'Fine-tune inverse weights or import .csv config to instantly reconstruct risk predictions.',
      importCsv: 'IMPORT CSV',
      exportCsv: 'EXPORT CSV',
    },
    policy: {
      open: 'Open policy import',
      short: 'Policy',
      title: 'Policy File Import',
      subtitle: 'Upload a PDF and extract policy parameters that can be written back to the zoning menu.',
      upload: 'Upload policy PDF or scenario JSON',
      analyzing: 'Analyzing...',
      helper: 'Check RT-4 / ADU clauses from a policy PDF or load a cited RAG scenario JSON. Review the changes before applying them.',
      revertBeforeUpload: 'Revert the current policy to import another file.',
      file: 'File',
      targetZone: 'Target Zone',
      matched: 'Matched Rules',
      applicable: 'Applicable Fields',
      applicableList: 'Parameters That Can Be Applied',
      referenceOnly: 'Reference-Only Findings',
      noApplicable: 'The document was recognized, but no directly mappable menu parameters were found.',
      emptyTitle: 'No policy file uploaded yet',
      emptyDesc: 'Choose a PDF and the system will extract policy changes related to RT-4 menu parameters.',
      apply: 'Apply Changes',
      revert: 'Revert Policy',
      appliedHint: 'Policy overrides are currently applied to the RT-4 zoning controls and can be reverted at any time.',
      pendingHint: 'After parsing finishes, apply the recognized values to update the zoning menu.',
      parseError: 'PDF parsing failed. Please confirm the document contains selectable text and is not only scanned images.',
    },
    cad: {
      export: 'Export Block CAD',
      short: 'CAD',
    },
    weightsMeta: {
      light: {
        name: 'Night Lighting Suppression Factor',
        short: 'Night Lighting',
        description: 'The physical deterrence coefficient created by streetlight coverage against criminal behavior.',
      },
      bystander: {
        name: 'Bystander Surveillance Deterrence',
        short: 'Bystander Surveillance',
        description: 'The deterrence effect generated by legitimate residents projecting Eyes on the Street.',
      },
      criminal: {
        name: 'Criminal Blind-Spot Recon Gain',
        short: 'Criminal Blind-Spot Gain',
        description: 'The predatory multiplier when offenders can fully scout space without bystander attention.',
      },
      tree: {
        name: 'Dense Canopy Concealment Rate',
        short: 'Dense Canopy',
        description: 'The added concealment and escape cover supplied by dense tree canopy and shaded pockets.',
      },
      density: {
        name: 'Built-Form Blind-Spot Density',
        short: 'Built-Form Blind Spots',
        description: 'The likelihood of alleys, dead corners, and visual blind spots caused by taller and denser buildings.',
      },
    },
    indicesMeta: {
      NSI: {
        name: 'Natural Surveillance',
        description: 'Passive monitoring density created by legitimate sightlines along the street edge.',
      },
      SAI: {
        name: 'Street Activity',
        description: 'The concentration frequency of pedestrians and economic activity in public space.',
      },
      SEI: {
        name: 'Street Enclosure',
        description: 'The sense of enclosure formed by the ratio between building height and street width.',
      },
      GEI: {
        name: 'Green Exposure',
        description: 'The visual share of vegetation canopy within the streetscape.',
      },
      VDI: {
        name: 'Vehicle Dominance',
        description: 'The degree to which carriageway width and vehicle speed suppress walkability.',
      },
      WI: {
        name: 'Walkability',
        description: 'A composite score of sidewalk width, crossing facilities, and street continuity.',
      },
      TI: {
        name: 'Territoriality',
        description: 'The strength of ownership cues conveyed by facades, fences, and signage.',
      },
      TCI: {
        name: 'Traffic Control',
        description: 'The density of signals, speed humps, crosswalks, and related traffic-calming elements.',
      },
      DI: {
        name: 'Disorder',
        description: 'The severity of physical disorder such as graffiti, litter, and damaged infrastructure.',
      },
      LUM: {
        name: 'Night Public Lighting',
        description: 'Estimated lighting coverage intensity derived from natural surveillance and streetscape visibility.',
      },
      GRN: {
        name: 'Dense Green Canopy',
        description: 'Tree suitability inferred from greenery exposure, walkability, and canopy shelter.',
      },
      DEN: {
        name: 'Micro Building Blind Spots',
        description: 'Built-density pressure derived from street enclosure, vehicle dominance, and disorder.',
      },
      EYE: {
        name: 'Street Bystander Surveillance',
        description: 'Street-level observation intensity from natural surveillance and streetscape visibility.',
      },
      OPN: {
        name: 'Spatial Openness',
        description: 'Visual openness inferred from the inverse of street enclosure.',
      },
      ACT: {
        name: 'Street Activity Vitality',
        description: 'Spatial flow intensity based on street activity and walkability records.',
      },
      INF: {
        name: 'Infrastructure Integrity',
        description: 'Infrastructure health inferred from traffic control, streetlight status, and streetscape density.',
      },
      HIS: {
        name: 'Historical Crime Frequency',
        description: 'Crime-memory intensity inferred from disorder and historical risk relationships.',
      },
      SEC: {
        name: 'Security Coverage',
        description: 'Security coverage inferred from territoriality and surveillance intensity.',
      },
    },
    stats: {
      collapsed: 'View Simulation Results',
      results: 'SIM RESULTS / Simulation Assessment',
      safety: 'SAFETY RATING / Public Safety Score',
      score: 'SCORE',
      avgRisk: 'Avg Crime Risk',
      agents: 'Agents Resident/Criminal',
      lights: 'Light Operability (Broken)',
      brokenUnit: 'broken',
      hotspots: 'Hotspots',
      unit: 'spots',
      influence: 'INFLUENCE / Risk Factor Contribution',
      verdictHigh: 'Safety: HIGH (SECURE)',
      verdictHighDesc: 'Excellent street illumination, dense resident surveillance network, very few blind spots.',
      verdictMed: 'Safety: MODERATE',
      verdictMedDesc: 'Partial lighting gaps or dense tree canopy create some blind spots. Recommend lamp maintenance.',
      verdictLow: 'Safety: LOW (HIGH RISK)',
      verdictLowDesc: 'Large dark areas with sparse pedestrian flow. Highly prone to criminal activity.',
    },
    mobile: {
      tabs: { stats: 'Results', zoning: 'Zoning', agent: 'Simulation', layers: 'Layers' },
      safetyScore: 'Public Safety Score',
      riskLevel: 'Risk Level',
      safetyHigh: 'Safe',
      safetyMed: 'Moderate',
      safetyLow: 'Danger',
      avgRisk: 'Avg Risk',
      agents: 'Residents/Criminals',
      lights: 'Lights',
      riskFactor: 'Risk Factors',
      noConfig: 'No configuration',
      usePerms: 'Use Permits',
      siteDesign: 'Site Design',
      yesRes: '✓ Residential', noRes: '✗ Residential',
      yesCom: '✓ Commercial', noCom: '✗ Commercial',
      yesMixed: '✓ Mixed Use', noMixed: '✗ Mixed Use',
      yesGreen: '✓ Greenery', noGreen: '✗ Greenery',
      yesBuffer: '✓ Buffer Zone', noBuffer: '✗ Buffer Zone',
      yesParking: '✓ Parking Lot', noParking: '✗ Parking Lot',
      pause: 'Pause', start: 'Start Engine',
      simClock: 'Sim Clock',
      spawnRate: 'Spawn Rate',
      criminalRatio: 'Criminal Ratio',
      zoningLabels: {
        far: 'FAR', height: 'Max Height', lotArea: 'Min Lot Area',
        setback: 'Front Setback', parking: 'Parking Req.',
      },
      layers: {
        pastCrimes: 'Past Crime Markers', heatmap: 'Risk Heatmap',
        visionCones: 'Agent Vision Cones', envIndices: 'Spatial Indicators',
        heatmapOpacity: 'Heatmap Opacity',
      },
    },
    legend: {
      residential: 'Residential (R)', business: 'Business (B)', mixed: 'Mixed (C)',
      residents: 'Residents', criminals: 'Criminals', trees: 'Trees',
      lightsOn: 'Lights (ON)', lightsFault: 'Lights (Fault)',
      pastCrimes: 'Past Crimes', hazardPoints: 'Hazard Points',
      safe: 'Safe', risk: 'Risk',
    },
    report: {
      title: '24H Safety Assessment Report',
      runningInit: 'Initializing agents...',
      runningPatrol: '00:00 Starting patrol...',
      runningActive: '{hh}:00 — {count} agents active',
      runningAnalyze: 'Analyzing data...',
      runningDone: 'Report ready',
      verdict: 'Verdict',
      avgScore: '24H Avg Safety Score',
      peakRisk: 'Peak Risk Index',
      worstHour: 'Most Dangerous Hour',
      safestHour: 'Safest Hour',
      nightWarning: 'Nighttime (20:00–05:00) risk is significantly higher than daytime. Targeted nighttime measures recommended.',
      trend: '24H Safety Trend',
      safetyScore: 'Safety Score',
      riskLevel: 'Risk Level',
      dangerZones: 'Recurring Danger Zones TOP {count}',
      zoneHighRisk: 'High Risk',
      zoneMediumRisk: 'Medium Risk',
      light: 'Light:',
      surveillance: 'Surv:',
      blindSpot: 'Blind:',
      active: 'Active: ',
      suggestions: 'Parameter Suggestions',
      reRun: 'Re-evaluate',
      close: 'Close Report',
      verdictSafe: 'Overall safe and controlled',
      verdictModerate: 'Moderate risk present, optimization recommended',
      verdictDangerous: 'High-risk zones significant, strongly recommend parameter adjustment',
      sugNightRisk: 'Nighttime Risk Elevated',
      sugNightRiskDesc: 'The simulation shows significantly lower average safety scores during 20:00–05:00 compared to daytime. {worstInfo}Increase streetlight density and resident activity at night.',
      sugLighting: 'Improve Nighttime Lighting Coverage',
      sugLightingDesc: 'Top {count} danger zones average only {illumPct}% illumination. {reason} Increase streetlight density from {current}x to {target}x{failureNote}.',
      sugLightingReason1: 'Risk rises significantly at night (20:00–05:00). Insufficient lighting is the primary factor.',
      sugLightingReason2: 'Building obstructions reduce effective streetlight coverage.',
      sugFailureRate: 'Reduce Streetlight Failure Rate',
      sugFailureRateDesc: 'Current failure rate is {current}%. Simulation found {brokenPct}% of streetlights are broken, forming continuous dark zones in danger areas.',
      sugTree: 'Optimize Tree Configuration',
      sugTreeDesc: 'Tree density of {current} combined with low lighting creates visual blind spots. Reduce to {target} or shrink canopy coefficient to minimize concealment.',
      sugBystander: 'Increase Public Surveillance',
      sugBystanderDesc: 'Bystander surveillance index in danger zones is only {bystPct}% (normal > 60%). Increasing spawn rate adds legitimate pedestrian flow, naturally discouraging crime.',
      sugCriminal: 'Reduce Criminal Agent Density',
      sugCriminalDesc: 'Criminal blind-spot gain averages {crimPct}%, far exceeding safety threshold. Reduce criminal ratio from {current}% to {target}% to simulate increased police patrols.',
      sugNoIssues: 'Current Parameters Are Good',
      sugNoIssuesDesc: '24H average safety score is {avgScore}, peak risk {peakRisk}%. Risk is evenly managed across all time periods. Fine-tune streetlight density or spawn rate for further optimization.',
      sugWithFailure: ', and reduce failure rate from {current}% to {target}%',
      worstAt: '{hour}:00 is the most dangerous hour (risk {risk}%)',
    },
  },
};

// ── Context ──────────────────────────────────────────────────
interface LanguageContextValue {
  language: Language;
  toggleLanguage: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'zh',
  toggleLanguage: () => {},
  t: (key: string) => key,
});

// ── t() helper ───────────────────────────────────────────────
function resolveTranslation(dict: Translations, key: string): string {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = dict;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key;
    current = current[part];
  }
  return typeof current === 'string' ? current : key;
}

// ── Provider ─────────────────────────────────────────────────
const STORAGE_KEY = 'crime-sim-lang';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'zh') return stored;
    } catch { /* localStorage unavailable */ }
    return 'zh';
  });

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => {
      const next: Language = prev === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const dict = translations[language];
    const template = resolveTranslation(dict, key);
    if (!vars) return template;

    return Object.entries(vars).reduce((result, [name, value]) => {
      return result.replaceAll(`{${name}}`, String(value));
    }, template);
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────
export function useLanguage() {
  return useContext(LanguageContext);
}

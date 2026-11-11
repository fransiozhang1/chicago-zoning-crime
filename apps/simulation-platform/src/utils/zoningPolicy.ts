import { ZONING_CONFIG, ZoneConfigEntry } from '../constants/zoningConfig';

type PolicyActionKind = 'setNumber' | 'setBoolean';

interface PolicyExtractionRule {
  id: string;
  paramName: string;
  legalRef: string;
  modifiedValue: string;
  keywords: string[];
  note?: string;
  applicableField?: keyof ZoneConfigEntry;
  applicableLabel?: string;
  actionKind?: PolicyActionKind;
  actionValue?: number | boolean;
  descField?: keyof ZoneConfigEntry;
  descValue?: string;
}

export interface ApplicablePolicyChange {
  id: string;
  field: keyof ZoneConfigEntry;
  label: string;
  legalRef: string;
  note: string;
  originalValue: string;
  parsedValue: string;
  actionKind: PolicyActionKind;
  actionValue: number | boolean;
  descField?: keyof ZoneConfigEntry;
  descValue?: string;
}

export interface InformationalPolicyFinding {
  id: string;
  paramName: string;
  legalRef: string;
  parsedValue: string;
  note: string;
}

export interface ZoningPolicyAnalysis {
  fileName: string;
  documentChars: number;
  targetZoneClass: string;
  matchedRuleCount: number;
  applicableChanges: ApplicablePolicyChange[];
  informationalFindings: InformationalPolicyFinding[];
}

const POLICY_RULES: PolicyExtractionRule[] = [
  {
    id: 'conversion-unit-min-lot-waiver',
    paramName: '转换单元 - 最小地块面积要求',
    legalRef: '17-9-0131(4)',
    modifiedValue: '不适用（豁免）',
    keywords: ['17-9-0131', 'minimum lot area'],
    note: '该条例允许在 ADU 允许区域内豁免最小地块面积要求。',
    applicableField: 'min_lot_area_raw',
    applicableLabel: '最小地块面积 (Min Lot Area)',
    actionKind: 'setNumber',
    actionValue: 0,
    descField: 'min_lot_area_desc',
    descValue: 'Policy override: waived by ADU ordinance',
  },
  {
    id: 'coach-house-height',
    paramName: 'Coach House 最大建筑高度',
    legalRef: '17-9-0201-F(5)',
    modifiedValue: '22 英尺 (约 6.7 米)',
    keywords: ['17-9-0201-F', '22 feet', 'height'],
    note: '条例明确给出 ADU / Coach House 的高度上限。',
    applicableField: 'max_height_raw',
    applicableLabel: '建筑高度 (Max Height)',
    actionKind: 'setNumber',
    actionValue: 22,
    descField: 'max_height_desc',
    descValue: 'Policy override: 22 feet ADU limit',
  },
  {
    id: 'coach-house-far-waiver',
    paramName: 'Coach House - 容积率 (FAR) 要求',
    legalRef: '17-9-0201-F(12)',
    modifiedValue: '不适用（豁免）',
    keywords: ['17-9-0201-F', 'floor area ratio', '17-2-0304-A'],
    note: '该政策对 Coach House 的 FAR 要求提供豁免。',
    applicableField: 'max_far_raw',
    applicableLabel: '容积率 (FAR)',
    actionKind: 'setNumber',
    actionValue: 0,
    descField: 'max_far_desc',
    descValue: 'Policy override: FAR waived by ADU ordinance',
  },
  {
    id: 'conversion-unit-parking-waiver',
    paramName: '转换单元 - 附属停车要求',
    legalRef: '17-9-0131(6)',
    modifiedValue: '可不设附属停车位',
    keywords: ['17-9-0131', 'without', 'parking'],
    note: '该条例允许不再为 ADU 额外配置附属停车位。',
    applicableField: 'parking_requirement_num',
    applicableLabel: '停车位需求 (Parking / Unit)',
    actionKind: 'setNumber',
    actionValue: 0,
    descField: 'parking_req_desc',
    descValue: 'Policy override: no accessory parking required',
  },
  {
    id: 'coach-house-min-lot-waiver',
    paramName: 'Coach House - 最小地块面积要求',
    legalRef: '17-9-0201-F(10)',
    modifiedValue: '不适用（豁免）',
    keywords: ['17-9-0201-F', 'minimum lot area', 'RS2', 'RS3', 'RT', 'RM'],
    note: 'Coach House 同样豁免最小地块面积限制。',
  },
  {
    id: 'conversion-unit-permitted',
    paramName: 'Conversion Unit 使用许可',
    legalRef: '17-2-0207 Use Table',
    modifiedValue: '允许 (Permitted by Right)',
    keywords: ['17-2-0207', 'Conversion Unit', 'Additional Dwelling Unit-Allowed Areas'],
    note: '现有菜单没有独立的 ADU 使用许可开关，因此只保留为参考信息。',
  },
  {
    id: 'coach-house-permitted',
    paramName: 'Coach House 使用许可',
    legalRef: '17-2-0207 Use Table',
    modifiedValue: '允许 (Permitted by Right)',
    keywords: ['17-2-0207', 'Coach House', 'Additional Dwelling Unit-Allowed Areas'],
    note: '现有菜单没有独立的 Coach House 使用许可开关，因此只保留为参考信息。',
  },
  {
    id: 'coach-house-separation',
    paramName: 'Coach House 与主建筑最小间距',
    legalRef: '17-9-0201-F(8)',
    modifiedValue: '主建筑后墙到 Coach House 前墙 ≥15 英尺',
    keywords: ['17-9-0201-F', '15 feet', 'separation'],
    note: '当前菜单没有对应“主楼与附属建筑间距”的控件，因此只作为参考显示。',
  },
];

function lower(text: string) {
  return text.toLowerCase();
}

async function extractPdfText(file: File): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ');
    if (text.trim()) pages.push(text);
  }

  return pages.join('\n');
}

function formatZoneValue(zone: ZoneConfigEntry, field: keyof ZoneConfigEntry): string {
  const value = zone[field];
  if (typeof value === 'boolean') return value ? 'Yes / Enabled' : 'No / Disabled';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value ?? '');
}

function buildApplicableChange(rule: PolicyExtractionRule, zone: ZoneConfigEntry): ApplicablePolicyChange | null {
  if (!rule.applicableField || !rule.applicableLabel || !rule.actionKind || typeof rule.actionValue === 'undefined') return null;

  return {
    id: rule.id,
    field: rule.applicableField,
    label: rule.applicableLabel,
    legalRef: rule.legalRef,
    note: rule.note || '',
    originalValue: formatZoneValue(zone, rule.applicableField),
    parsedValue: rule.modifiedValue,
    actionKind: rule.actionKind,
    actionValue: rule.actionValue,
    descField: rule.descField,
    descValue: rule.descValue,
  };
}

export async function analyzeZoningPolicyPdf(file: File, zone: ZoneConfigEntry): Promise<ZoningPolicyAnalysis> {
  const text = await extractPdfText(file);
  const textLower = lower(text);

  const matchedRules = POLICY_RULES.filter(rule => rule.keywords.every(keyword => textLower.includes(lower(keyword))));
  const applicableChanges = matchedRules
    .map(rule => buildApplicableChange(rule, zone))
    .filter((change): change is ApplicablePolicyChange => change !== null);
  const informationalFindings = matchedRules
    .filter(rule => !rule.applicableField)
    .map(rule => ({
      id: rule.id,
      paramName: rule.paramName,
      legalRef: rule.legalRef,
      parsedValue: rule.modifiedValue,
      note: rule.note || '',
    }));

  return {
    fileName: file.name,
    documentChars: text.length,
    targetZoneClass: 'RT-4',
    matchedRuleCount: matchedRules.length,
    applicableChanges,
    informationalFindings,
  };
}

const SCENARIO_FIELDS = {
  max_far: { field: 'max_far_raw', descField: 'max_far_desc', label: 'Maximum floor area ratio', unit: 'ratio', min: 0, max: 10 },
  max_height: { field: 'max_height_raw', descField: 'max_height_desc', label: 'Maximum height', unit: 'ft', min: 20, max: 120 },
  min_lot_area: { field: 'min_lot_area_raw', descField: 'min_lot_area_desc', label: 'Minimum lot area', unit: 'sq ft', min: 0, max: 10000 },
  front_setback: { field: 'front_setback_raw', descField: 'front_setback_desc', label: 'Front setback', unit: 'ft', min: 5, max: 50 },
  parking_requirement: { field: 'parking_requirement_num', descField: 'parking_req_desc', label: 'Parking per dwelling', unit: 'spaces/unit', min: 0, max: 50 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function analyzePolicyFile(
  file: File,
  zones: Record<string, ZoneConfigEntry>,
): Promise<ZoningPolicyAnalysis> {
  if (!file.name.toLowerCase().endsWith('.json')) {
    return analyzeZoningPolicyPdf(file, zones['RT-4'] ?? ZONING_CONFIG['RT-4']);
  }
  if (file.size > 100_000) throw new Error('Scenario file exceeds 100 KB.');
  const text = await file.text();
  const scenario: unknown = JSON.parse(text);
  if (!isRecord(scenario) || scenario.schemaVersion !== 1
      || typeof scenario.zoneClass !== 'string' || !Object.hasOwn(ZONING_CONFIG, scenario.zoneClass)
      || !Array.isArray(scenario.parameters) || !scenario.parameters.length
      || scenario.parameters.length > Object.keys(SCENARIO_FIELDS).length) {
    throw new Error('Invalid scenario format or unsupported zoning district.');
  }
  const zone = zones[scenario.zoneClass] ?? ZONING_CONFIG[scenario.zoneClass];
  const seen = new Set<string>();
  const applicableChanges = scenario.parameters.map((parameter: unknown): ApplicablePolicyChange => {
    if (!isRecord(parameter) || typeof parameter.name !== 'string'
        || !Object.hasOwn(SCENARIO_FIELDS, parameter.name) || seen.has(parameter.name)) {
      throw new Error('Unsupported or repeated scenario parameter.');
    }
    const rule = SCENARIO_FIELDS[parameter.name as keyof typeof SCENARIO_FIELDS];
    const { value, unit, sourceFile, page, evidence } = parameter;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max
        || unit !== rule.unit || typeof sourceFile !== 'string' || !sourceFile.trim()
        || typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1
        || typeof evidence !== 'string' || !evidence.trim()) {
      throw new Error(`${rule.label} requires a cited value in ${rule.unit} within ${rule.min}–${rule.max}.`);
    }
    seen.add(parameter.name);
    const citation = `${sourceFile} · p. ${page}`;
    return {
      id: parameter.name, field: rule.field, label: rule.label,
      legalRef: citation, note: evidence,
      originalValue: formatZoneValue(zone, rule.field), parsedValue: `${value} ${unit}`,
      actionKind: 'setNumber', actionValue: value,
      descField: rule.descField, descValue: `${value} ${unit} · ${citation}`,
    };
  });
  return {
    fileName: file.name, documentChars: text.length, targetZoneClass: scenario.zoneClass,
    matchedRuleCount: applicableChanges.length, applicableChanges, informationalFindings: [],
  };
}

export function applyPolicyChangesToZone(
  zone: ZoneConfigEntry,
  changes: ApplicablePolicyChange[],
): ZoneConfigEntry {
  const nextZone: ZoneConfigEntry = { ...zone };

  for (const change of changes) {
    if (change.actionKind === 'setNumber' && typeof change.actionValue === 'number') {
      (nextZone[change.field] as number) = change.actionValue;
    }
    if (change.actionKind === 'setBoolean' && typeof change.actionValue === 'boolean') {
      (nextZone[change.field] as boolean) = change.actionValue;
    }
    if (change.descField && change.descValue) {
      (nextZone[change.descField] as string | undefined) = change.descValue;
    }
  }

  nextZone.confidence = 'policy-imported';
  return nextZone;
}

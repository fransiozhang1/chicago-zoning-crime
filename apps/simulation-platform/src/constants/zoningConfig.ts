// Auto-generated from tract_4207_zoning_by_class.csv
// Each key is the zone_class code.

export interface ZoneConfigEntry {
  zone_class: string;
  zone_family: 'R' | 'B' | 'C';
  full_name: string;
  area_sqft: number;
  area_share: number;
  max_far_raw: number;
  max_height_raw: number;
  min_lot_area_raw: number;
  lot_area_per_unit_raw: number;
  front_setback_raw: number;
  residential_use_allowed: boolean;
  commercial_use_allowed: boolean;
  manufacturing_use_allowed: boolean;
  residential_mixed: boolean;
  landscaping_required: boolean;
  screening_required: boolean;
  buffer_required: boolean;
  non_accessory_parking_allowed: boolean;
  transparency_requirement: number;
  parking_requirement_num: number;
  max_far_desc: string;
  min_lot_area_desc: string;
  max_height_desc: string;
  front_setback_desc: string;
  parking_req_desc: string;
  landscaping_desc: string;
  screening_desc?: string;
  buffer_desc?: string;
  transparency_desc?: string;
  entrance_req_desc?: string;
  special_use_desc?: string;
  planned_dev_desc?: string;
  residential_desc?: string;
  commercial_desc?: string;
  manufacturing_desc?: string;
  parking_desc?: string;
  lot_area_per_unit_desc?: string;
  allowed_use_status?: string;
  special_use_required?: boolean;
  planned_development_required?: boolean;
  confidence: string;
}

export const ZONING_CONFIG: Record<string, ZoneConfigEntry> = {
  "RT-4": {
    zone_class: "RT-4",
    zone_family: "R",
    full_name: "住宅两户独立 / Residential Two-Flat, Townhouse",
    area_sqft: 5495216.60434,
    area_share: 0.684546,
    max_far_raw: 1.20,
    max_height_raw: 38,
    min_lot_area_raw: 1000,
    lot_area_per_unit_raw: 1000,
    front_setback_raw: 15,
    residential_use_allowed: true,
    commercial_use_allowed: false,
    manufacturing_use_allowed: false,
    residential_mixed: false,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 1.0,
    max_far_desc: "1.20",
    min_lot_area_desc: "1,000",
    lot_area_per_unit_desc: "Dwelling units: 1000, Efficiency units: 1000, SRO units: 500",
    max_height_desc: "38",
    front_setback_desc: "15 feet or 12% of lot depth, whichever is less",
    parking_req_desc: "1 space per unit for first 100 units; 0.60 spaces per unit for all additional units",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60",
    entrance_req_desc: "At least one pedestrian entrance must face a public street",
    confidence: "high"
  },
  "B3-3": {
    zone_class: "B3-3",
    zone_family: "B",
    full_name: "社区商业 / Community Shopping",
    area_sqft: 1508597.23639,
    area_share: 0.187928,
    max_far_raw: 3.0,
    max_height_raw: 50,
    min_lot_area_raw: 2500,
    lot_area_per_unit_raw: 400,
    front_setback_raw: 15,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: true,
    residential_mixed: true,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 1.0,
    max_far_desc: "likely between 3.0 and 4.0",
    min_lot_area_desc: "2500",
    lot_area_per_unit_desc: "400",
    max_height_desc: "50",
    front_setback_desc: "15",
    parking_req_desc: "1 space per unit",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60%",
    entrance_req_desc: "primary entrance door facing the pedestrian street",
    confidence: "high"
  },
  "C1-2": {
    zone_class: "C1-2",
    zone_family: "C",
    full_name: "社区商业混合 / Neighborhood Commercial",
    area_sqft: 832992.7436031,
    area_share: 0.103767,
    max_far_raw: 2.0,
    max_height_raw: 40,
    min_lot_area_raw: 2500,
    lot_area_per_unit_raw: 1700,
    front_setback_raw: 15,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: false,
    residential_mixed: true,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 0,
    max_far_desc: "2.0",
    min_lot_area_desc: "2500",
    lot_area_per_unit_desc: "1700",
    max_height_desc: "40-50",
    front_setback_desc: "15",
    parking_req_desc: "",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60",
    entrance_req_desc: "primary entrance door facing the pedestrian street; corners at pedestrian streets may satisfy",
    confidence: "high"
  },
  "B3-2": {
    zone_class: "B3-2",
    zone_family: "B",
    full_name: "中型商业 / Community Shopping Moderate",
    area_sqft: 143747.833206,
    area_share: 0.017907,
    max_far_raw: 2.0,
    max_height_raw: 50,
    min_lot_area_raw: 2500,
    lot_area_per_unit_raw: 300,
    front_setback_raw: 15,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: true,
    residential_mixed: true,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 1.0,
    max_far_desc: "likely between 2.0 and 3.0",
    min_lot_area_desc: "2500",
    lot_area_per_unit_desc: "likely between 300 and 500 square feet per unit",
    max_height_desc: "50",
    front_setback_desc: "15",
    parking_req_desc: "1 space per unit",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60",
    entrance_req_desc: "primary entrance door facing the pedestrian street",
    confidence: "high"
  },
  "B3-5": {
    zone_class: "B3-5",
    zone_family: "B",
    full_name: "高密商业 / Community Shopping High-Density",
    area_sqft: 24398.2410702,
    area_share: 0.003039,
    max_far_raw: 5.0,
    max_height_raw: 65,
    min_lot_area_raw: 2500,
    lot_area_per_unit_raw: 200,
    front_setback_raw: 15,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: true,
    residential_mixed: true,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 35.0,
    max_far_desc: "5.0",
    min_lot_area_desc: "2500",
    lot_area_per_unit_desc: "200",
    max_height_desc: "(not specified; 65ft estimated from FAR 5.0)",
    front_setback_desc: "15",
    parking_req_desc: "None for first 35,000 sqft or 2x lot area, then 1.33 per 1,000 sqft",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60",
    entrance_req_desc: "primary entrance door facing the pedestrian street",
    confidence: "high"
  },
  "B3-1": {
    zone_class: "B3-1",
    zone_family: "B",
    full_name: "低密商业 / Community Shopping Low-Density",
    area_sqft: 22577.4584972,
    area_share: 0.002813,
    max_far_raw: 1.0,
    max_height_raw: 38,
    min_lot_area_raw: 2500,
    lot_area_per_unit_raw: 400,
    front_setback_raw: 15,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: true,
    residential_mixed: true,
    landscaping_required: true,
    screening_required: true,
    buffer_required: false,
    non_accessory_parking_allowed: false,
    transparency_requirement: 60,
    parking_requirement_num: 1.0,
    max_far_desc: "likely between 1.0 and 2.0",
    min_lot_area_desc: "2500",
    lot_area_per_unit_desc: "likely between 400 and 600 square feet per unit",
    max_height_desc: "38",
    front_setback_desc: "15",
    parking_req_desc: "1 space per unit",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "no",
    transparency_desc: "60",
    entrance_req_desc: "On lots abutting pedestrian streets, primary entrance facing pedestrian street; corner entrances may satisfy",
    confidence: "high"
  },
  "POS-1": {
    zone_class: "POS-1",
    zone_family: "C",
    full_name: "公共开放空间 / Parks & Open Space",
    area_sqft: 10000,
    area_share: 0.001,
    max_far_raw: 1.0,
    max_height_raw: 30,
    min_lot_area_raw: 5000,
    lot_area_per_unit_raw: 2500,
    front_setback_raw: 20,
    residential_use_allowed: false,
    commercial_use_allowed: true,
    manufacturing_use_allowed: false,
    residential_mixed: false,
    landscaping_required: true,
    screening_required: true,
    buffer_required: true,
    non_accessory_parking_allowed: false,
    transparency_requirement: 70,
    parking_requirement_num: 0,
    max_far_desc: "1.0",
    min_lot_area_desc: "5,000",
    lot_area_per_unit_desc: "2,500",
    max_height_desc: "30",
    front_setback_desc: "20",
    parking_req_desc: "None",
    landscaping_desc: "yes",
    screening_desc: "yes",
    buffer_desc: "yes",
    transparency_desc: "70",
    entrance_req_desc: "",
    confidence: "medium"
  }
};

export const ZONE_CLASS_KEYS = Object.keys(ZONING_CONFIG);

export function resolveZoneClass(code: string): string {
  if (!code) return ZONE_CLASS_KEYS[0];
  if (ZONING_CONFIG[code]) return code;
  if (code === 'RT') return 'RT-4';
  if (code === 'B' || code === 'B3') return 'B3-3';
  if (code === 'C' || code === 'C1') return 'C1-2';
  for (const key of ZONE_CLASS_KEYS) {
    if (key.startsWith(code) || code.startsWith(key)) return key;
  }
  return ZONE_CLASS_KEYS[0];
}

"""Rule-based zoning parameter extraction from documents.

Two modes:
  • Legacy (no --zone-classes): full-text parameter mining
  • Targeted (--zone-classes): query only specified ZONE_CLASS values
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None

try:
    from docx import Document
except ImportError:  # pragma: no cover
    Document = None

# ======================================================================
# Constants
# ======================================================================

EXTRACTABLE_EXTENSIONS = {"pdf", "docx", "txt", "csv"}

# --- Legacy output columns  ---------------------------------------
OUTPUT_COLUMNS = [
    "source_file", "source_page", "zoning_district",
    "parameter_name", "parameter_value", "unit",
    "original_text", "confidence",
]

# --- Targeted output columns  -------------------------------------
OUTPUT_COLUMNS_ZC = [
    "source_file", "source_page", "zone_class", "zone_family",
    "parameter_name", "parameter_value", "unit", "value_type",
    "original_text", "confidence", "matched_section",
]

# ======================================================================
# Zone-class stats parser
# ======================================================================

_ZONE_CLASS_LINE = re.compile(
    r"\b([A-Z]+(?:[-.\s]\d+(?:\.\d+)?(?:[-.\s]\d+)?)?)\b"
)
_ZONE_CLASS_FILTER = re.compile(
    r"(?i)^(?:RS|RT|RM|R|B|C|M|PD|POS|T|DX|DC|DR|DS|PMD)[-.\s]?\d*"
)

_SKIP_WORDS = frozenset({
    "the", "and", "or", "in", "of", "to", "a", "an", "is", "at", "by", "on",
    "with", "for", "as", "be", "no", "not", "it", "but", "are", "has", "had",
    "was", "were", "from", "this", "that", "which", "all", "any", "each",
    "area", "total", "count", "number", "zone", "class", "code", "type",
    "per", "sq", "ft", "mi", "ac", "pet", "pct", "percent", "park",
})

_PD_MATCHER = re.compile(r"(?i)\bPD\s*(\d{1,6})\b")


def load_zone_classes(path: str | Path) -> list[str]:
    """Extract unique zoning class names from a ZONE_CLASS stats file.

    Recognises RT-4, B3-1, C1-2, PD 323, RM-4.5, POS-2, T, etc.
    """
    raw = Path(path).expanduser().resolve().read_text(encoding="utf-8", errors="ignore")
    classes: set[str] = set()

    # 1) PD codes
    for m in _PD_MATCHER.finditer(raw):
        classes.add(f"PD {m.group(1)}")

    # 2) standard zone-class tokens
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.lower().startswith(("total", "sum", "#", "zone", "class", "code", "---")):
            continue
        tokens = [t.strip(",.()[]{}:;") for t in line.split()]
        for token in tokens:
            if token.upper() in _SKIP_WORDS or token.replace(",", "").replace(".", "").isdigit():
                continue
            if _ZONE_CLASS_FILTER.match(token):
                # Normalise: R T-4  →  RT-4
                norm = token.upper().replace(" ", "")
                classes.add(norm)

    # 3) Sort for deterministic output
    result = sorted(classes, key=lambda x: (
        x.split()[0] if " " in x else x.split("-")[0] if "-" in x else x,
        x,
    ))
    return result


def classify_zone_family(zone_class: str) -> str:
    """Map a zoning class to a broad family."""
    zc = zone_class.upper().replace(" ", "")
    if zc == "T":
        return "transportation"
    if zc.startswith("PD"):
        return "planned_development"
    if any(zc.startswith(p) for p in ("RS", "RT", "RM")):
        return "residential"
    if any(zc.startswith(p) for p in ("B", "C")):
        return "business_commercial"
    if any(zc.startswith(p) for p in ("M", "PMD")):
        return "manufacturing"
    if any(zc.startswith(p) for p in ("DX", "DC", "DR", "DS")):
        return "downtown"
    if zc.startswith("POS"):
        return "open_space"
    return "unknown"

# ======================================================================
# Section / chapter detection
# ======================================================================

_SECTION_RE = re.compile(
    r"(?:Section|CHAPTER|Chapter|Art\.?|ARTICLE|§)\s*"
    r"(\d{1,2}[-.]\d+|\d{1,2})\s",
    re.I,
)
_SECTION_CONTEXT_MAP: dict[str, list[str]] = {
    "17-2": ["residential", "residence district", "r districts"],
    "17-3": ["business", "commercial", "b districts", "c districts"],
    "17-4": ["downtown", "d districts", "dx", "dc", "dr"],
    "17-5": ["manufacturing", "m districts", "industrial"],
    "17-6": ["special purpose", "pos", "t district", "open space"],
    "17-8": ["planned development", "pd"],
    "17-9": ["use regulation", "use table", "permitted use", "special use"],
    "17-10": ["parking", "loading"],
    "17-11": ["landscaping", "screening", "buffer"],
}

_current_section: str | None = None  # module-level tracker (reset per run)


def update_section_context(text: str) -> str | None:
    """If the text starts a new section, update the global tracker."""
    global _current_section
    m = _SECTION_RE.search(text)
    if not m:
        return _current_section
    sec_num = m.group(1)
    _current_section = sec_num
    return sec_num


def infer_matched_section(zone_family: str, parameter_name: str) -> str:
    """Return a descriptive section name based on zone family and parameter."""
    # Use the last seen section if it matches the zone family
    if _current_section:
        for sec, keywords in _SECTION_CONTEXT_MAP.items():
            if any(kw in (zone_family or "").lower() for kw in keywords):
                if _current_section == sec or _current_section.startswith(sec):
                    return sec

    # Fallback based on zone family
    family_map: dict[str, str] = {
        "residential": "17-2 Residential Districts",
        "business_commercial": "17-3 Business and Commercial Districts",
        "downtown": "17-4 Downtown Districts",
        "manufacturing": "17-5 Manufacturing Districts",
        "open_space": "17-6 Special Purpose Districts",
        "transportation": "17-6 Special Purpose Districts",
        "planned_development": "17-8 Planned Developments",
    }
    if parameter_name in ("parking_requirement", "surface_parking_allowed", "parking_lot_screening_required", "parking_lot_lighting_required"):
        return "17-10 Parking and Loading"
    if parameter_name in ("landscaping_required", "screening_required", "fence_required", "buffer_required", "buffer_width"):
        return "17-11 Landscaping and Screening"
    if "use_allowed" in parameter_name or "allowed" in parameter_name or "special_use" in parameter_name:
        return "17-9 Use Regulations"
    return family_map.get(zone_family, "Unknown Section")


# ======================================================================
# District detection (legacy)
# ======================================================================

DISTRICT_PATTERN = re.compile(
    r"\b("
    r"RS-\d{1,2}|RM-\d{1,2}|RT-\d{1,2}|"
    r"R[1-8]|C-?\d{1,2}|B-?\d{1,2}|M-?\d{1,2}|"
    r"DX|LX|MX|DC|DR|DS|PMD|PD|PL|POS|T|"
    r"[A-Z]{1,4}-\d{1,2}"
    r")\b",
    re.IGNORECASE,
)

# ======================================================================
# Legacy parameter keywords
# ======================================================================

PARAMETER_KEYWORDS: dict[str, list[str]] = {
    "max_height": [
        "maximum height", "max height", "building height",
        "height limit", "height shall not exceed", "feet in height",
        "story", "stories", "height of",
    ],
    "FAR": [
        "floor area ratio", "far ", "f.a.r", "f.a.r.", "floor-area ratio", "far of",
    ],
    "lot_area_min": [
        "minimum lot area", "min lot area", "lot area",
        "area of a lot", "area of lot", "square feet of lot",
    ],
    "lot_width_min": [
        "minimum lot width", "min lot width", "lot width",
        "minimum width of lot", "width of a lot",
    ],
    "setback_front": [
        "front setback", "front yard", "setback from the front",
        "required front yard", "front building line", "front street line",
        "frontage", "front wall",
    ],
    "setback_side": [
        "side setback", "side yard", "setback from the side",
        "required side yard", "side line", "side lot line",
    ],
    "setback_rear": [
        "rear setback", "rear yard", "setback from the rear",
        "required rear yard", "rear line",
    ],
    "lot_coverage": [
        "lot coverage", "building coverage", "maximum coverage",
        "ground coverage", "per cent of the area",
    ],
    "parking_requirement": [
        "parking", "parking space", "parking spaces",
        "spaces per unit", "spaces/unit", "off-street parking",
        "spaces per dwelling",
    ],
    "open_space_requirement": [
        "open space", "open-space", "landscaped area", "pervious surface",
    ],
    "use_allowed_residential": [
        "residential use", "residential uses",
        "dwelling use", "dwelling uses",
    ],
    "use_allowed_commercial": [
        "commercial use", "commercial uses",
        "retail use", "business use", "business establishment",
        "office use",
    ],
    "use_allowed_industrial": [
        "industrial use", "industrial uses",
        "manufacturing use", "warehouse use",
    ],
    "mixed_use_allowed": [
        "mixed use", "mixed-use", "combined use",
    ],
    "special_use": [
        "special use", "special permit", "conditional use",
        "special exception",
    ],
    "liquor_or_tavern_related": [
        "liquor", "tavern", "alcohol", "bar ",
    ],
    "adult_use_related": [
        "adult use", "adult entertainment", "adult bookstore",
    ],
}

# ======================================================================
# Targeted parameter keywords (zone-class mode)
# ======================================================================

TARGETED_PARAMETER_KEYWORDS: dict[str, list[str]] = {
    # ── 1. Nightlife / alcohol / entertainment ──
    "tavern_allowed": ["tavern", "taverns", "bar ", "bars "],
    "bar_allowed": ["bar ", "bars ", "tavern"],
    "liquor_sales_allowed": ["liquor", "liquor sales", "liquor store", "package liquor", "alcohol"],
    "nightclub_allowed": ["nightclub", "night club", "night-club"],
    "entertainment_venue_allowed": ["entertainment", "entertainment venue", "place of amusement", "amusement"],
    "adult_use_allowed": ["adult use", "adult entertainment", "adult bookstore", "adult cabaret"],
    "special_use_required_for_nightlife": ["special use", "special permit", "conditional use", "special exception"],

    # ── 2. Lighting & visibility ──
    "lighting_required": ["lighting", "light ", "lights ", "illuminat", "foot-candle", "foot candle", "lux"],
    "parking_lot_lighting_required": ["parking lot lighting", "parking area lighting", "parking light"],
    "pedestrian_lighting_required": ["pedestrian lighting", "sidewalk light", "walkway light"],
    "security_lighting_required": ["security light", "safety light", "surveillance light"],
    "minimum_lighting_level": ["foot-candle", "foot candle", "lux", "minimum light", "lighting level"],

    # ── 3. Street interface / natural surveillance ──
    "active_frontage_required": ["active frontage", "active use", "active street", "activity frontage"],
    "ground_floor_commercial_allowed": ["ground floor", "ground-floor", "first floor commercial", "street-level"],
    "transparent_frontage_required": ["transparent", "glazing", "glass ", "window area", "fenestration", "clear glass"],
    "blank_wall_limit": ["blank wall", "blank-wall", "solid wall", "windowless"],
    "window_requirement": ["window", "windows", "glazing", "fenestration"],
    "entrance_spacing": ["entrance spacing", "entrance interval", "distance between entrance", "door spacing"],
    "front_setback": ["front setback", "front yard", "front building line", "build-to line", "build to line"],
    "build_to_line": ["build-to line", "build to line", "build-to zone", "building-to line"],

    # ── 4. Parking & open space management ──
    "surface_parking_allowed": ["surface parking", "surface lot", "parking lot", "open parking"],
    "parking_lot_screening_required": ["parking lot screening", "parking screen", "parking landscape"],
    "parking_lot_lighting_required": ["parking lot lighting", "parking area lighting", "parking light"],
    "parking_requirement": ["parking space", "parking spaces", "spaces per", "off-street parking", "parking requirement"],
    "vacant_lot_maintenance_required": ["vacant lot", "vacant land", "vacant property", "maintenance"],
    "fence_required": ["fence", "fencing", "enclosure", "wall required"],
    "landscaping_required": ["landscaping", "landscape", "planting", "vegetation", "trees", "shrub"],
    "screening_required": ["screening", "screen", "visual screen", "opaque screen"],

    # ── 5. Distance / buffer restrictions ──
    "distance_from_residential": ["distance from residential", "distance from residence", "setback from residential"],
    "distance_from_school": ["distance from school", "distance from school"],
    "distance_from_church": ["distance from church", "distance from place of worship"],
    "distance_from_park": ["distance from park", "distance from playground"],
    "distance_between_liquor_uses": ["distance between liquor", "distance between tavern", "distance between bar"],
    "buffer_required": ["buffer", "buffer zone", "buffer area", "buffering"],
    "industrial_buffer_required": ["industrial buffer", "industry buffer", "manufacturing buffer"],
    "buffer_width": ["buffer width", "width of buffer", "buffer of", "buffer distance"],
}

# Parameters that are always boolean (yes/no/conditional)
_TARGETED_BOOLEAN_PARAMS = frozenset({
    "tavern_allowed", "bar_allowed", "liquor_sales_allowed",
    "nightclub_allowed", "entertainment_venue_allowed", "adult_use_allowed",
    "special_use_required_for_nightlife",
    "lighting_required", "parking_lot_lighting_required",
    "pedestrian_lighting_required", "security_lighting_required",
    "active_frontage_required", "ground_floor_commercial_allowed",
    "transparent_frontage_required",
    "surface_parking_allowed", "parking_lot_screening_required",
    "vacant_lot_maintenance_required", "fence_required",
    "landscaping_required", "screening_required",
    "buffer_required", "industrial_buffer_required",
})

_TARGETED_UNIT_PREFS: dict[str, list[str]] = {
    "minimum_lighting_level": ["ft", ""],
    "blank_wall_limit": ["ft", "%", ""],
    "window_requirement": ["%", ""],
    "entrance_spacing": ["ft", ""],
    "front_setback": ["ft", ""],
    "build_to_line": ["ft", ""],
    "parking_requirement": ["spaces/unit", "spaces/1000 sq ft", ""],
    "distance_from_residential": ["ft", ""],
    "distance_from_school": ["ft", ""],
    "distance_from_church": ["ft", ""],
    "distance_from_park": ["ft", ""],
    "distance_between_liquor_uses": ["ft", ""],
    "buffer_width": ["ft", ""],
}

# ======================================================================
# English number words
# ======================================================================

_ENGLISH_NUMBER_WORDS: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
}

_ENGLISH_HYPHEN_NUMBER = re.compile(
    r"\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
    r"[- ](?:one|two|three|four|five|six|seven|eight|nine)\b",
    re.IGNORECASE,
)

# ======================================================================
# Permission words
# ======================================================================

_PERMITTED = re.compile(r"\b(permitted|allowed|shall be permitted|may be used|may be located)\b", re.I)
_PROHIBITED = re.compile(r"\b(prohibited|not permitted|not allowed|shall not be|excluded|not be)\b", re.I)
_CONDITIONAL = re.compile(r"\b(conditional|special\s+(?:permit|exception|use)|subject to)\b", re.I)

# ======================================================================
# Numeric patterns
# ======================================================================

_NUMBER_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:feet|ft|foot|')\b", re.I), "ft"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:stories|story)\b", re.I), "stories"),
    (re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet|sq\.?\s*feet)\b", re.I), "sq ft"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*%"), "%"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:percent|per\s*cent)\b", re.I), "%"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:parking\s*)?spaces?\s*(?:per|/)\s*(?:dwelling\s*)?unit", re.I), "spaces/unit"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:parking\s*)?spaces?\s*(?:per|/)\s*1[,.]?000", re.I), "spaces/1000 sq ft"),
    (re.compile(r"\bFAR\s*(?:of\s*)?(\d+(?:\.\d+)?)", re.I), "FAR"),
    (re.compile(r"floor\s*area\s+ratio\s*(?:of\s*)?(\d+(?:\.\d+)?)", re.I), "FAR"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:to|\-)\s*(\d+(?:\.\d+)?)\s*(?:feet|ft|foot|')\b", re.I), "ft"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:to|\-)\s*(\d+(?:\.\d+)?)\s*(?:stories|story)\b", re.I), "stories"),
    (re.compile(r"\b(\d+(?:\.\d+)?)\b"), ""),
]

_PARAM_UNIT_PREFS: dict[str, list[str]] = {
    "max_height": ["ft", "stories", ""],
    "FAR": ["FAR", ""],
    "setback_front": ["ft", "%", ""],
    "setback_side": ["ft", "%", ""],
    "setback_rear": ["ft", "%", ""],
    "lot_area_min": ["sq ft", ""],
    "lot_width_min": ["ft", ""],
    "lot_coverage": ["%", ""],
    "parking_requirement": ["spaces/unit", "spaces/1000 sq ft", ""],
    "open_space_requirement": ["%", ""],
}

_BOOLEAN_PARAMS = frozenset({
    "use_allowed_residential", "use_allowed_commercial",
    "use_allowed_industrial", "mixed_use_allowed",
    "special_use", "liquor_or_tavern_related", "adult_use_related",
})

# ======================================================================
# Sentence / line splitting
# ======================================================================

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_CLAUSE_SPLIT = re.compile(r"\s*;\s*|\s+and\s+|\s+or\s+")
_LINE_NOISE = re.compile(r"^[\s\d\.\-_/#*|\\:\@\^=+\[\]{}()<>%$&~`]+$")
_PAGE_MARKER = re.compile(r"^\s*#{1,6}\s*p\.?\s*\(#\d+\)\s*#{1,6}")
_SECTION_HEADER = re.compile(r"^\s*(?:Section|CHAPTER|ARTICLE)\s+\d+", re.I)
_MIN_SENTENCE_LENGTH = 30

_TRAILING_HYPHEN = re.compile(r"-\s*$")

# ======================================================================
# Helpers
# ======================================================================

@dataclass
class TextChunk:
    text: str
    source_page: str


def _ensure_parent(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def normalize_district(raw: str) -> str:
    token = raw.upper().strip()
    match = re.match(r"^([A-Z]+)-?(\d+)$", token)
    if match and len(match.group(1)) > 1:
        return f"{match.group(1)}-{match.group(2)}"
    return token


def find_districts(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in DISTRICT_PATTERN.finditer(text):
        code = normalize_district(m.group(1))
        if code not in seen:
            seen.add(code)
            found.append(code)
    return found


def clean_text(raw: str) -> str:
    text = raw.strip()
    text = _TRAILING_HYPHEN.sub("", text)
    text = re.sub(r"\s+", " ", text)
    return text


def is_noise_line(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) < _MIN_SENTENCE_LENGTH:
        return True
    if _LINE_NOISE.match(stripped):
        return True
    if _PAGE_MARKER.match(stripped):
        return True
    if _SECTION_HEADER.match(stripped):
        return True
    alpha = sum(1 for c in stripped if c.isalpha())
    if alpha > 0 and alpha / len(stripped) < 0.25:
        return True
    return False


def word_to_number(word: str) -> int | None:
    word = word.lower().strip()
    m = _ENGLISH_HYPHEN_NUMBER.match(word)
    if m:
        parts = re.split(r"[- ]", m.group(0))
        return _ENGLISH_NUMBER_WORDS.get(parts[0], 0) + _ENGLISH_NUMBER_WORDS.get(parts[1], 0)
    return _ENGLISH_NUMBER_WORDS.get(word)


def clean_sentence_start(sentence: str) -> str:
    s = re.sub(r"^\(?#\d+\)?\s*#{5,}\s*", "", sentence.strip())
    return s


def _yield_sentences(text: str) -> Iterator[str]:
    raw = clean_text(text)
    parts = _SENTENCE_SPLIT.split(raw)
    for part in parts:
        sentence = clean_sentence_start(part.strip())
        if sentence and not is_noise_line(sentence):
            yield sentence

# ---------------------------------------------------------------------------
# Core value extraction (shared)
# ---------------------------------------------------------------------------

@dataclass
class _NumMatch:
    value: str
    unit: str
    start: int
    end: int


def _find_all_numbers(text: str) -> list[_NumMatch]:
    results: list[_NumMatch] = []
    seen_spans: set[tuple[int, int]] = set()

    for pattern, unit in _NUMBER_PATTERNS:
        for m in pattern.finditer(text):
            span = (m.start(), m.end())
            if span in seen_spans:
                continue

            raw = m.group(1).replace(",", "")

            if unit == "" and m.start() < 20:
                before = text[max(0, m.start(1)-1):m.start(1)]
                after = text[m.end(1):m.end(1)+1] if m.end(1) < len(text) else ""
                if after in (")", ".", "]", ":") and before in ("", "(", "[", " "):
                    continue

            if unit == "" and len(raw) <= 3:
                context_before = text[max(0, m.start(1)-20):m.start(1)].lower()
                if re.search(r"\b(section|paragraph|article|chapter)\b", context_before):
                    continue

            if unit == "ft" and len(m.groups()) >= 2 and m.group(2):
                raw2 = m.group(2).replace(",", "")
                raw = f"{raw}-{raw2}"

            seen_spans.add(span)
            results.append(_NumMatch(value=raw, unit=unit, start=m.start(), end=m.end()))

    # English number words
    for m in re.finditer(r"\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten"
                         r"|eleven|twelve|thirteen|fourteen|fifteen|sixteen"
                         r"|seventeen|eighteen|nineteen"
                         r"|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ]?"
                         r"(?:one|two|three|four|five|six|seven|eight|nine)?"
                         r"|hundred|thousand)\b", text, re.I):
        num = word_to_number(m.group(0))
        if num is not None:
            span = (m.start(), m.end())
            if span not in seen_spans:
                results.append(_NumMatch(value=str(num), unit="", start=m.start(), end=m.end()))

    results.sort(key=lambda n: n.start)
    return results


def _find_keyword_positions(text_lower: str, keywords: list[str]) -> list[tuple[int, int]]:
    positions: list[tuple[int, int]] = []
    seen: set[int] = set()
    for kw in keywords:
        kw_lower = kw.lower()
        start = 0
        while True:
            pos = text_lower.find(kw_lower, start)
            if pos == -1:
                break
            if pos not in seen:
                positions.append((pos, pos + len(kw_lower)))
                seen.add(pos)
            start = pos + 1
    return positions


def extract_numeric_value(text: str, parameter_name: str,
                          keywords: list[str], boolean_set: frozenset[str],
                          unit_prefs: dict[str, list[str]]) -> tuple[str, str]:
    """Unified numeric/boolean value extractor."""
    text_lower = text.lower()

    if parameter_name in boolean_set:
        if _PROHIBITED.search(text):
            return ("no", "boolean")
        if _PERMITTED.search(text):
            return ("yes", "boolean")
        if _CONDITIONAL.search(text):
            return ("conditional", "boolean")
        return ("", "boolean")

    numbers = _find_all_numbers(text)
    if not numbers:
        return ("", "")

    kw_positions = _find_keyword_positions(text_lower, keywords)
    preferred_units = unit_prefs.get(parameter_name, [""])
    unit_rank = {u: i for i, u in enumerate(preferred_units)}

    best: _NumMatch | None = None
    best_score = float("inf")

    if kw_positions:
        for num in numbers:
            min_dist = min(abs(num.start - k[0]) for k in kw_positions)
            rank = unit_rank.get(num.unit, len(preferred_units))
            score = min_dist + rank * 200
            if score < best_score:
                best_score = score
                best = num
    else:
        for num in numbers:
            rank = unit_rank.get(num.unit, len(preferred_units))
            score = rank * 200 + num.start * 0.01
            if score < best_score:
                best_score = score
                best = num

    if best is None:
        return ("", "")

    final_unit = best.unit
    if parameter_name in ("lot_coverage", "open_space_requirement") and final_unit not in ("%", ""):
        final_unit = ""
    if parameter_name.startswith("setback_") and final_unit not in ("ft", "%", ""):
        final_unit = ""
    if parameter_name == "FAR" and final_unit not in ("FAR", ""):
        final_unit = "FAR" if best.value else ""
    if parameter_name in ("build_to_line", "front_setback", "entrance_spacing",
                          "distance_from_residential", "distance_from_school",
                          "distance_from_church", "distance_from_park",
                          "distance_between_liquor_uses", "buffer_width",
                          "blank_wall_limit"):
        if final_unit not in ("ft", ""):
            final_unit = "ft" if best.value else ""
    if parameter_name == "minimum_lighting_level":
        if final_unit not in ("ft", ""):
            final_unit = ""
    if parameter_name == "window_requirement" and final_unit not in ("%", ""):
        final_unit = ""

    return (best.value, final_unit)


def determine_value_type(parameter_name: str, value: str,
                          boolean_set: frozenset[str]) -> str:
    """Return value_type category."""
    if not value:
        return "missing"
    if parameter_name in boolean_set:
        return "boolean"
    if parameter_name.startswith("special_use"):
        return "special_use"
    if re.match(r"^[\d.\-]+$", value):
        return "numeric"
    if value in ("yes", "no", "conditional"):
        return "boolean"
    return "text"


def compute_confidence(parameter_name: str, value: str, unit: str,
                       has_district: bool, has_parameter: bool) -> str:
    if not has_parameter:
        return "low"
    has_value = bool(value)
    has_unit = bool(unit)
    if has_value and has_unit:
        return "high" if has_district else "medium"
    if has_value and not has_unit:
        return "medium"
    if has_value and parameter_name in _BOOLEAN_PARAMS:
        return "high" if has_district else "medium"
    return "low"


def compute_confidence_zc(parameter_name: str, value: str, unit: str,
                           has_zone_class: bool, is_pd: bool) -> str:
    """Confidence for targeted mode."""
    if is_pd:
        return "high"
    if not has_zone_class:
        return "low"
    has_value = bool(value)
    has_unit = bool(unit)
    if has_value and has_unit:
        return "high"
    if has_value:
        return "medium"
    return "low"

# ======================================================================
# Legacy extraction (full-text mode)
# ======================================================================

def _split_into_clauses(sentence: str) -> list[str]:
    if not re.search(r"\s+(?:and|or)\s+|;", sentence):
        return [sentence]
    clauses = _CLAUSE_SPLIT.split(sentence)
    clauses = [c.strip() for c in clauses if len(c.strip()) >= 25]
    if len(clauses) <= 1:
        return [sentence]
    keyword_count = 0
    all_keywords_flat = [kw for kws in PARAMETER_KEYWORDS.values() for kw in kws]
    for clause in clauses:
        if any(kw in clause.lower() for kw in all_keywords_flat):
            keyword_count += 1
    return clauses if keyword_count >= 2 else [sentence]


def extract_from_sentence(
    sentence: str, source_page: str, source_file: str,
) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    sentence = sentence.strip()
    if len(sentence) < _MIN_SENTENCE_LENGTH:
        return results

    clauses = _split_into_clauses(sentence)

    for clause in clauses:
        clause = clause.strip()
        if len(clause) < 20:
            continue
        text_lower = clause.lower()
        districts = find_districts(clause)
        district = districts[0] if districts else "unknown"

        for param_name, keywords in PARAMETER_KEYWORDS.items():
            if not any(kw in text_lower for kw in keywords):
                continue
            value, unit = extract_numeric_value(
                clause, param_name, keywords, _BOOLEAN_PARAMS, _PARAM_UNIT_PREFS,
            )
            confidence = compute_confidence(
                param_name, value, unit,
                has_district=(district != "unknown"),
                has_parameter=True,
            )
            base = {
                "source_file": source_file,
                "source_page": source_page,
                "zoning_district": district,
                "parameter_name": param_name,
                "parameter_value": value,
                "unit": unit,
                "original_text": clause,
                "confidence": confidence,
            }
            results.append(base)
            for extra in districts[1:]:
                results.append({**base, "zoning_district": extra})

    return results

# ======================================================================
# Targeted extraction (zone-class mode)
# ======================================================================

def _build_zone_class_pattern(zone_classes: list[str]) -> re.Pattern[str]:
    """Build a regex that matches any target zone class."""
    escaped = []
    for zc in zone_classes:
        # Escape special regex chars, but allow space for PD
        esc = re.escape(zc).replace(r"\ ", " ")
        # Also match with hyphen variations: RT-4 matches RT-4, RT 4, RT4
        plain = esc.replace(r"\-", r"[-\s]?")
        escaped.append(plain)
    return re.compile(r"\b(" + "|".join(escaped) + r")\b", re.I)


def _find_target_zone_classes(text: str, pattern: re.Pattern[str]) -> list[str]:
    """Find which target zone classes appear in text."""
    found: list[str] = []
    seen: set[str] = set()
    for m in pattern.finditer(text):
        raw = m.group(1).upper().strip()
        # Normalize: RT 4 → RT-4
        normed = raw.replace(" ", "-").replace("--", "-")
        if normed not in seen:
            seen.add(normed)
            found.append(normed)
    return found


def extract_targeted_from_sentence(
    sentence: str, source_page: str, source_file: str,
    zone_class_pattern: re.Pattern[str],
) -> list[dict[str, str]]:
    """Extract only for sentences that mention target zone classes."""
    results: list[dict[str, str]] = []
    sentence = sentence.strip()
    if len(sentence) < 20:
        return results

    # Must mention a target zone class
    matched_zones = _find_target_zone_classes(sentence, zone_class_pattern)
    if not matched_zones:
        return results

    text_lower = sentence.lower()

    # Check against ALL targeted parameters
    for param_name, keywords in TARGETED_PARAMETER_KEYWORDS.items():
        if not any(kw in text_lower for kw in keywords):
            continue

        value, unit = extract_numeric_value(
            sentence, param_name, keywords,
            _TARGETED_BOOLEAN_PARAMS, _TARGETED_UNIT_PREFS,
        )

        for zc in matched_zones:
            zone_family = classify_zone_family(zc)
            if zone_family == "planned_development":
                # PD is handled separately — skip keyword-based extraction for PDs
                continue

            value_type = determine_value_type(
                param_name, value, _TARGETED_BOOLEAN_PARAMS,
            )
            confidence = compute_confidence_zc(
                param_name, value, unit,
                has_zone_class=True,
                is_pd=False,
            )

            results.append({
                "source_file": source_file,
                "source_page": source_page,
                "zone_class": zc,
                "zone_family": zone_family,
                "parameter_name": param_name,
                "parameter_value": value,
                "unit": unit,
                "value_type": value_type,
                "original_text": sentence,
                "confidence": confidence,
                "matched_section": infer_matched_section(zone_family, param_name),
            })

    return results


def _add_pd_rows(zone_classes: list[str], source_file: str,
                  source_page: str) -> list[dict[str, str]]:
    """Generate special rows for Planned Development zones."""
    rows: list[dict[str, str]] = []
    for zc in zone_classes:
        if classify_zone_family(zc) != "planned_development":
            continue
        rows.append({
            "source_file": source_file,
            "source_page": source_page,
            "zone_class": zc,
            "zone_family": "planned_development",
            "parameter_name": "requires_pd_ordinance_lookup",
            "parameter_value": "yes",
            "unit": "boolean",
            "value_type": "boolean",
            "original_text": "Planned Development districts require individual PD ordinance documents for detailed parameters.",
            "confidence": "high",
            "matched_section": "17-8 Planned Developments",
        })
    return rows

# ======================================================================
# Document readers
# ======================================================================

def read_pdf(path: Path) -> list[TextChunk]:
    if PdfReader is None:
        raise ImportError("pypdf is required for PDF files. Run: pip install pypdf")
    reader = PdfReader(str(path))
    chunks: list[TextChunk] = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            chunks.append(TextChunk(text=text, source_page=str(i)))
    return chunks


def read_docx(path: Path) -> list[TextChunk]:
    if Document is None:
        raise ImportError("python-docx is required. Run: pip install python-docx")
    doc = Document(str(path))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    if paragraphs:
        return [TextChunk(text="\n".join(paragraphs), source_page="docx")]
    return []


def read_txt(path: Path) -> list[TextChunk]:
    text = path.read_text(encoding="utf-8", errors="ignore").strip()
    if text:
        return [TextChunk(text=text, source_page="txt")]
    return []


def read_structured_csv(path: Path) -> list[dict[str, str]]:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")
    if set(OUTPUT_COLUMNS).issubset(df.columns):
        rows = df[OUTPUT_COLUMNS].to_dict("records")
        enriched: list[dict[str, str]] = []
        for row in rows:
            if not row.get("parameter_value") and row.get("original_text"):
                if row.get("parameter_name"):
                    value, unit = extract_numeric_value(
                        row["original_text"], row["parameter_name"],
                        PARAMETER_KEYWORDS.get(row["parameter_name"], []),
                        _BOOLEAN_PARAMS, _PARAM_UNIT_PREFS,
                    )
                    row["parameter_value"] = value
                    row["unit"] = unit or row.get("unit", "")
                    row["confidence"] = compute_confidence(
                        row["parameter_name"], value, row["unit"],
                        has_district=row.get("zoning_district", "unknown") != "unknown",
                        has_parameter=True,
                    )
            enriched.append(row)
        return enriched

    source_name = str(path.name)
    column_map = {"file_name": "source_file", "file_path": "source_file"}
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})
    if "source_file" not in df.columns:
        df["source_file"] = source_name

    text_col = next((c for c in ("original_text", "text", "content") if c in df.columns), None)
    if text_col:
        all_rows: list[dict[str, str]] = []
        for _, row in df.iterrows():
            text = str(row.get(text_col, ""))
            if not text.strip():
                continue
            for sentence in _yield_sentences(text):
                extracted = extract_from_sentence(
                    sentence, source_page="csv", source_file=source_name,
                )
                all_rows.extend(extracted)
        return all_rows

    rows: list[dict[str, str]] = []
    for _, row in df.iterrows():
        record = {col: str(row.get(col, "")) for col in OUTPUT_COLUMNS}
        if record.get("parameter_name"):
            rows.append(record)
    return rows

# ======================================================================
# File processing
# ======================================================================

def process_file(file_path: Path) -> list[dict[str, str]]:
    ext = file_path.suffix.lstrip(".").lower()
    source_name = str(file_path.name)
    rows: list[dict[str, str]] = []

    if ext == "csv":
        return read_structured_csv(file_path)

    try:
        if ext == "pdf":
            chunks = read_pdf(file_path)
        elif ext == "docx":
            chunks = read_docx(file_path)
        elif ext == "txt":
            chunks = read_txt(file_path)
        else:
            return rows
    except Exception as exc:
        return [{
            "source_file": source_name, "source_page": "",
            "zoning_district": "unknown", "parameter_name": "read_error",
            "parameter_value": "", "unit": "",
            "original_text": str(exc), "confidence": "low",
        }]

    for chunk in chunks:
        for sentence in _yield_sentences(chunk.text):
            extracted = extract_from_sentence(sentence, chunk.source_page, source_name)
            rows.extend(extracted)

    return rows


def process_file_targeted(file_path: Path,
                           zone_class_pattern: re.Pattern[str]) -> list[dict[str, str]]:
    ext = file_path.suffix.lstrip(".").lower()
    source_name = str(file_path.name)
    rows: list[dict[str, str]] = []

    try:
        if ext == "pdf":
            chunks = read_pdf(file_path)
        elif ext == "docx":
            chunks = read_docx(file_path)
        elif ext == "txt":
            chunks = read_txt(file_path)
        else:
            return rows
    except Exception as exc:
        return [{
            "source_file": source_name, "source_page": "",
            "zone_class": "unknown", "zone_family": "unknown",
            "parameter_name": "read_error", "parameter_value": "",
            "unit": "", "value_type": "missing",
            "original_text": str(exc), "confidence": "low",
            "matched_section": "",
        }]

    for chunk in chunks:
        text_lines = chunk.text.split("\n")
        for line in text_lines:
            update_section_context(line)

        for sentence in _yield_sentences(chunk.text):
            extracted = extract_targeted_from_sentence(
                sentence, chunk.source_page, source_name, zone_class_pattern,
            )
            rows.extend(extracted)

    return rows


def collect_input_files(input_path: Path, file_type: str | None) -> list[Path]:
    if input_path.is_file():
        return [input_path.resolve()]
    if not input_path.is_dir():
        raise NotADirectoryError(f"Input path is not a file or directory: {input_path}")
    allowed = {file_type.lower()} if file_type else EXTRACTABLE_EXTENSIONS
    files = [
        p.resolve()
        for p in input_path.rglob("*")
        if p.is_file() and p.suffix.lstrip(".").lower() in allowed
    ]
    files.sort(key=lambda p: str(p).lower())
    return files


def _deduplicate(rows: list[dict[str, str]], keys: list[str] | None = None) -> list[dict[str, str]]:
    if keys is None:
        keys = [
            "source_file", "source_page", "zoning_district",
            "parameter_name", "parameter_value", "original_text",
        ]
    seen: set[tuple[str, ...]] = set()
    unique: list[dict[str, str]] = []
    for row in rows:
        sig = tuple(row.get(k, "") for k in keys)
        if sig not in seen:
            seen.add(sig)
            unique.append(row)
    return unique


def _print_stats(df: pd.DataFrame) -> None:
    total = len(df)
    with_value = int((df["parameter_value"] != "").sum())
    numeric = int(df["parameter_value"].str.match(r"^[\d.\-]+$").sum())
    yes_no = int(df["parameter_value"].str.match(r"^(yes|no|conditional)$").sum())
    empty = total - with_value
    print(f"\n{'='*50}")
    print(f"  Total extractions:         {total}")
    print(f"  parameter_value non-empty: {with_value}")
    print(f"  Numeric parameters:        {numeric}")
    print(f"  Yes / No parameters:       {yes_no}")
    print(f"  parameter_value empty:     {empty}")
    print(f"{'='*50}")


def _print_stats_targeted(df: pd.DataFrame, zone_classes: list[str]) -> None:
    total = len(df)
    numeric = int(df["value_type"].eq("numeric").sum())
    boolean = int(df["value_type"].eq("boolean").sum())
    special_use = int(df["value_type"].eq("special_use").sum())
    low_conf = int(df["confidence"].eq("low").sum())

    covered = sorted(set(df["zone_class"].unique()))
    missing = [zc for zc in zone_classes
               if zc not in covered and classify_zone_family(zc) != "planned_development"]

    print(f"\n{'='*60}")
    print(f"  输入 zone class 数量:           {len(zone_classes)}")
    print(f"  成功提取到参数的 zone class:    {len(covered)}")
    print(f"  未找到参数的 zone class:        {len(missing)}")
    print(f"  输出参数总行数:                 {total}")
    print(f"  numeric 参数数量:               {numeric}")
    print(f"  boolean 参数数量:               {boolean}")
    print(f"  special use 参数数量:           {special_use}")
    print(f"  low confidence 行数:            {low_conf}")
    print(f"{'='*60}")

    if missing:
        print(f"\n  未找到参数的 ZONE_CLASS:")
        for zc in missing:
            print(f"    - {zc}")

# ======================================================================
# Main entry point
# ======================================================================

def run_extractor(
    input_path: str | Path,
    output_csv: str | Path,
    file_type: str | None = None,
    zone_classes_path: str | Path | None = None,
) -> Path:
    """Extract zoning parameters from documents.

    Args:
        input_path: Single file or folder containing PDF/DOCX/TXT/CSV.
        output_csv: Output CSV path.
        file_type: Optional file-type filter.
        zone_classes_path: Optional path to ZONE_CLASS_stats.txt.
            When provided, extraction is targeted to the listed zone classes.
            When None, full-text legacy extraction is used.
    """
    global _current_section
    _current_section = None

    in_path = Path(input_path).expanduser().resolve()
    out_path = _ensure_parent(Path(output_csv).expanduser().resolve())

    if not in_path.exists():
        raise FileNotFoundError(f"Input not found: {in_path}")

    files = collect_input_files(in_path, file_type)
    if not files:
        raise ValueError(f"No supported files found under: {in_path}")

    # ── Targeted mode ──────────────────────────────────────────
    if zone_classes_path:
        zc_path = Path(zone_classes_path).expanduser().resolve()
        if not zc_path.exists():
            raise FileNotFoundError(f"Zone class file not found: {zc_path}")

        zone_classes = load_zone_classes(zc_path)
        print(f"Zone classes loaded: {len(zone_classes)}")
        print(f"  {', '.join(zone_classes)}")

        zc_pattern = _build_zone_class_pattern(zone_classes)

        all_rows: list[dict[str, str]] = []
        for file_path in files:
            file_rows = process_file_targeted(file_path, zc_pattern)
            print(f"OK: {file_path.name} | hits={len(file_rows)}")
            all_rows.extend(file_rows)

        # Add PD rows for any PD classes
        pd_rows = _add_pd_rows(zone_classes, str(files[0].name), "pd")
        all_rows.extend(pd_rows)

        dedup_keys = [
            "source_file", "source_page", "zone_class",
            "parameter_name", "parameter_value", "original_text",
        ]
        unique_rows = _deduplicate(all_rows, dedup_keys)

        out_df = pd.DataFrame(unique_rows, columns=OUTPUT_COLUMNS_ZC)
        out_df.to_csv(out_path, index=False, encoding="utf-8-sig")

        print(f"Files processed:  {len(files)}")
        print(f"Raw extractions:  {len(all_rows)}")
        print(f"After dedup:      {len(out_df)}")
        _print_stats_targeted(out_df, zone_classes)
        print(f"Output: {out_path}")
        return out_path

    # ── Legacy mode ────────────────────────────────────────────
    all_rows: list[dict[str, str]] = []
    for file_path in files:
        file_rows = process_file(file_path)
        print(f"OK: {file_path.name} | hits={len(file_rows)}")
        all_rows.extend(file_rows)

    unique_rows = _deduplicate(all_rows)

    out_df = pd.DataFrame(unique_rows, columns=OUTPUT_COLUMNS)
    out_df.to_csv(out_path, index=False, encoding="utf-8-sig")

    print(f"Files processed:  {len(files)}")
    print(f"Raw extractions:  {len(all_rows)}")
    print(f"After dedup:      {len(out_df)}")
    _print_stats(out_df)
    print(f"Output: {out_path}")
    return out_path

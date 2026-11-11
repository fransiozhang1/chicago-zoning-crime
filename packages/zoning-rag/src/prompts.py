"""
Prompt templates for zoning policy retrieval and parameter extraction.
"""

# ---------------------------------------------------------------------------
#  Parameter extraction prompt
# ---------------------------------------------------------------------------

PARAMETER_EXTRACTION_PROMPT = """You are extracting zoning regulation parameters from Chicago Zoning Ordinance evidence.

RULES:
1. Use ONLY the provided retrieved contexts below. Do not use outside knowledge.
2. Do NOT guess. If the parameter value is not clearly stated in the contexts, set status to "not_found".
3. If multiple possible values exist depending on conditions (e.g., different dash designations, ARO zones), set status to "ambiguous" and explain the conditions in notes.
4. If the parameter does not apply to this zoning class at all, set status to "not_applicable".
5. Always include a short evidence quote from the contexts (1-2 sentences max).
6. Prefer evidence from contexts marked [TABLE_TEXT RESULT] over those marked [PAGE_TEXT RESULT] when both are available — tables contain the most precise values.
7. For numeric values, extract the exact number and unit as given (do not convert units).

CRITICAL — OUTPUT FORMAT:
- Return STRICT JSON only.
- Do NOT include markdown.
- Do NOT include explanation outside JSON.
- Do NOT wrap JSON in code fences (no ```json ... ```).
- Your entire response must be a single JSON object, nothing else.
- No leading or trailing text of any kind.

RETRIEVED CONTEXTS:
{context}

ZONING CLASS: {zone_class}
PARAMETER: {parameter}

Return exactly this JSON structure (no other keys, no markdown, no extra text):
{{
  "zone_class": "{zone_class}",
  "parameter": "{parameter}",
  "value": "<extracted value or empty string>",
  "unit": "<unit or empty string>",
  "status": "found | not_found | ambiguous | not_applicable",
  "evidence": "<short quote from context>",
  "source_file": "<source filename from context metadata>",
  "page_number": "<page number from context>",
  "content_type": "<page_text or table_text>",
  "table_id": "<table id if available, else empty>",
  "confidence": "high | medium | low",
  "notes": "<brief explanation of conditions, caveats, or why value is ambiguous>"
}}"""


# ---------------------------------------------------------------------------
#  Query generation helper — retained for future use
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
#  Inference prompt — used when RAG fails to find a value
# ---------------------------------------------------------------------------

INFERENCE_PROMPT = """You are a Chicago zoning regulation expert. You need to infer a likely parameter value for a zoning class based on values found for similar/related zoning classes.

RULES:
1. Use the provided "known values" from related zones to reason about the target zone.
2. The zones are organized in families: B=business, C=commercial, M=manufacturing, R=residential, PD=planned development, POS=public open space, T=special.
3. Parameters typically follow a pattern within the same zone family (e.g., higher-intensity zones have higher FAR, lower minimum lot area per unit).
4. Do NOT fabricate specific numbers unless there is a clear pattern from known values. Instead, describe the likely range or qualitative expectation.
5. If you cannot reasonably infer, set status to "not_inferrable" and explain why.
6. Always explain your reasoning in the notes field.

CRITICAL — OUTPUT FORMAT:
- Return STRICT JSON only.
- Do NOT include markdown.
- Do NOT include explanation outside JSON.
- Do NOT wrap JSON in code fences (no ```json ... ```).
- Your entire response must be a single JSON object, nothing else.

TARGET ZONE CLASS: {zone_class}
TARGET PARAMETER: {parameter}
PARAMETER DESCRIPTION: {parameter_desc}

KNOWN VALUES FROM RELATED ZONES:
{known_values}

Return exactly this JSON structure:
{{
  "zone_class": "{zone_class}",
  "parameter": "{parameter}",
  "value": "<inferred value or descriptive range>",
  "unit": "<unit if inferrable>",
  "status": "inferred | not_inferrable",
  "confidence": "high | medium | low",
  "notes": "<reasoning: how you arrived at this inference, based on which related zones>"
}}"""


# ---------------------------------------------------------------------------
#  Query generation helper — retained for future use
# ---------------------------------------------------------------------------

QUERY_PROMPT_TEMPLATE = (
    "You are a zoning policy retrieval assistant.\n"
    "Given the following context from the Chicago Zoning Ordinance, "
    "identify and return the most relevant sections that address the query.\n\n"
    "Context:\n{context}\n\n"
    "Query: {query}\n\n"
    "Relevant sections:"
)

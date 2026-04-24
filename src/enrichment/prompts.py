"""
Enrichment LLM prompt'ları + sabitler.

MD (ENRICHMENT_PROMPT.md) spec'ine birebir uyumlu:
    - 13 kategori (math, programming, ..., not_cs)
    - 6 Bloom seviyesi
    - Modernity score formülü: base 50, +8/modern, -12/legacy, clamp 0-100

Not: prompt İngilizce çünkü JSON şema İngilizce field isimleri kullanıyor
ve gpt-5.x ailesi şema takibinde İngilizce prompt ile daha kararlı.
Analiz hedefi içerik ise Türkçe/İngilizce — prompt'ta "do not translate".
"""

from __future__ import annotations


# ═══════════════════════════════════════════════════════════════════════════
# KATEGORİLER — Summary / aggregator da aynı listeyi kullanır.
# ═══════════════════════════════════════════════════════════════════════════

ALL_CATEGORIES: list[str] = [
    "math", "programming", "systems", "ai_ml", "data_science",
    "security", "web_mobile", "software_eng", "graphics_vision",
    "distributed", "theory", "info_systems",
    # "not_cs" summary'de sayılmıyor; list'e ayrı tutuluyor.
]

NOT_CS_CATEGORY = "not_cs"

VALID_CATEGORIES: set[str] = set(ALL_CATEGORIES) | {NOT_CS_CATEGORY}

# Teknik kategoriler (specialization_depth için)
TECHNICAL_CATEGORIES: set[str] = {
    "ai_ml", "security", "web_mobile", "data_science",
    "graphics_vision", "distributed", "software_eng",
}

VALID_BLOOM_LEVELS: set[str] = {
    "remember", "understand", "apply", "analyze", "evaluate", "create",
}


# ═══════════════════════════════════════════════════════════════════════════
# MODERN / LEGACY TEKNOLOJİ SÖZLÜKLERİ — LLM'e context olarak verilir.
# ═══════════════════════════════════════════════════════════════════════════

MODERN_TECH: list[str] = [
    # AI/ML (2020+)
    "transformer", "llm", "gpt", "bert", "rag", "diffusion",
    "stable diffusion", "attention mechanism", "pytorch", "tensorflow 2",
    # Modern web/mobile
    "react", "next.js", "nextjs", "vue", "svelte", "tailwind",
    "typescript", "graphql", "websocket",
    "flutter", "react native", "jetpack compose",
    # Modern backend/infra
    "microservice", "kubernetes", "k8s", "docker", "serverless",
    "terraform", "cloud native", "service mesh",
    # Modern data
    "apache spark", "kafka", "airflow", "dbt", "snowflake", "data lake",
    # Modern practices
    "devops", "sre", "ci/cd", "agile", "scrum",
    # Modern security
    "zero trust", "oauth", "jwt",
    # Web3
    "blockchain", "smart contract", "solidity",
]

LEGACY_TECH: list[str] = [
    "fortran", "cobol", "pascal", "algol",
    "waterfall",
    "flash", "silverlight",
    "perl cgi",
]


# ═══════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT — Tüm çağrılarda sabit.
# ═══════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are a curriculum analyzer for Turkish universities.
Your task is to analyze Computer Engineering / Software Engineering /
Information Systems courses and output structured metadata.

Rules:
1. Output ONLY valid JSON matching the exact schema provided.
2. Use ONLY the categories listed — never invent new ones.
3. Be conservative: if unsure, use lower confidence.
4. For non-CS courses (language, sports, economics), use category 'not_cs'.
5. Analyze in the language of the input (Turkish or English).
6. Do not translate course content.
7. Set confidence to 'low' if course data is very sparse.
"""


# ═══════════════════════════════════════════════════════════════════════════
# COURSE PROMPT — Her ders için f-string ile doldurulur.
# ═══════════════════════════════════════════════════════════════════════════

# Not: double-brace `{{...}}` literal brace için; field placeholder'lar
# tek-brace. Ayrıca response_format=json_object kullandığımız için LLM
# sadece JSON dönecek; prompt'ta fence YOK.

COURSE_PROMPT_TEMPLATE = """Analyze this university course and extract metadata.

COURSE DATA:
Code: {code}
Name: {name}
Type: {course_type}
ECTS: {ects}
Semester: {semester}
Language: {language}
Purpose: {purpose}
Description: {description}
Weekly Topics: {weekly_topics}
Learning Outcomes: {learning_outcomes}
Resources: {resources}

VALID CATEGORIES (pick 1-3, most relevant first):
math, programming, systems, ai_ml, data_science, security,
web_mobile, software_eng, graphics_vision, distributed,
theory, info_systems, not_cs

BLOOM LEVELS:
remember, understand, apply, analyze, evaluate, create

MODERN_TECH examples: transformer, llm, pytorch, react, nextjs, docker,
kubernetes, microservice, terraform, typescript, kafka, spark, devops,
blockchain, flutter, jetpack compose, oauth, jwt.

LEGACY_TECH examples: fortran, cobol, pascal, flash, silverlight,
waterfall, algol, perl cgi.

OUTPUT SCHEMA (JSON only, no markdown, no comments):
{{
  "categories": ["..."],
  "primary_category": "...",
  "modernity_score": 50,
  "modern_tech_tags": ["..."],
  "legacy_tech_tags": ["..."],
  "bloom_level": "apply",
  "bloom_distribution": {{
    "remember": 0.1, "understand": 0.2, "apply": 0.4,
    "analyze": 0.2, "evaluate": 0.05, "create": 0.05
  }},
  "is_project_heavy": false,
  "difficulty_level": "intermediate",
  "language_of_instruction": "tr",
  "resources_language": "mixed",
  "confidence": "high"
}}

Rules for fields:
- categories: list of 1-3 strings from VALID CATEGORIES above.
- primary_category: must equal categories[0].
- modernity_score: integer 0-100. Base 50, +8 per modern_tech_tag,
  -12 per legacy_tech_tag, then clamp 0-100.
- modern_tech_tags / legacy_tech_tags: lowercase, from examples above
  OR your own judgement; leave empty if none.
- bloom_level: dominant level (one of BLOOM LEVELS).
- bloom_distribution: 6 floats summing to 1.0 (±0.05 tolerance).
- is_project_heavy: true if course is project-based, capstone, lab-heavy,
  or has significant hands-on component.
- difficulty_level: beginner | intermediate | advanced
- language_of_instruction: tr | en | other
- resources_language: tr | en | mixed | unknown
- confidence: high | medium | low

OUTPUT (JSON object only):"""

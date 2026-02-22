"""
ingest.py — Neo4j Knowledge Graph Ingestion Script (Step 1 & 2)

Parses JSON curriculum files and ingests them into a Neo4j Knowledge Graph.
Generates embeddings using sentence-transformers and stores them on nodes.

Usage:
    python ingest.py

Prerequisites:
    1. Neo4j running (see .env.example for Docker instructions)
    2. .env file with NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
    3. pip install -r requirements.txt
    4. JSON data files in the data/ directory
"""

import json
import os
import glob
import logging
from typing import Optional

from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, EMBEDDING_MODEL

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Embedding Helper
# ---------------------------------------------------------------------------

_model: Optional[SentenceTransformer] = None


def get_model() -> SentenceTransformer:
    """Lazy-load the sentence-transformer model."""
    global _model
    if _model is None:
        logger.info("Loading embedding model: %s", EMBEDDING_MODEL)
        _model = SentenceTransformer(EMBEDDING_MODEL)
        logger.info("Model loaded successfully.")
    return _model


def generate_embedding(text: Optional[str]) -> Optional[list]:
    """Generate a vector embedding for the given text.

    Returns None if the input text is empty or None.
    """
    if not text or not text.strip():
        return None
    model = get_model()
    embedding = model.encode(text, show_progress_bar=False)
    return embedding.tolist()


# ---------------------------------------------------------------------------
# Cypher Queries
# ---------------------------------------------------------------------------

# Hierarchical nodes -----------------------------------------------------------

MERGE_UNIVERSITY = """
MERGE (u:University {name: $name})
SET u.type = $type,
    u.language = $language,
    u.department_url = $department_url
RETURN u
"""

MERGE_FACULTY = """
MERGE (f:Faculty {name: $faculty_name, university: $university_name})
RETURN f
"""

MERGE_DEPARTMENT = """
MERGE (d:Department {name: $dept_name, university: $university_name})
RETURN d
"""

LINK_UNIVERSITY_FACULTY = """
MATCH (u:University {name: $university_name})
MATCH (f:Faculty {name: $faculty_name, university: $university_name})
MERGE (u)-[:HAS_FACULTY]->(f)
"""

LINK_FACULTY_DEPARTMENT = """
MATCH (f:Faculty {name: $faculty_name, university: $university_name})
MATCH (d:Department {name: $dept_name, university: $university_name})
MERGE (f)-[:HAS_DEPARTMENT]->(d)
"""

# Academic staff ---------------------------------------------------------------

MERGE_ACADEMIC_STAFF = """
MATCH (d:Department {name: $dept_name, university: $university_name})
MERGE (d)-[:HAS_STAFF]->(s:AcademicStaff {department: $dept_name, university: $university_name})
SET s.professor           = $professor,
    s.associate_professor  = $associate_professor,
    s.assistant_professor  = $assistant_professor,
    s.lecturer             = $lecturer,
    s.research_assistant   = $research_assistant,
    s.total                = $total
"""

# Program outcomes -------------------------------------------------------------

MERGE_PROGRAM_OUTCOME = """
MATCH (d:Department {name: $dept_name, university: $university_name})
MERGE (po:ProgramOutcome {text: $text, department: $dept_name, university: $university_name})
SET po.index = $index,
    po.embedding = $embedding
MERGE (d)-[:HAS_PROGRAM_OUTCOME]->(po)
"""

# Course nodes -----------------------------------------------------------------

MERGE_COURSE = """
MATCH (d:Department {name: $dept_name, university: $university_name})
MERGE (c:Course {code: $code, university: $university_name})
SET c.name           = $name,
    c.ects           = $ects,
    c.hours_theory   = $hours_theory,
    c.hours_practice = $hours_practice,
    c.purpose        = $purpose,
    c.description    = $description,
    c.semester       = $semester,
    c.year           = $year,
    c.language       = $language,
    c.embedding      = $embedding,
    c.weekly_topics  = $weekly_topics,
    c.resources      = $resources,
    c.topics_embedding = $topics_embedding
MERGE (d)-[:OFFERS]->(c)
"""

# Course type ------------------------------------------------------------------

MERGE_COURSE_TYPE = """
MERGE (ct:CourseType {name: $type_name})
RETURN ct
"""

LINK_COURSE_TYPE = """
MATCH (c:Course {code: $code, university: $university_name})
MATCH (ct:CourseType {name: $type_name})
MERGE (c)-[:HAS_TYPE]->(ct)
"""

# Learning outcomes ------------------------------------------------------------

MERGE_LEARNING_OUTCOME = """
MATCH (c:Course {code: $code, university: $university_name})
MERGE (lo:LearningOutcome {
    text: $text,
    course_code: $code,
    university: $university_name
})
SET lo.embedding = $embedding,
    lo.index     = $index
MERGE (c)-[:HAS_OUTCOME]->(lo)
"""

# Categories -------------------------------------------------------------------

MERGE_CATEGORY = """
MERGE (cat:Category {name: $category_name})
RETURN cat
"""

LINK_COURSE_CATEGORY = """
MATCH (c:Course {code: $code, university: $university_name})
MATCH (cat:Category {name: $category_name})
MERGE (c)-[:BELONGS_TO]->(cat)
"""

# Prerequisites ----------------------------------------------------------------

LINK_PREREQUISITE = """
MATCH (c:Course {code: $code, university: $university_name})
MATCH (p:Course {code: $prereq_code, university: $university_name})
MERGE (c)-[:REQUIRES]->(p)
"""


# ---------------------------------------------------------------------------
# Ingestion Logic
# ---------------------------------------------------------------------------

def ingest_university(tx, data: dict) -> None:
    """Ingest all data from a single university JSON object."""

    university_name = data.get("university_name", "Unknown")
    dept_name = data.get("department", "Unknown")
    faculty_name = data.get("faculty", "Unknown")
    uni_type = data.get("type", "")
    language = data.get("language", "")
    department_url = data.get("department_url", "")

    # --- University, Faculty, Department -------------------------------------
    tx.run(MERGE_UNIVERSITY, name=university_name, type=uni_type,
           language=language, department_url=department_url)
    tx.run(MERGE_FACULTY, faculty_name=faculty_name,
           university_name=university_name)
    tx.run(MERGE_DEPARTMENT, dept_name=dept_name,
           university_name=university_name)
    tx.run(LINK_UNIVERSITY_FACULTY, university_name=university_name,
           faculty_name=faculty_name)
    tx.run(LINK_FACULTY_DEPARTMENT, faculty_name=faculty_name,
           university_name=university_name, dept_name=dept_name)

    # --- Academic Staff ------------------------------------------------------
    staff = data.get("academic_staff", {})
    tx.run(MERGE_ACADEMIC_STAFF,
           dept_name=dept_name,
           university_name=university_name,
           professor=staff.get("professor", 0),
           associate_professor=staff.get("associate_professor", 0),
           assistant_professor=staff.get("assistant_professor", 0),
           lecturer=staff.get("lecturer", 0),
           research_assistant=staff.get("research_assistant", 0),
           total=staff.get("total", 0))

    # --- Program Outcomes ----------------------------------------------------
    for idx, outcome_text in enumerate(data.get("program_outcomes", [])):
        po_embedding = generate_embedding(outcome_text)
        tx.run(MERGE_PROGRAM_OUTCOME,
               dept_name=dept_name,
               university_name=university_name,
               text=outcome_text,
               index=idx,
               embedding=po_embedding)

    # --- Courses -------------------------------------------------------------
    courses = data.get("courses", [])
    for course in courses:
        ingest_course(tx, course, dept_name, university_name)


def ingest_course(tx, course: dict, dept_name: str, university_name: str) -> None:
    """Ingest a single course with all its relationships."""

    code = course.get("code", "")
    name = course.get("name", "")
    ects = course.get("ects", 0)
    hours_theory = course.get("hours_theory", 0) or 0
    hours_practice = course.get("hours_practice", 0) or 0
    purpose = course.get("purpose") or ""
    description = course.get("description") or ""
    semester = course.get("semester", 0)
    year = course.get("year", 0)
    course_language = course.get("language", "")
    course_type = course.get("type", "")

    # Combine purpose + description for embedding
    combined_text = " ".join(filter(None, [purpose, description])).strip()
    embedding = generate_embedding(combined_text) if combined_text else None

    # Weekly topics and resources
    weekly_topics = course.get("weekly_topics", []) or []
    resources = course.get("resources", []) or []

    # Topics embedding (combine all weekly topics into single embedding)
    topics_text = " ".join([t for t in weekly_topics if t and t.strip() != "-"]).strip()
    topics_embedding = generate_embedding(topics_text) if topics_text else None

    # --- Course node ---------------------------------------------------------
    tx.run(MERGE_COURSE,
           dept_name=dept_name,
           university_name=university_name,
           code=code,
           name=name,
           ects=ects,
           hours_theory=hours_theory,
           hours_practice=hours_practice,
           purpose=purpose if purpose else None,
           description=description if description else None,
           semester=semester,
           year=year,
           language=course_language,
           embedding=embedding,
           weekly_topics=weekly_topics,
           resources=resources,
           topics_embedding=topics_embedding)

    # --- Course Type ---------------------------------------------------------
    if course_type:
        tx.run(MERGE_COURSE_TYPE, type_name=course_type)
        tx.run(LINK_COURSE_TYPE, code=code,
               university_name=university_name, type_name=course_type)

    # --- Learning Outcomes ---------------------------------------------------
    for idx, lo_text in enumerate(course.get("learning_outcomes", [])):
        lo_embedding = generate_embedding(lo_text)
        tx.run(MERGE_LEARNING_OUTCOME,
               code=code,
               university_name=university_name,
               text=lo_text,
               embedding=lo_embedding,
               index=idx)

    # --- Categories ----------------------------------------------------------
    for cat in course.get("categories", []):
        if cat:  # skip empty strings
            tx.run(MERGE_CATEGORY, category_name=cat)
            tx.run(LINK_COURSE_CATEGORY, code=code,
                   university_name=university_name, category_name=cat)

    # --- Prerequisites -------------------------------------------------------
    for prereq_code in course.get("prerequisites", []):
        if prereq_code:
            tx.run(LINK_PREREQUISITE, code=code,
                   university_name=university_name,
                   prereq_code=prereq_code)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    """Main entry point: load JSON files and ingest into Neo4j."""

    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    json_files = sorted(glob.glob(os.path.join(data_dir, "*.json")))

    if not json_files:
        logger.error("No JSON files found in %s", data_dir)
        return

    logger.info("Found %d JSON file(s): %s",
                len(json_files), [os.path.basename(f) for f in json_files])

    # Pre-load the embedding model so progress is clear
    get_model()

    # Connect to Neo4j
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    logger.info("Connected to Neo4j at %s", NEO4J_URI)

    try:
        for json_file in json_files:
            file_name = os.path.basename(json_file)
            logger.info("=" * 60)
            logger.info("Processing: %s", file_name)
            logger.info("=" * 60)

            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            university_name = data.get("university_name", file_name)
            course_count = len(data.get("courses", []))
            logger.info("University: %s (%d courses)", university_name, course_count)

            with driver.session() as session:
                session.execute_write(lambda tx: ingest_university(tx, data))

            logger.info("✓ Completed: %s", university_name)

    finally:
        driver.close()
        logger.info("Neo4j connection closed.")

    logger.info("=" * 60)
    logger.info("All files ingested successfully!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

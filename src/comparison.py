"""
comparison.py — Semantic Similarity & Department Comparison Module (Step 3)

Provides 11 total comparison functions:
    Original:
        1. Course Similarity (content-based)
        2. Staff Comparison
        3. Workload Comparison
    New:
        4. Program Outcome Similarity
        5. Learning Outcome Similarity (per-course)
        6. Curriculum Coverage Analysis (topic-based)
        7. Prerequisite Complexity
        8. Semester/Year Distribution
        9. Mandatory vs Elective Ratio
        10. Language Distribution
        11. Resource Overlap Analysis

Usage:
    from comparison import ComparisonEngine
    engine = ComparisonEngine()
    results = engine.find_similar_courses("Selçuk Üniversitesi", "Özyeğin Üniversitesi")
"""

import logging
from typing import Optional
from collections import Counter

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from neo4j import GraphDatabase

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cypher Queries
# ---------------------------------------------------------------------------

# --- Original queries -------------------------------------------------------

QUERY_COURSES_WITH_EMBEDDINGS = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
WHERE c.embedding IS NOT NULL
RETURN c.code AS code, c.name AS name, c.embedding AS embedding
"""

QUERY_ACADEMIC_STAFF = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:HAS_STAFF]->(s:AcademicStaff)
RETURN d.name          AS department,
       s.professor           AS professor,
       s.associate_professor AS associate_professor,
       s.assistant_professor AS assistant_professor,
       s.lecturer             AS lecturer,
       s.research_assistant   AS research_assistant,
       s.total                AS total
"""

QUERY_WORKLOAD = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
RETURN d.name           AS department,
       avg(c.ects)      AS avg_ects,
       avg(c.hours_theory)   AS avg_theory,
       avg(c.hours_practice) AS avg_practice,
       count(c)              AS course_count,
       sum(c.ects)           AS total_ects
"""

QUERY_ALL_UNIVERSITIES = """
MATCH (u:University)
RETURN u.name AS name, u.type AS type, u.language AS language
ORDER BY u.name
"""

QUERY_COURSES_BY_UNIVERSITY = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
OPTIONAL MATCH (c)-[:HAS_TYPE]->(ct:CourseType)
RETURN c.code        AS code,
       c.name        AS name,
       c.ects        AS ects,
       c.hours_theory   AS hours_theory,
       c.hours_practice AS hours_practice,
       ct.name          AS type,
       c.semester       AS semester,
       c.year           AS year
ORDER BY c.year, c.semester, c.code
"""

# --- New queries for extended metrics ----------------------------------------

QUERY_PROGRAM_OUTCOMES = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:HAS_PROGRAM_OUTCOME]->(po:ProgramOutcome)
WHERE po.embedding IS NOT NULL
  AND ($dept_keyword IS NULL OR toLower(d.name) CONTAINS toLower($dept_keyword))
RETURN po.text AS text, po.embedding AS embedding, po.index AS index
ORDER BY po.index
"""

QUERY_LEARNING_OUTCOMES_BY_COURSE = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->()-[:OFFERS]->(c:Course {code: $course_code})-[:HAS_OUTCOME]->(lo:LearningOutcome)
WHERE lo.embedding IS NOT NULL
RETURN lo.text AS text, lo.embedding AS embedding, lo.index AS index
ORDER BY lo.index
"""

QUERY_TOPICS_EMBEDDINGS = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
WHERE c.topics_embedding IS NOT NULL
RETURN c.code AS code, c.name AS name, c.topics_embedding AS embedding
"""

QUERY_PREREQUISITES = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
OPTIONAL MATCH (c)-[:REQUIRES]->(p:Course)
RETURN c.code AS code, c.name AS name, collect(p.code) AS prerequisites
"""

QUERY_PREREQUISITE_CHAINS = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
OPTIONAL MATCH path = (c)-[:REQUIRES*]->(root:Course)
RETURN c.code AS code, c.name AS name, 
       CASE WHEN path IS NULL THEN 0 ELSE length(path) END AS chain_depth
ORDER BY chain_depth DESC
"""

QUERY_COURSE_DETAILS = """
MATCH (u:University {name: $university_name})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:OFFERS]->(c:Course)
OPTIONAL MATCH (c)-[:HAS_TYPE]->(ct:CourseType)
RETURN c.code AS code, c.name AS name, c.ects AS ects,
       c.hours_theory AS hours_theory, c.hours_practice AS hours_practice,
       ct.name AS type, c.semester AS semester, c.year AS year,
       c.language AS language, c.resources AS resources
ORDER BY c.year, c.semester
"""


# ---------------------------------------------------------------------------
# ComparisonEngine
# ---------------------------------------------------------------------------

class ComparisonEngine:
    """Engine for running comparisons between university departments."""

    def __init__(self):
        self.driver = GraphDatabase.driver(
            NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)
        )

    def close(self):
        """Close the Neo4j driver connection."""
        self.driver.close()

    # ==================================================================
    # ORIGINAL 3 METRICS
    # ==================================================================

    # ------------------------------------------------------------------
    # 1. Course Similarity
    # ------------------------------------------------------------------

    def find_similar_courses(
        self,
        university1: str,
        university2: str,
        top_n: int = 10,
    ) -> list[dict]:
        """Find the most semantically similar courses between two universities."""
        with self.driver.session() as session:
            records1 = session.run(
                QUERY_COURSES_WITH_EMBEDDINGS,
                university_name=university1,
            ).data()
            records2 = session.run(
                QUERY_COURSES_WITH_EMBEDDINGS,
                university_name=university2,
            ).data()

        if not records1 or not records2:
            return []

        codes1 = [r["code"] for r in records1]
        names1 = [r["name"] for r in records1]
        embs1 = np.array([r["embedding"] for r in records1])

        codes2 = [r["code"] for r in records2]
        names2 = [r["name"] for r in records2]
        embs2 = np.array([r["embedding"] for r in records2])

        sim_matrix = cosine_similarity(embs1, embs2)

        pairs = []
        for i in range(len(codes1)):
            for j in range(len(codes2)):
                pairs.append({
                    "course1_code": codes1[i],
                    "course1_name": names1[i],
                    "course2_code": codes2[j],
                    "course2_name": names2[j],
                    "similarity_pct": round(float(sim_matrix[i, j]) * 100, 2),
                })

        pairs.sort(key=lambda x: x["similarity_pct"], reverse=True)
        return pairs[:top_n]

    # ------------------------------------------------------------------
    # 2. Staff Comparison
    # ------------------------------------------------------------------

    def compare_staff(self, university1: str, university2: str) -> dict:
        """Compare academic staff between two university departments."""
        with self.driver.session() as session:
            staff1 = session.run(
                QUERY_ACADEMIC_STAFF, university_name=university1
            ).data()
            staff2 = session.run(
                QUERY_ACADEMIC_STAFF, university_name=university2
            ).data()

        s1 = staff1[0] if staff1 else {}
        s2 = staff2[0] if staff2 else {}

        roles = [
            "professor", "associate_professor", "assistant_professor",
            "lecturer", "research_assistant", "total",
        ]

        comparison = {}
        for role in roles:
            v1 = s1.get(role, 0) or 0
            v2 = s2.get(role, 0) or 0
            comparison[f"{role}_diff"] = v1 - v2

        return {
            "university1": {"name": university1, "staff": s1},
            "university2": {"name": university2, "staff": s2},
            "comparison": comparison,
        }

    # ------------------------------------------------------------------
    # 3. Workload Comparison
    # ------------------------------------------------------------------

    def compare_workload(self, university1: str, university2: str) -> dict:
        """Compare average ECTS and theory/practice ratios."""
        with self.driver.session() as session:
            wl1 = session.run(QUERY_WORKLOAD, university_name=university1).data()
            wl2 = session.run(QUERY_WORKLOAD, university_name=university2).data()

        w1 = wl1[0] if wl1 else {}
        w2 = wl2[0] if wl2 else {}

        def safe_ratio(theory, practice):
            t = theory or 0
            p = practice or 0
            if p == 0:
                return float("inf") if t > 0 else 0.0
            return round(t / p, 2)

        def build_workload(w, name):
            avg_theory = round(float(w.get("avg_theory", 0) or 0), 2)
            avg_practice = round(float(w.get("avg_practice", 0) or 0), 2)
            return {
                "name": name,
                "department": w.get("department", "N/A"),
                "course_count": w.get("course_count", 0),
                "total_ects": w.get("total_ects", 0),
                "avg_ects": round(float(w.get("avg_ects", 0) or 0), 2),
                "avg_theory_hours": avg_theory,
                "avg_practice_hours": avg_practice,
                "theory_practice_ratio": safe_ratio(avg_theory, avg_practice),
            }

        result1 = build_workload(w1, university1)
        result2 = build_workload(w2, university2)

        return {
            "university1": result1,
            "university2": result2,
            "comparison": {
                "avg_ects_diff": round(result1["avg_ects"] - result2["avg_ects"], 2),
                "avg_theory_diff": round(
                    result1["avg_theory_hours"] - result2["avg_theory_hours"], 2
                ),
                "avg_practice_diff": round(
                    result1["avg_practice_hours"] - result2["avg_practice_hours"], 2
                ),
                "course_count_diff": result1["course_count"] - result2["course_count"],
            },
        }

    # ==================================================================
    # NEW 8 METRICS
    # ==================================================================

    # ------------------------------------------------------------------
    # 4. Program Outcome Similarity
    # ------------------------------------------------------------------

    def compare_program_outcomes(
        self,
        university1: str,
        university2: str,
        top_n: int = 10,
        department: Optional[str] = None,
    ) -> dict:
        """Compare program outcomes semantically between two departments.

        Returns overall similarity score, top matching outcome pairs ve
        TÜM program çıktısı metinleri (frontend her hücre için tam metin
        gösterebilsin).

        Args:
            department: Departman kodu ('bilmuh' / 'yazmuh' / 'ybs'). Tanımlıysa
                Cypher Department.name'ine göre filter uygulanır — aynı üniversite
                altında çoklu programdan yanlış birleştirme yaşanmaz (örn.
                İzmir Ekonomi'nin BilMüh + YazMüh program çıktıları artık
                karışmıyor).
        """
        # Department code → Department.name keyword
        dept_map = {
            "bilmuh": "Bilgisayar",
            "yazmuh": "Yazılım",
            "ybs": "Yönetim Bilişim",
        }
        dept_keyword = dept_map.get(department) if department else None

        with self.driver.session() as session:
            po1 = session.run(
                QUERY_PROGRAM_OUTCOMES,
                university_name=university1,
                dept_keyword=dept_keyword,
            ).data()
            po2 = session.run(
                QUERY_PROGRAM_OUTCOMES,
                university_name=university2,
                dept_keyword=dept_keyword,
            ).data()

        # Tüm metinler (eşleşme olsun olmasın frontend göstersin)
        outcomes1 = [
            {"index": r["index"], "text": r["text"]} for r in po1
        ]
        outcomes2 = [
            {"index": r["index"], "text": r["text"]} for r in po2
        ]

        if not po1 or not po2:
            return {
                "university1": university1,
                "university2": university2,
                "outcome_count1": len(po1),
                "outcome_count2": len(po2),
                "outcomes1": outcomes1,
                "outcomes2": outcomes2,
                "overall_similarity_pct": 0,
                "top_matches": [],
                "note": "One or both universities have no program outcome embeddings.",
            }

        embs1 = np.array([r["embedding"] for r in po1])
        embs2 = np.array([r["embedding"] for r in po2])
        sim_matrix = cosine_similarity(embs1, embs2)

        # Best match for each outcome in uni1 → uni2
        best_matches = []
        for i in range(len(po1)):
            j_best = int(np.argmax(sim_matrix[i]))
            best_matches.append({
                "outcome1_index": po1[i]["index"],
                "outcome1_text": po1[i]["text"],
                "outcome2_index": po2[j_best]["index"],
                "outcome2_text": po2[j_best]["text"],
                "similarity_pct": round(float(sim_matrix[i, j_best]) * 100, 2),
            })

        best_matches.sort(key=lambda x: x["similarity_pct"], reverse=True)

        # Overall similarity = average of best match per outcome
        overall = round(
            float(np.mean([m["similarity_pct"] for m in best_matches])), 2
        )

        return {
            "university1": university1,
            "university2": university2,
            "outcome_count1": len(po1),
            "outcome_count2": len(po2),
            "outcomes1": outcomes1,
            "outcomes2": outcomes2,
            "overall_similarity_pct": overall,
            "top_matches": best_matches[:top_n],
        }

    # ------------------------------------------------------------------
    # 5. Learning Outcome Similarity (per-course pair)
    # ------------------------------------------------------------------

    def compare_learning_outcomes(
        self,
        university1: str,
        course_code1: str,
        university2: str,
        course_code2: str,
    ) -> dict:
        """Compare learning outcomes of two specific courses semantically."""
        with self.driver.session() as session:
            lo1 = session.run(
                QUERY_LEARNING_OUTCOMES_BY_COURSE,
                university_name=university1,
                course_code=course_code1,
            ).data()
            lo2 = session.run(
                QUERY_LEARNING_OUTCOMES_BY_COURSE,
                university_name=university2,
                course_code=course_code2,
            ).data()

        if not lo1 or not lo2:
            return {
                "course1": {"university": university1, "code": course_code1, "outcome_count": len(lo1)},
                "course2": {"university": university2, "code": course_code2, "outcome_count": len(lo2)},
                "overall_similarity_pct": 0,
                "matches": [],
                "note": "One or both courses have no learning outcome embeddings.",
            }

        embs1 = np.array([r["embedding"] for r in lo1])
        embs2 = np.array([r["embedding"] for r in lo2])
        sim_matrix = cosine_similarity(embs1, embs2)

        matches = []
        for i in range(len(lo1)):
            j_best = int(np.argmax(sim_matrix[i]))
            matches.append({
                "lo1_text": lo1[i]["text"][:150] + "..." if len(lo1[i]["text"]) > 150 else lo1[i]["text"],
                "lo2_text": lo2[j_best]["text"][:150] + "..." if len(lo2[j_best]["text"]) > 150 else lo2[j_best]["text"],
                "similarity_pct": round(float(sim_matrix[i, j_best]) * 100, 2),
            })

        overall = round(float(np.mean([m["similarity_pct"] for m in matches])), 2)

        return {
            "course1": {"university": university1, "code": course_code1, "outcome_count": len(lo1)},
            "course2": {"university": university2, "code": course_code2, "outcome_count": len(lo2)},
            "overall_similarity_pct": overall,
            "matches": sorted(matches, key=lambda x: x["similarity_pct"], reverse=True),
        }

    # ------------------------------------------------------------------
    # 6. Curriculum Coverage Analysis (topic-based)
    # ------------------------------------------------------------------

    def compare_curriculum_coverage(
        self,
        university1: str,
        university2: str,
        top_n: int = 10,
    ) -> dict:
        """Compare curriculum coverage using weekly topics embeddings.

        Finds which courses in uni1 cover similar topics as courses in uni2,
        and identifies unique courses with no close match.
        """
        with self.driver.session() as session:
            t1 = session.run(
                QUERY_TOPICS_EMBEDDINGS, university_name=university1
            ).data()
            t2 = session.run(
                QUERY_TOPICS_EMBEDDINGS, university_name=university2
            ).data()

        if not t1 or not t2:
            return {
                "university1": university1,
                "university2": university2,
                "note": "Insufficient topic embedding data.",
                "top_similar": [],
                "unique_to_uni1": [],
                "unique_to_uni2": [],
            }

        embs1 = np.array([r["embedding"] for r in t1])
        embs2 = np.array([r["embedding"] for r in t2])
        sim_matrix = cosine_similarity(embs1, embs2)

        # Best match per course in uni1
        threshold = 0.6  # below this = "unique"
        top_similar = []
        unique_to_uni1 = []

        for i in range(len(t1)):
            j_best = int(np.argmax(sim_matrix[i]))
            sim = float(sim_matrix[i, j_best])
            pair = {
                "course1_code": t1[i]["code"],
                "course1_name": t1[i]["name"],
                "course2_code": t2[j_best]["code"],
                "course2_name": t2[j_best]["name"],
                "similarity_pct": round(sim * 100, 2),
            }
            if sim >= threshold:
                top_similar.append(pair)
            else:
                unique_to_uni1.append({
                    "code": t1[i]["code"],
                    "name": t1[i]["name"],
                    "best_match_similarity_pct": round(sim * 100, 2),
                })

        unique_to_uni2 = []
        for j in range(len(t2)):
            i_best = int(np.argmax(sim_matrix[:, j]))
            sim = float(sim_matrix[i_best, j])
            if sim < threshold:
                unique_to_uni2.append({
                    "code": t2[j]["code"],
                    "name": t2[j]["name"],
                    "best_match_similarity_pct": round(sim * 100, 2),
                })

        top_similar.sort(key=lambda x: x["similarity_pct"], reverse=True)

        return {
            "university1": university1,
            "university2": university2,
            "matched_courses": len(top_similar),
            "unique_to_uni1_count": len(unique_to_uni1),
            "unique_to_uni2_count": len(unique_to_uni2),
            "top_similar": top_similar[:top_n],
            "unique_to_uni1": unique_to_uni1,
            "unique_to_uni2": unique_to_uni2,
        }

    # ------------------------------------------------------------------
    # 7. Prerequisite Complexity
    # ------------------------------------------------------------------

    def compare_prerequisites(self, university1: str, university2: str) -> dict:
        """Compare prerequisite tree complexity between departments."""
        with self.driver.session() as session:
            prereq1 = session.run(
                QUERY_PREREQUISITES, university_name=university1
            ).data()
            prereq2 = session.run(
                QUERY_PREREQUISITES, university_name=university2
            ).data()
            chains1 = session.run(
                QUERY_PREREQUISITE_CHAINS, university_name=university1
            ).data()
            chains2 = session.run(
                QUERY_PREREQUISITE_CHAINS, university_name=university2
            ).data()

        def analyze_prereqs(prereqs, chains, name):
            courses_with_prereqs = [p for p in prereqs if p["prerequisites"]]
            total_prereq_links = sum(len(p["prerequisites"]) for p in prereqs)
            max_depth = max((c["chain_depth"] for c in chains), default=0)
            avg_depth = round(
                np.mean([c["chain_depth"] for c in chains if c["chain_depth"] > 0]), 2
            ) if any(c["chain_depth"] > 0 for c in chains) else 0

            # Find deepest chain course
            deepest = next(
                (c for c in chains if c["chain_depth"] == max_depth), {}
            ) if max_depth > 0 else {}

            # Frontend PrereqGraph (ReactFlow) ham edge listesi bekliyor.
            # QUERY_PREREQUISITES her kurs için collect(p.code) döndürüyor —
            # düzleştirip {course, prerequisite} çiftlerine açıyoruz.
            edges = [
                {"course": p["code"], "prerequisite": pr}
                for p in prereqs
                for pr in (p.get("prerequisites") or [])
                if pr
            ]

            return {
                "name": name,
                "total_courses": len(prereqs),
                "courses_with_prerequisites": len(courses_with_prereqs),
                "courses_without_prerequisites": len(prereqs) - len(courses_with_prereqs),
                "total_prerequisite_links": total_prereq_links,
                "max_chain_depth": max_depth,
                "avg_chain_depth": avg_depth,
                "deepest_chain_course": deepest.get("name", "N/A"),
                "prerequisite_ratio_pct": round(
                    len(courses_with_prereqs) / max(len(prereqs), 1) * 100, 1
                ),
                "edges": edges,
            }

        result1 = analyze_prereqs(prereq1, chains1, university1)
        result2 = analyze_prereqs(prereq2, chains2, university2)

        return {
            "university1": result1,
            "university2": result2,
            "comparison": {
                "prereq_ratio_diff": round(
                    result1["prerequisite_ratio_pct"] - result2["prerequisite_ratio_pct"], 1
                ),
                "max_depth_diff": result1["max_chain_depth"] - result2["max_chain_depth"],
                "total_links_diff": result1["total_prerequisite_links"] - result2["total_prerequisite_links"],
            },
        }

    # ------------------------------------------------------------------
    # 8. Semester/Year Distribution
    # ------------------------------------------------------------------

    def compare_semester_distribution(self, university1: str, university2: str) -> dict:
        """Compare ECTS and course distribution across semesters/years."""
        with self.driver.session() as session:
            courses1 = session.run(
                QUERY_COURSE_DETAILS, university_name=university1
            ).data()
            courses2 = session.run(
                QUERY_COURSE_DETAILS, university_name=university2
            ).data()

        def analyze_distribution(courses, name):
            by_year = {}
            for c in courses:
                yr = c.get("year", 0) or 0
                sem = c.get("semester", 0) or 0
                key = f"year_{yr}_sem_{sem}"
                if key not in by_year:
                    by_year[key] = {"year": yr, "semester": sem, "courses": 0, "total_ects": 0}
                by_year[key]["courses"] += 1
                by_year[key]["total_ects"] += (c.get("ects", 0) or 0)

            distribution = sorted(by_year.values(), key=lambda x: (x["year"], x["semester"]))
            for d in distribution:
                d["avg_ects"] = round(d["total_ects"] / max(d["courses"], 1), 2)

            return {
                "name": name,
                "total_courses": len(courses),
                "distribution": distribution,
            }

        result1 = analyze_distribution(courses1, university1)
        result2 = analyze_distribution(courses2, university2)

        return {
            "university1": result1,
            "university2": result2,
        }

    # ------------------------------------------------------------------
    # 9. Mandatory vs Elective Ratio
    # ------------------------------------------------------------------

    def compare_mandatory_elective(self, university1: str, university2: str) -> dict:
        """Compare mandatory vs elective course ratios."""
        with self.driver.session() as session:
            courses1 = session.run(
                QUERY_COURSE_DETAILS, university_name=university1
            ).data()
            courses2 = session.run(
                QUERY_COURSE_DETAILS, university_name=university2
            ).data()

        def analyze_types(courses, name):
            total = len(courses)
            type_counts = Counter(c.get("type", "bilinmiyor") or "bilinmiyor" for c in courses)
            mandatory = type_counts.get("zorunlu", 0)
            elective = type_counts.get("seçmeli", 0) + type_counts.get("secmeli", 0)
            other = total - mandatory - elective

            return {
                "name": name,
                "total_courses": total,
                "mandatory": mandatory,
                "elective": elective,
                "other": other,
                "mandatory_pct": round(mandatory / max(total, 1) * 100, 1),
                "elective_pct": round(elective / max(total, 1) * 100, 1),
                "type_breakdown": dict(type_counts),
            }

        result1 = analyze_types(courses1, university1)
        result2 = analyze_types(courses2, university2)

        return {
            "university1": result1,
            "university2": result2,
            "comparison": {
                "mandatory_pct_diff": round(
                    result1["mandatory_pct"] - result2["mandatory_pct"], 1
                ),
                "elective_pct_diff": round(
                    result1["elective_pct"] - result2["elective_pct"], 1
                ),
                "elective_count_diff": result1["elective"] - result2["elective"],
            },
        }

    # ------------------------------------------------------------------
    # 10. Language Distribution
    # ------------------------------------------------------------------

    def compare_language_distribution(self, university1: str, university2: str) -> dict:
        """Compare the language distribution of courses."""
        with self.driver.session() as session:
            courses1 = session.run(
                QUERY_COURSE_DETAILS, university_name=university1
            ).data()
            courses2 = session.run(
                QUERY_COURSE_DETAILS, university_name=university2
            ).data()

        def analyze_languages(courses, name):
            total = len(courses)
            lang_counts = Counter(
                (c.get("language") or "Belirtilmemiş").strip() for c in courses
            )

            breakdown = []
            for lang, count in lang_counts.most_common():
                breakdown.append({
                    "language": lang,
                    "count": count,
                    "percentage": round(count / max(total, 1) * 100, 1),
                })

            return {
                "name": name,
                "total_courses": total,
                "languages": breakdown,
            }

        result1 = analyze_languages(courses1, university1)
        result2 = analyze_languages(courses2, university2)

        return {
            "university1": result1,
            "university2": result2,
        }

    # ------------------------------------------------------------------
    # 11. Resource Overlap Analysis
    # ------------------------------------------------------------------

    def compare_resources(self, university1: str, university2: str) -> dict:
        """Analyze textbook/resource overlap between two departments."""
        with self.driver.session() as session:
            courses1 = session.run(
                QUERY_COURSE_DETAILS, university_name=university1
            ).data()
            courses2 = session.run(
                QUERY_COURSE_DETAILS, university_name=university2
            ).data()

        def extract_resources(courses):
            resources = {}
            for c in courses:
                for res in (c.get("resources") or []):
                    if res and res.strip():
                        key = res.strip().lower()
                        if key not in resources:
                            resources[key] = {
                                "text": res.strip(),
                                "courses": [],
                            }
                        resources[key]["courses"].append(c.get("code", ""))
            return resources

        res1 = extract_resources(courses1)
        res2 = extract_resources(courses2)

        # Find overlaps via keyword matching (author names, book titles)
        shared = []
        for key1, val1 in res1.items():
            for key2, val2 in res2.items():
                # Check for significant keyword overlap
                words1 = set(w for w in key1.split() if len(w) > 3)
                words2 = set(w for w in key2.split() if len(w) > 3)
                if not words1 or not words2:
                    continue
                overlap = words1 & words2
                overlap_ratio = len(overlap) / min(len(words1), len(words2))
                if overlap_ratio >= 0.3 and len(overlap) >= 2:
                    shared.append({
                        "resource_uni1": val1["text"][:120],
                        "courses_uni1": val1["courses"],
                        "resource_uni2": val2["text"][:120],
                        "courses_uni2": val2["courses"],
                        "matching_keywords": list(overlap)[:5],
                        "overlap_score": round(overlap_ratio * 100, 1),
                    })

        # Deduplicate — keep highest overlap score per pair
        seen = set()
        unique_shared = []
        for s in sorted(shared, key=lambda x: x["overlap_score"], reverse=True):
            pair_key = (s["resource_uni1"][:50], s["resource_uni2"][:50])
            if pair_key not in seen:
                seen.add(pair_key)
                unique_shared.append(s)

        return {
            "university1": {"name": university1, "unique_resources": len(res1)},
            "university2": {"name": university2, "unique_resources": len(res2)},
            "shared_resources": unique_shared,
            "shared_count": len(unique_shared),
        }

    # ------------------------------------------------------------------
    # Utility Queries
    # ------------------------------------------------------------------

    def list_universities(self) -> list[dict]:
        """List all universities in the graph."""
        with self.driver.session() as session:
            return session.run(QUERY_ALL_UNIVERSITIES).data()

    def list_courses(self, university_name: str) -> list[dict]:
        """List all courses for a given university."""
        with self.driver.session() as session:
            return session.run(
                QUERY_COURSES_BY_UNIVERSITY,
                university_name=university_name,
            ).data()

    # ------------------------------------------------------------------
    # Dashboard Methods
    # ------------------------------------------------------------------

    def get_dashboard_stats(self) -> dict:
        """Get aggregate statistics for the dashboard."""
        with self.driver.session() as session:
            # Total universities
            uni_count = session.run(
                "MATCH (u:University) RETURN count(u) AS count"
            ).single()["count"]

            # Total courses
            course_count = session.run(
                "MATCH (c:Course) RETURN count(c) AS count"
            ).single()["count"]

            # Total ECTS
            total_ects = session.run(
                "MATCH (c:Course) RETURN sum(c.ects) AS total"
            ).single()["total"] or 0

            # Total program outcomes
            po_count = session.run(
                "MATCH (po:ProgramOutcome) RETURN count(po) AS count"
            ).single()["count"]

            # Total learning outcomes
            lo_count = session.run(
                "MATCH (lo:LearningOutcome) RETURN count(lo) AS count"
            ).single()["count"]

            # Average ECTS
            avg_ects = session.run(
                "MATCH (c:Course) RETURN round(avg(c.ects) * 100) / 100 AS avg"
            ).single()["avg"] or 0

            # Total categories
            cat_count = session.run(
                "MATCH (cat:Category) RETURN count(cat) AS count"
            ).single()["count"]

        return {
            "university_count": uni_count,
            "course_count": course_count,
            "total_ects": total_ects,
            "avg_ects": avg_ects,
            "program_outcome_count": po_count,
            "learning_outcome_count": lo_count,
            "category_count": cat_count,
        }

    def get_university_chart_data(self, university_name: str) -> dict:
        """Get chart-ready data for a specific university."""
        with self.driver.session() as session:
            courses = session.run(
                QUERY_COURSE_DETAILS, university_name=university_name
            ).data()

        if not courses:
            return {"university": university_name, "error": "No courses found."}

        # Course type distribution (for doughnut chart)
        type_counts = Counter(
            (c.get("type") or "Belirtilmemiş") for c in courses
        )
        type_distribution = [
            {"label": k, "value": v} for k, v in type_counts.most_common()
        ]

        # Semester ECTS distribution (for bar chart)
        semester_data = {}
        for c in courses:
            yr = c.get("year", 0) or 0
            sem = c.get("semester", 0) or 0
            key = f"{yr}. Yıl / {sem}. Dönem"
            if key not in semester_data:
                semester_data[key] = {"label": key, "ects": 0, "count": 0, "sort": yr * 10 + sem}
            semester_data[key]["ects"] += (c.get("ects", 0) or 0)
            semester_data[key]["count"] += 1

        semester_distribution = sorted(semester_data.values(), key=lambda x: x["sort"])

        # Language distribution (for pie chart)
        lang_counts = Counter(
            (c.get("language") or "Belirtilmemiş").strip() for c in courses
        )
        language_distribution = [
            {"label": k, "value": v} for k, v in lang_counts.most_common()
        ]

        # ECTS histogram
        ects_counts = Counter(c.get("ects", 0) or 0 for c in courses)
        ects_histogram = sorted(
            [{"ects": k, "count": v} for k, v in ects_counts.items()],
            key=lambda x: x["ects"]
        )

        return {
            "university": university_name,
            "total_courses": len(courses),
            "type_distribution": type_distribution,
            "semester_distribution": semester_distribution,
            "language_distribution": language_distribution,
            "ects_histogram": ects_histogram,
        }

    # ------------------------------------------------------------------
    # Chatbot Methods
    # ------------------------------------------------------------------

    def get_chatbot_context(self, question: str) -> str:
        """Build context from the knowledge graph for the chatbot."""
        with self.driver.session() as session:
            # Get university list
            universities = session.run(QUERY_ALL_UNIVERSITIES).data()
            uni_names = [u["name"] for u in universities]

            # Get faculty, department, and staff info per university
            uni_details = {}
            for uni in uni_names:
                # Faculty and department structure
                faculty_dept = session.run("""
                    MATCH (u:University {name: $uni})-[:HAS_FACULTY]->(f)-[:HAS_DEPARTMENT]->(d)
                    RETURN f.name AS faculty, d.name AS department
                """, uni=uni).data()

                # Staff info (stored as count properties on a single node per dept)
                staff_info = session.run("""
                    MATCH (u:University {name: $uni})-[:HAS_FACULTY]->()-[:HAS_DEPARTMENT]->(d)-[:HAS_STAFF]->(s:AcademicStaff)
                    RETURN d.name AS department,
                           s.professor AS professor,
                           s.associate_professor AS associate_professor,
                           s.assistant_professor AS assistant_professor,
                           s.lecturer AS lecturer,
                           s.research_assistant AS research_assistant,
                           s.total AS total
                """, uni=uni).data()

                uni_details[uni] = {
                    "faculties": faculty_dept,
                    "staff": staff_info,
                }

            # Get course counts per university
            uni_stats = []
            for uni in uni_names:
                courses = session.run(
                    QUERY_COURSE_DETAILS, university_name=uni
                ).data()
                total_ects = sum(c.get("ects", 0) or 0 for c in courses)
                types = Counter((c.get("type") or "bilinmiyor") for c in courses)
                langs = Counter((c.get("language") or "Belirtilmemiş").strip() for c in courses)

                # Collect course names for richer context
                course_list = [
                    f"{c.get('code', '?')} - {c.get('name', '?')} ({c.get('ects', '?')} AKTS, {c.get('type', '?')})"
                    for c in courses[:30]  # Limit to avoid token overflow
                ]

                uni_stats.append({
                    "name": uni,
                    "course_count": len(courses),
                    "total_ects": total_ects,
                    "avg_ects": round(total_ects / max(len(courses), 1), 2),
                    "types": dict(types),
                    "languages": dict(langs),
                    "course_list": course_list,
                })

            # Get program outcomes
            all_outcomes = {}
            for uni in uni_names:
                outcomes = session.run(
                    QUERY_PROGRAM_OUTCOMES, university_name=uni
                ).data()
                all_outcomes[uni] = [o["text"][:100] for o in outcomes[:5]]

        # Build context string
        context_parts = ["=== Bilgi Grafiği Veritabanı Bilgileri ===\n"]
        context_parts.append(f"Toplam {len(uni_names)} üniversite bulunmaktadır: {', '.join(uni_names)}\n")

        for stat in uni_stats:
            uni = stat['name']
            context_parts.append(f"\n--- {uni} ---")

            # Faculty and department info
            details = uni_details.get(uni, {})
            faculties = details.get("faculties", [])
            if faculties:
                faculty_groups = {}
                for fd in faculties:
                    fname = fd.get("faculty", "Bilinmiyor")
                    dname = fd.get("department", "Bilinmiyor")
                    faculty_groups.setdefault(fname, []).append(dname)
                for fname, depts in faculty_groups.items():
                    context_parts.append(f"Fakülte: {fname}")
                    context_parts.append(f"  Bölümler: {', '.join(depts)}")

            # Staff info
            staff_list = details.get("staff", [])
            if staff_list:
                for s in staff_list:
                    dept = s.get("department", "Bilinmiyor")
                    total = s.get("total", 0) or 0
                    parts = []
                    for key, label in [
                        ("professor", "Profesör"),
                        ("associate_professor", "Doçent"),
                        ("assistant_professor", "Dr. Öğr. Üyesi"),
                        ("lecturer", "Öğretim Görevlisi"),
                        ("research_assistant", "Araştırma Görevlisi"),
                    ]:
                        val = s.get(key, 0) or 0
                        if val > 0:
                            parts.append(f"{val} {label}")
                    staff_str = ", ".join(parts) if parts else "Bilgi yok"
                    context_parts.append(f"  Akademik kadro ({dept}): Toplam {total} kişi — {staff_str}")

            context_parts.append(f"Ders sayısı: {stat['course_count']}")
            context_parts.append(f"Toplam AKTS: {stat['total_ects']}, Ortalama AKTS: {stat['avg_ects']}")
            context_parts.append(f"Ders türleri: {stat['types']}")
            context_parts.append(f"Eğitim dilleri: {stat['languages']}")

            # Course list
            if stat['course_list']:
                context_parts.append(f"Dersler (ilk 30): {'; '.join(stat['course_list'])}")

            if uni in all_outcomes and all_outcomes[uni]:
                context_parts.append(f"Program çıktıları (ilk 5): {all_outcomes[uni]}")

        return "\n".join(context_parts)

    def answer_question(self, question: str) -> str:
        """Answer a question using Groq API with Neo4j context."""
        from groq import Groq
        from config import GROQ_API_KEY

        if not GROQ_API_KEY:
            return "Groq API anahtarı yapılandırılmamış. Lütfen .env dosyasına GROQ_API_KEY ekleyin."

        # Get context from knowledge graph
        context = self.get_chatbot_context(question)

        # Configure Groq client
        client = Groq(api_key=GROQ_API_KEY)

        system_prompt = """Sen UniCurriculum adlı bilişim müfredatları karşılaştırma sisteminin yapay zeka asistanısın.
Aşağıda Neo4j bilgi grafiğinden çekilen veriler var. Kullanıcının sorusunu bu verilere dayanarak Türkçe olarak yanıtla.
Cevaplarını kısa, net ve bilgilendirici tut. Veri yoksa veya emin değilsen bunu belirt."""

        user_message = f"""{context}

Kullanıcı sorusu: {question}"""

        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.4,
                max_tokens=1024,
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Üzgünüm, yanıt oluşturulurken bir hata oluştu: {str(e)}"

    # ------------------------------------------------------------------
    # Heatmap: University Similarity Matrix
    # ------------------------------------------------------------------

    def get_heatmap_data(self) -> dict:
        """Compute average course similarity for all university pairs."""
        universities = self.list_universities()
        uni_names = [u["name"] for u in universities]

        # Pre-load embeddings for all universities
        embeddings = {}
        with self.driver.session() as session:
            for uni in uni_names:
                data = session.run(
                    QUERY_COURSES_WITH_EMBEDDINGS, university_name=uni
                ).data()
                if data:
                    embeddings[uni] = np.array([r["embedding"] for r in data])

        n = len(uni_names)
        matrix = [[0.0] * n for _ in range(n)]

        for i in range(n):
            matrix[i][i] = 100.0  # self-similarity
            for j in range(i + 1, n):
                if uni_names[i] in embeddings and uni_names[j] in embeddings:
                    sim = cosine_similarity(
                        embeddings[uni_names[i]], embeddings[uni_names[j]]
                    )
                    # Average of best matches from both directions
                    avg_i = float(np.mean(np.max(sim, axis=1)))
                    avg_j = float(np.mean(np.max(sim, axis=0)))
                    score = round((avg_i + avg_j) / 2 * 100, 1)
                else:
                    score = 0.0
                matrix[i][j] = score
                matrix[j][i] = score

        return {
            "universities": uni_names,
            "matrix": matrix,
        }

    # ------------------------------------------------------------------
    # Radar Chart Data
    # ------------------------------------------------------------------

    def get_radar_data(self) -> dict:
        """Get normalized multi-axis data for radar chart comparison."""
        universities = self.list_universities()
        uni_names = [u["name"] for u in universities]

        raw_data = []
        with self.driver.session() as session:
            for uni in uni_names:
                courses = session.run(
                    QUERY_COURSE_DETAILS, university_name=uni
                ).data()
                staff_data = session.run(
                    QUERY_ACADEMIC_STAFF, university_name=uni
                ).data()
                prereq_data = session.run(
                    QUERY_PREREQUISITES, university_name=uni
                ).data()
                po_data = session.run(
                    QUERY_PROGRAM_OUTCOMES, university_name=uni
                ).data()

                total_ects = sum(c.get("ects", 0) or 0 for c in courses)
                total_staff = sum(s.get("total", 0) or 0 for s in staff_data)
                types = Counter((c.get("type") or "bilinmiyor") for c in courses)
                elective = types.get("seçmeli", 0) + types.get("secmeli", 0)
                elective_pct = round(elective / max(len(courses), 1) * 100, 1)
                prereq_courses = len([p for p in prereq_data if p.get("prerequisites")])
                prereq_pct = round(prereq_courses / max(len(prereq_data), 1) * 100, 1)

                raw_data.append({
                    "name": uni,
                    "course_count": len(courses),
                    "avg_ects": round(total_ects / max(len(courses), 1), 2),
                    "staff_count": total_staff,
                    "elective_pct": elective_pct,
                    "prereq_pct": prereq_pct,
                    "program_outcomes": len(po_data),
                })

        # Normalize each axis to 0-100
        axes = ["course_count", "avg_ects", "staff_count", "elective_pct", "prereq_pct", "program_outcomes"]
        axis_labels = ["Ders Sayısı", "Ort. AKTS", "Akademik Kadro", "Seçmeli %", "Önkoşul %", "Program Çıktısı"]

        max_vals = {}
        for ax in axes:
            max_vals[ax] = max((d[ax] for d in raw_data), default=1) or 1

        datasets = []
        for d in raw_data:
            values = [round(d[ax] / max_vals[ax] * 100, 1) for ax in axes]
            datasets.append({"name": d["name"], "values": values, "raw": {ax: d[ax] for ax in axes}})

        return {"labels": axis_labels, "datasets": datasets}

    # ------------------------------------------------------------------
    # Knowledge Graph Meta-Stats
    # ------------------------------------------------------------------

    def get_kg_meta_stats(self) -> dict:
        """Get total node and relationship counts in the knowledge graph."""
        with self.driver.session() as session:
            node_count = session.run(
                "MATCH (n) RETURN count(n) AS count"
            ).single()["count"]
            rel_count = session.run(
                "MATCH ()-[r]->() RETURN count(r) AS count"
            ).single()["count"]
            label_counts = session.run(
                "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC"
            ).data()
            rel_types = session.run(
                "MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY count DESC"
            ).data()

        return {
            "total_nodes": node_count,
            "total_relationships": rel_count,
            "node_labels": label_counts,
            "relationship_types": rel_types,
        }

    # ------------------------------------------------------------------
    # Composite Similarity Score
    # ------------------------------------------------------------------

    def get_composite_score(self, university1: str, university2: str) -> dict:
        """Calculate a weighted composite similarity score from multiple metrics."""
        scores = {}

        # 1. Course similarity (weight: 30%)
        try:
            similar = self.find_similar_courses(university1, university2, top_n=100)
            if similar:
                avg_sim = round(float(np.mean([s["similarity_pct"] for s in similar])), 2)
            else:
                avg_sim = 0
            scores["course_similarity"] = {"value": avg_sim, "weight": 30, "label": "Ders Benzerliği"}
        except Exception:
            scores["course_similarity"] = {"value": 0, "weight": 30, "label": "Ders Benzerliği"}

        # 2. Program outcome similarity (weight: 25%)
        try:
            po = self.compare_program_outcomes(university1, university2)
            scores["program_outcomes"] = {"value": po.get("overall_similarity_pct", 0), "weight": 25, "label": "Program Çıktıları"}
        except Exception:
            scores["program_outcomes"] = {"value": 0, "weight": 25, "label": "Program Çıktıları"}

        # 3. Workload similarity (weight: 15%)
        try:
            wl = self.compare_workload(university1, university2)
            w1, w2 = wl["university1"], wl["university2"]
            ects_diff = abs(w1["avg_ects"] - w2["avg_ects"])
            wl_score = max(0, round(100 - ects_diff * 10, 1))
            scores["workload"] = {"value": wl_score, "weight": 15, "label": "İş Yükü Uyumu"}
        except Exception:
            scores["workload"] = {"value": 0, "weight": 15, "label": "İş Yükü Uyumu"}

        # 4. Mandatory/elective ratio similarity (weight: 15%)
        try:
            me = self.compare_mandatory_elective(university1, university2)
            pct_diff = abs(me["comparison"]["mandatory_pct_diff"])
            me_score = max(0, round(100 - pct_diff * 2, 1))
            scores["mandatory_elective"] = {"value": me_score, "weight": 15, "label": "Zorunlu/Seçmeli Uyumu"}
        except Exception:
            scores["mandatory_elective"] = {"value": 0, "weight": 15, "label": "Zorunlu/Seçmeli Uyumu"}

        # 5. Curriculum coverage (weight: 15%)
        try:
            cc = self.compare_curriculum_coverage(university1, university2)
            total = cc.get("matched_courses", 0) + cc.get("unique_to_uni1_count", 0) + cc.get("unique_to_uni2_count", 0)
            if total > 0:
                cc_score = round(cc.get("matched_courses", 0) / total * 100, 1)
            else:
                cc_score = 0
            scores["curriculum_coverage"] = {"value": cc_score, "weight": 15, "label": "Müfredat Kapsamı"}
        except Exception:
            scores["curriculum_coverage"] = {"value": 0, "weight": 15, "label": "Müfredat Kapsamı"}

        # Weighted composite
        composite = round(
            sum(s["value"] * s["weight"] / 100 for s in scores.values()), 1
        )

        return {
            "university1": university1,
            "university2": university2,
            "composite_score": composite,
            "breakdown": scores,
        }


# ---------------------------------------------------------------------------
# CLI Demo
# ---------------------------------------------------------------------------

def main():
    """Quick demo of all comparison functions."""
    engine = ComparisonEngine()
    try:
        universities = engine.list_universities()
        print("\n📌 Universities in the Knowledge Graph:")
        for u in universities:
            print(f"   • {u['name']} ({u.get('type', '')})")

        if len(universities) < 2:
            print("\n⚠️  Need at least 2 universities for comparison.")
            return

        uni1 = universities[0]["name"]
        uni2 = universities[1]["name"]
        print(f"\n🔍 Comparing: {uni1}  vs  {uni2}")
        print("=" * 70)

        # 1. Course Similarity
        print("\n📊 1. Top 5 Most Similar Courses (content-based):")
        for pair in engine.find_similar_courses(uni1, uni2, 5):
            print(f"   [{pair['similarity_pct']:5.1f}%] {pair['course1_name']} ↔ {pair['course2_name']}")

        # 4. Program Outcome Similarity
        print("\n🎯 4. Program Outcome Similarity:")
        po = engine.compare_program_outcomes(uni1, uni2, 3)
        print(f"   Overall: {po['overall_similarity_pct']}%")

        # 7. Prerequisite Complexity
        print("\n🔗 7. Prerequisite Complexity:")
        prereq = engine.compare_prerequisites(uni1, uni2)
        p1, p2 = prereq["university1"], prereq["university2"]
        print(f"   {uni1}: {p1['courses_with_prerequisites']} courses with prereqs, max depth {p1['max_chain_depth']}")
        print(f"   {uni2}: {p2['courses_with_prerequisites']} courses with prereqs, max depth {p2['max_chain_depth']}")

        # 9. Mandatory vs Elective
        print("\n📋 9. Mandatory vs Elective:")
        me = engine.compare_mandatory_elective(uni1, uni2)
        m1, m2 = me["university1"], me["university2"]
        print(f"   {uni1}: {m1['mandatory_pct']}% mandatory, {m1['elective_pct']}% elective")
        print(f"   {uni2}: {m2['mandatory_pct']}% mandatory, {m2['elective_pct']}% elective")

        # 10. Language Distribution
        print("\n🌐 10. Language Distribution:")
        lang = engine.compare_language_distribution(uni1, uni2)
        for side in ["university1", "university2"]:
            l = lang[side]
            langs = ", ".join(f"{x['language']}({x['percentage']}%)" for x in l["languages"])
            print(f"   {l['name']}: {langs}")

        # 11. Resource Overlap
        print("\n📚 11. Resource Overlap:")
        res = engine.compare_resources(uni1, uni2)
        print(f"   Shared resources: {res['shared_count']}")

    finally:
        engine.close()


if __name__ == "__main__":
    main()

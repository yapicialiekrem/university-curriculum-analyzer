"""
config.py — Configuration loader for Neo4j credentials.

Setup:
    1. Copy `.env.example` to `.env`
    2. Fill in your Neo4j credentials in the `.env` file.
    3. If you don't have Neo4j installed, run it via Docker:

       docker run -d --name neo4j \
         -p 7474:7474 -p 7687:7687 \
         -e NEO4J_AUTH=neo4j/your_password_here \
         neo4j:latest

    4. Then set NEO4J_PASSWORD=your_password_here in `.env`
"""

import os
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

# Sentence-Transformers model for generating embeddings
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"

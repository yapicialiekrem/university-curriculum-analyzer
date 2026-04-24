"""Semantic search (FAISS) subpackage.

Modüller:
    builder — data/*.json dosyalarından ders bazlı embedding üretir ve
              FAISS index olarak `index/` altına kaydeder.
    search  — Çalışma zamanında index'i okuyup query benzerliği ile arar.
"""

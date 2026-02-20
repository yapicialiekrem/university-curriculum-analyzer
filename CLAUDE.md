# CLAUDE.md — university-curriculum-analyzer

This file provides guidance for AI assistants (Claude Code and similar tools) working on this repository. It documents the project structure, conventions, and workflows.

## Project Overview

**university-curriculum-analyzer** is a Python-based tool for analyzing university curricula. The project is in its early initialization stage — only a README and `.gitignore` exist so far. No source code, tests, or configuration files have been added yet.

### Inferred Tech Stack (from `.gitignore`)

- **Language:** Python
- **Web frameworks (candidates):** Django or Flask
- **Linting/formatting:** Ruff
- **Type checking:** mypy
- **Testing:** pytest
- **Package manager candidates:** UV, Poetry, PDM, Pipenv, or Pixi
- **Documentation:** Sphinx or mkdocs
- **Notebook support:** Jupyter / Marimo

> Once actual configuration files (`pyproject.toml`, `requirements.txt`, etc.) are added, update this section with confirmed choices.

---

## Repository Structure

```
university-curriculum-analyzer/
├── CLAUDE.md          ← This file
├── README.md          ← Project description (currently minimal)
└── .gitignore         ← Python-focused ignore rules
```

As source code is added, the expected layout for a Python project is:

```
university-curriculum-analyzer/
├── src/
│   └── university_curriculum_analyzer/   ← Main package
│       ├── __init__.py
│       └── ...
├── tests/                                ← Test suite
│   ├── __init__.py
│   └── ...
├── docs/                                 ← Documentation source
├── pyproject.toml                        ← Project metadata and tool config
├── README.md
├── CLAUDE.md
└── .gitignore
```

---

## Development Setup

> These instructions will evolve as the project matures. Update this section when tooling is confirmed.

### Recommended: UV (fast Python package manager)

```bash
# Install UV
curl -Ls https://astral.sh/uv/install.sh | sh

# Create and activate virtual environment
uv venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# Install dependencies (once pyproject.toml exists)
uv pip install -e ".[dev]"
```

### Alternative: pip + venv

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

---

## Common Commands

> Update this section as build tooling and scripts are introduced.

| Purpose | Command |
|---|---|
| Run tests | `pytest` |
| Run tests with coverage | `pytest --cov` |
| Lint code | `ruff check .` |
| Format code | `ruff format .` |
| Type check | `mypy src/` |
| Build docs | `sphinx-build docs/ docs/_build/` |

---

## Code Conventions

### Python Style

- **Formatting:** Ruff (`ruff format`) — do not manually reformat; let the tool decide
- **Linting:** Ruff (`ruff check`) — fix all reported issues before committing
- **Type annotations:** Required for all public functions and methods; use `mypy` for validation
- **Docstrings:** Google-style docstrings for all public APIs
- **Python version:** Assume Python 3.11+ unless a `pyproject.toml` specifies otherwise

### Naming Conventions

- Modules and packages: `snake_case`
- Classes: `PascalCase`
- Functions and variables: `snake_case`
- Constants: `UPPER_SNAKE_CASE`
- Private members: prefix with `_`

### Imports

- Group in order: stdlib → third-party → local
- Use absolute imports within the package
- Avoid wildcard imports (`from module import *`)

---

## Testing

- Framework: **pytest**
- Place tests in `tests/` mirroring the `src/` structure
- Name test files `test_<module>.py`
- Name test functions `test_<behavior>`
- Aim for high coverage on core logic; do not test implementation details
- Use fixtures (`conftest.py`) for shared setup

Example structure:
```
tests/
├── conftest.py
└── test_analyzer.py
```

---

## Git Workflow

### Branches

- `master` — stable, production-ready code
- `claude/<description>` — Claude Code development branches (AI-assisted work)
- Feature branches: `feat/<short-description>`
- Bug fix branches: `fix/<short-description>`

### Commits

- Use clear, imperative commit messages: `Add curriculum parser module`, `Fix credit unit calculation`
- Keep commits atomic — one logical change per commit
- Do not commit generated files, `.env`, or secrets

### Pull Requests

- All changes to `master` must go through a PR
- Include a summary of what changed and why
- Ensure linting, type checks, and tests pass before merging

---

## Environment Variables

> Populate this section once the project defines required configuration.

Sensitive values (API keys, database URLs, etc.) must never be committed. Use a `.env` file locally (already gitignored) and document required variables in `.env.example`.

```bash
# .env.example (to be created)
# DATABASE_URL=
# API_KEY=
```

---

## AI Assistant Guidelines

When working on this codebase as an AI assistant:

1. **Read before editing.** Always read existing files before modifying them.
2. **Match existing style.** Follow the conventions established in source files, not assumptions.
3. **Minimal changes.** Only modify what is necessary to complete the task. Avoid refactoring unrelated code.
4. **No speculative features.** Do not add features, abstractions, or error handling beyond what was explicitly requested.
5. **Update this file.** When significant architectural decisions are made or new tooling is added, update `CLAUDE.md` to reflect the current state.
6. **Test your changes.** Run the test suite and linter after making changes. Do not commit code that fails checks.
7. **Document secrets safely.** Never commit API keys, passwords, or tokens. Add them to `.env.example` as placeholders instead.
8. **Branch discipline.** All Claude-assisted work should happen on the designated `claude/` branch and be pushed there.

---

## Project Status

| Area | Status |
|---|---|
| Source code | Not started |
| Tests | Not started |
| CI/CD | Not configured |
| Documentation | Minimal |
| Package configuration | Not started |

This file was auto-generated by Claude Code during initial repository setup. Update it as the project evolves.

---
name: Python backend
description: FastAPI, Django and Flask services
tags: backend, python, fastapi, django
---
- Use the project's framework, layout and dependency tool (pip, poetry, uv); add dependencies through it.
- Type-hint functions; with FastAPI, define request and response models with Pydantic.
- Keep views or routes thin and put logic in services you can test directly.
- Use the ORM's migrations for every schema change (Alembic, Django migrations).
- Never build SQL with string formatting; use parameters or the ORM.
- Read settings from the environment; never commit secrets.
- Run the tests with the project's command (usually `pytest`) and the linter it uses (ruff, flake8).

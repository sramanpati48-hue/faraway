 # Nyaysahayak — AI Agentic Legal Assistant 

Nyaysahayak helps users with legal queries, cybercrime complaints, scam analysis, and human handoff to moderators, lawyers, and Nyay Guides. The backend is FastAPI + LangGraph; the web app is Next.js; persistence is PostgreSQL + pgvector.

## Documentation

All docs live under [`docs/`](./docs/).

| Document | Description |
|----------|-------------|
| **[docs/CODEBASE.md](./docs/CODEBASE.md)** | **Ultimate codebase reference** (architecture, agents, APIs, DB, deploy) |
| [docs/README.md](./docs/README.md) | Full docs index |
| [docs/POSTGRES_MIGRATION.md](./docs/POSTGRES_MIGRATION.md) | Postgres + admin cutover |
| [docs/PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md) | Features, RAG, services, deploy notes |

## Quick start

```bash
docker compose up -d postgres
pip install -r requirements.txt
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, BOOTSTRAP_ADMIN_*, LLM keys
python scripts/migrate_postgres.py
uvicorn main:app --reload --port 8000
```

```bash
cd web_app && npm install && npm run dev
```

- API: `http://localhost:8000`
- Web: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`

## Layout

```
main.py          → ASGI shim to backend.main:app
backend/         → FastAPI, LangGraph agents, DB, admin
web_app/         → Next.js frontend
scripts/         → migrations, imports, scrapers, seeds
docs/            → all project documentation
hf_space/        → embeddings API (Vyakyarth, 768-d)
```

## Stack (summary)

- **Backend:** FastAPI, LangGraph, JWT auth, WebSockets
- **AI:** OpenRouter / Groq / Gemini (per-node admin config); embeddings via Nyaysahayak API → pgvector
- **Frontend:** Next.js App Router
- **Deploy:** Docker / Cloud Run; VPS guide in [docs/ssh_setup.md](./docs/ssh_setup.md)

---
title: NyaySahayak Embeddings
emoji: ⚖️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# NyaySahayak Embeddings API

Embedding backend using `krutrim-ai-labs/Vyakyarth`.

## Endpoints
- `GET /health`
- `POST /embed`
- `POST /embed-texts`

Returns 768-dimensional embeddings suitable for pgvector (`vector(768)`).

from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL_NAME = "krutrim-ai-labs/Vyakyarth"
EMBEDDING_DIM = 768

app = FastAPI(title="NyaySahayak Embeddings API", version="1.0.0")
model = SentenceTransformer(MODEL_NAME)


class Chunk(BaseModel):
    id: str = Field(..., description="Unique chunk identifier")
    text: str = Field(..., min_length=1, description="Chunk text")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class EmbedRequest(BaseModel):
    chunks: List[Chunk]
    normalize: bool = False


class EmbedResponseItem(BaseModel):
    id: str
    embedding: List[float]
    metadata: Dict[str, Any]


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "nyaysahayak-embeddings",
        "model": MODEL_NAME,
        "embedding_dim": EMBEDDING_DIM,
        "routes": ["/health", "/embed", "/embed-texts"],
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "embedding_dim": EMBEDDING_DIM,
    }


@app.post("/embed", response_model=List[EmbedResponseItem])
def embed(payload: EmbedRequest) -> List[EmbedResponseItem]:
    if not payload.chunks:
        return []

    texts = [chunk.text for chunk in payload.chunks]

    try:
        vectors = model.encode(
            texts,
            normalize_embeddings=payload.normalize,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}") from exc

    response: List[EmbedResponseItem] = []
    for chunk, vector in zip(payload.chunks, vectors):
        values = vector.tolist()
        if len(values) != EMBEDDING_DIM:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected embedding size: {len(values)} (expected {EMBEDDING_DIM})",
            )
        response.append(
            EmbedResponseItem(
                id=chunk.id,
                embedding=values,
                metadata=chunk.metadata or {},
            )
        )

    return response


class EmbedTextsRequest(BaseModel):
    texts: List[str]
    normalize: bool = False
    model: Optional[str] = None


@app.post("/embed-texts")
def embed_texts(payload: EmbedTextsRequest) -> Dict[str, Any]:
    if not payload.texts:
        return {"embeddings": [], "count": 0, "embedding_dim": EMBEDDING_DIM}

    try:
        vectors = model.encode(
            payload.texts,
            normalize_embeddings=payload.normalize,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}") from exc

    embeddings = [vector.tolist() for vector in vectors]
    for values in embeddings:
        if len(values) != EMBEDDING_DIM:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected embedding size: {len(values)} (expected {EMBEDDING_DIM})",
            )

    return {"embeddings": embeddings, "count": len(embeddings), "embedding_dim": EMBEDDING_DIM}

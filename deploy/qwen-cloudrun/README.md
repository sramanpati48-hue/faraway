# Qwen2.5-3B Cloud Run service

OpenAI-compatible CPU inference for RAG funnel provider `selfhost`.

Full instructions: [docs/SELFHOST_LLM_CLOUD_RUN.md](../../docs/SELFHOST_LLM_CLOUD_RUN.md).

```bash
export GCS_BUCKET=… && ./upload-model.sh
export PROJECT_ID=… MODEL_GCS_URI=… API_KEY=… && ./deploy.sh
```

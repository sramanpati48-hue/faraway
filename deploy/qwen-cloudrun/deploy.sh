#!/usr/bin/env bash
# Build and deploy the Qwen2.5-3B self-host Cloud Run service.
#
# Prerequisites:
#   - gcloud authenticated, project set
#   - GGUF uploaded to GCS (see upload-model.sh)
#   - Artifact Registry repo (or use gcr.io)
#
# Usage:
#   export PROJECT_ID=your-gcp-project
#   export REGION=asia-south1
#   export MODEL_GCS_URI=gs://YOUR_BUCKET/models/qwen2.5-3b-instruct-q4_k_m.gguf
#   export API_KEY=$(openssl rand -hex 24)
#   ./deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-nyaysahayak-qwen}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/nyaysahayak/${SERVICE_NAME}:latest}"
MODEL_GCS_URI="${MODEL_GCS_URI:?Set MODEL_GCS_URI=gs://bucket/path.gguf}"
API_KEY="${API_KEY:?Set API_KEY (shared with SELFHOST_LLM_API_KEY on the main backend)}"
MEMORY="${MEMORY:-16Gi}"
CPU="${CPU:-4}"
N_THREADS="${N_THREADS:-4}"
N_CTX="${N_CTX:-8192}"

echo "Building ${IMAGE} …"
gcloud builds submit "${SCRIPT_DIR}" \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE}"

echo "Deploying Cloud Run service ${SERVICE_NAME} …"
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=1 \
  --cpu="${CPU}" \
  --memory="${MEMORY}" \
  --timeout=3600 \
  --cpu-boost \
  --execution-environment=gen2 \
  --set-env-vars="MODEL_GCS_URI=${MODEL_GCS_URI},MODEL_LOCAL_PATH=/models/qwen2.5-3b-instruct-q4.gguf,MODEL_ID=Qwen2.5-3B-Instruct,API_KEY=${API_KEY},N_CTX=${N_CTX},N_THREADS=${N_THREADS},PRELOAD_MODEL=1,CHAT_FORMAT=chatml"

# Grant the Cloud Run runtime SA permission to read the GGUF from GCS (if needed).
# gcloud storage buckets add-iam-policy-binding … 

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')"

echo ""
echo "Deployed: ${SERVICE_URL}"
echo "Set on the NyaySahayak backend:"
echo "  SELFHOST_LLM_BASE_URL=${SERVICE_URL}/v1"
echo "  SELFHOST_LLM_API_KEY=${API_KEY}"
echo ""
echo "Auth: HTTP is open but every /v1/* call requires Authorization: Bearer \$API_KEY."
echo "Request-based billing + min-instances=0: expect long cold starts (model download + load)."

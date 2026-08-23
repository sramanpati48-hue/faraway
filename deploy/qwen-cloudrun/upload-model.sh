#!/usr/bin/env bash
# Download a Qwen2.5-3B-Instruct Q4 GGUF from Hugging Face and upload to GCS.
#
# Default GGUF: Qwen/Qwen2.5-3B-Instruct-GGUF Q4_K_M (community / official mirrors).
# Override HF_REPO / HF_FILE if you prefer another quant.
#
# Usage:
#   export GCS_BUCKET=your-bucket
#   ./upload-model.sh

set -euo pipefail

GCS_BUCKET="${GCS_BUCKET:?Set GCS_BUCKET}"
GCS_PREFIX="${GCS_PREFIX:-models}"
HF_REPO="${HF_REPO:-Qwen/Qwen2.5-3B-Instruct-GGUF}"
HF_FILE="${HF_FILE:-qwen2.5-3b-instruct-q4_k_m.gguf}"
LOCAL_DIR="${LOCAL_DIR:-/tmp/qwen-gguf}"
DEST_URI="gs://${GCS_BUCKET}/${GCS_PREFIX}/${HF_FILE}"

mkdir -p "${LOCAL_DIR}"
export HF_REPO HF_FILE LOCAL_DIR
echo "Downloading ${HF_REPO}/${HF_FILE} …"
python - <<'PY'
from huggingface_hub import hf_hub_download
import os
path = hf_hub_download(
    repo_id=os.environ["HF_REPO"],
    filename=os.environ["HF_FILE"],
    local_dir=os.environ["LOCAL_DIR"],
)
print(path)
PY

LOCAL_FILE="${LOCAL_DIR}/${HF_FILE}"
if [[ ! -f "${LOCAL_FILE}" ]]; then
  # hf_hub_download may nest under snapshots/
  LOCAL_FILE="$(find "${LOCAL_DIR}" -name "${HF_FILE}" | head -n1)"
fi
[[ -f "${LOCAL_FILE}" ]] || { echo "GGUF not found after download"; exit 1; }

echo "Uploading to ${DEST_URI} …"
gcloud storage cp "${LOCAL_FILE}" "${DEST_URI}"

echo ""
echo "Set MODEL_GCS_URI=${DEST_URI}"
echo "Then run ./deploy.sh"

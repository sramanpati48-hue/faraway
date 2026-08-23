# Nyaysahayak Cloud Run (API)

Service: `nyaysahayak` · Region: `europe-west1`

## Scale-to-zero + scheduled clustering

The API uses `min-instances=0` (cheap). Background jobs do **not** use an always-on worker.

- **Manual runs** (scam-trends scrape, classifier “Run now”): admin UI opens `POST …/process` so Cloud Run allocates CPU for that request only.
- **Scheduled clustering**: UptimeRobot free tier sends **HEAD** to  
  `/api/cron/scam-classifier/tick?secret=$CRON_SECRET`  
  (POST + `X-Cron-Secret` still works for GitHub Actions). A keep-alive `/ping` does **not** start clustering.  
  The admin **Interval (hours)** setting decides whether a run is actually due
  (`last_run_at` + interval). Cheap no-op ticks when not due.

Required env on the service:

- `RUN_BACKGROUND_WORKER=0` (default; do not enable unless you pay for min-instances)
- `CRON_SECRET=<random>` (shared with the UptimeRobot tick URL `?secret=` or `X-Cron-Secret` header)

Recommended flags:

- `--timeout=3600` (scrapes / clustering can exceed 5 minutes)
- `--memory=1Gi`
- `--min-instances=0` (keep)
- Do **not** require `--no-cpu-throttling` for this design

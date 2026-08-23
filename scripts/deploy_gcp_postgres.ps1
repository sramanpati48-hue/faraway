# Script to deploy e2-micro PostgreSQL (pgvector) instance on GCP and restore local backup

$PROJECT_ID = "project-5af0c4b2-88c4-475e-9f1"
$INSTANCE_NAME = "nyaysahayak-postgres"
$ZONE = "us-central1-c"
$BACKUP_FILE = "$PSScriptRoot\..\scratch\nyaysahayak_backup.sql"

if (-not (Test-Path "C:\Users\Prattay\.gemini\antigravity\brain\cc71d2da-e469-4432-b798-15507cbaad3f\nyaysahayak_backup.sql")) {
    Write-Host "Exporting local database backup from localhost:55432..." -ForegroundColor Yellow
    docker exec nyaysahayak-postgres pg_dump -U nyaya_app -d nyaysahayak > "C:\Users\Prattay\.gemini\antigravity\brain\cc71d2da-e469-4432-b798-15507cbaad3f\nyaysahayak_backup.sql"
}

Write-Host "Creating e2-micro instance '$INSTANCE_NAME' in zone '$ZONE'..." -ForegroundColor Green
gcloud compute instances create $INSTANCE_NAME `
    --project=$PROJECT_ID `
    --zone=$ZONE `
    --machine-type=e2-micro `
    --image-family=ubuntu-2204-lts `
    --image-project=ubuntu-os-cloud `
    --boot-disk-size=30GB `
    --boot-disk-type=pd-standard `
    --tags=postgres,http-server,https-server

if ($LASTEXITCODE -ne 0) {
    Write-Host "Instance creation failed. Please ensure Billing is enabled on GCP project $PROJECT_ID." -ForegroundColor Red
    exit 1
}

Write-Host "Waiting for VM initialization..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host "Installing Docker & starting pgvector/pgvector:pg16 container..." -ForegroundColor Green
$startupCmd = @"
sudo apt-get update && sudo apt-get install -y docker.io postgresql-client
sudo systemctl start docker
sudo systemctl enable docker
sudo docker run -d --name nyaysahayak-db --restart always -p 5432:5432 -e POSTGRES_DB=nyaysahayak -e POSTGRES_USER=nyaya_app -e POSTGRES_PASSWORD=nyaya_app_dev -v pgdata:/var/lib/postgresql/data pgvector/pgvector:pg16
"@

gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="$startupCmd"

Write-Host "Uploading SQL backup to VM..." -ForegroundColor Green
gcloud compute scp "C:\Users\Prattay\.gemini\antigravity\brain\cc71d2da-e469-4432-b798-15507cbaad3f\nyaysahayak_backup.sql" "${INSTANCE_NAME}:~/backup.sql" --zone=$ZONE

Write-Host "Restoring database dump into pgvector container..." -ForegroundColor Green
$restoreCmd = "sudo docker exec -i nyaysahayak-db psql -U nyaya_app -d nyaysahayak < ~/backup.sql"
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="$restoreCmd"

$EXTERNAL_IP = (gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)").Trim()

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "✅ PostgreSQL Deployment Complete!" -ForegroundColor Green
Write-Host "External IP: $EXTERNAL_IP" -ForegroundColor Yellow
Write-Host "DATABASE_URL=postgresql://nyaya_app:nyaya_app_dev@${EXTERNAL_IP}:5432/nyaysahayak" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

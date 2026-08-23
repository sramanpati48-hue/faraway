# start_dev.ps1 - Nyaysahayak Windows Development Environment
Write-Host "Starting Nyaysahayak Development Environment..." -ForegroundColor Cyan

# Ensure we're in the correct directory (the script's directory)
Set-Location $PSScriptRoot

# Check/Create Python Virtual Environment
if (-not (Test-Path "venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Green
    python -m venv venv
}

# Install Dependencies
# Using the python executable directly from venv to ensure we use the correct environment
Write-Host "Installing dependencies..." -ForegroundColor Green
.\venv\Scripts\python.exe -m pip install -r requirements.txt

# Windows allows two uvicorn processes to bind 8000. The stale one returns empty chat streams.
$listeners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($listeners) {
    Write-Host "Port 8000 is already in use (PIDs $($listeners -join ', ')). Stopping the old API..." -ForegroundColor Yellow
    foreach ($procId in $listeners) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# Start Backend Server (FastAPI)
Write-Host "Starting FastAPI Backend..." -ForegroundColor Green
# Start in a new PowerShell window, activate venv, and run uvicorn
Start-Process powershell -WorkingDirectory $PSScriptRoot -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "& { .\venv\Scripts\Activate.ps1; uvicorn main:app --reload --reload-dir backend --port 8000 }"

# Start Frontend Server (Next.js)
Write-Host "Starting Next.js Frontend..." -ForegroundColor Green
# Start in a new PowerShell window, navigate to web_app, and run npm run dev
Start-Process powershell -WorkingDirectory $PSScriptRoot -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "& { Set-Location web_app; npm.cmd run dev }"

Write-Host "Development environment started. Check the new windows for server logs." -ForegroundColor Cyan

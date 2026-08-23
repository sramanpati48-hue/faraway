"""Automated PostgreSQL Database Backup Service with Google Drive, GitHub, and Discord Delivery."""

import asyncio
import base64
import gzip
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()

try:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    import google.auth

    HAS_GOOGLE_AUTH = True
except ImportError:
    HAS_GOOGLE_AUTH = False

try:
    from backend.services.admin_models import read_config_key
except ImportError:
    def read_config_key(key: str, fallback: Any = None) -> Dict[str, Any]:
        return fallback or {}

BACKUP_DIR = os.path.join(tempfile.gettempdir(), "nyaysahayak_backups")
MAX_DISCORD_SINGLE_FILE_BYTES = 7.5 * 1024 * 1024  # 7.5 MB safe limit for Discord free webhooks


def get_backup_db_config() -> Dict[str, Any]:
    """Load backup configuration overrides stored in PostgreSQL public.system_config table under key 'backup_config'."""
    try:
        cfg = read_config_key("backup_config", {})
        return cfg if isinstance(cfg, dict) else {}
    except Exception:
        return {}


def parse_database_url(url: str) -> Dict[str, str]:
    """Parse postgresql:// connection URL into components."""
    if not url:
        raise ValueError("DATABASE_URL is empty or not configured")

    parsed = urlparse(url)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ValueError(f"Unsupported database scheme: {parsed.scheme}")

    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "dbname": (parsed.path or "/nyaysahayak").lstrip("/"),
    }


def get_db_credentials() -> Dict[str, str]:
    """Get database credentials from individual ENV vars or DATABASE_URL."""
    db_url = os.getenv("DATABASE_URL", "").strip()

    if db_url:
        return parse_database_url(db_url)

    return {
        "host": os.getenv("DATABASE_HOST", os.getenv("DB_HOST", "localhost")),
        "port": os.getenv("DATABASE_PORT", os.getenv("DB_PORT", "5432")),
        "user": os.getenv("DATABASE_USER", os.getenv("DB_USER", "nyaya_app")),
        "password": os.getenv("DATABASE_PASSWORD", os.getenv("DB_PASSWORD", "nyaya_app_dev")),
        "dbname": os.getenv("DATABASE_NAME", os.getenv("DB_NAME", "nyaysahayak")),
    }


def _oauth_user_access_token(db_cfg: Dict[str, Any]) -> Optional[str]:
    """Exchange a user OAuth2 refresh token for an access token (personal Drive quota)."""
    refresh_token = (
        db_cfg.get("gdrive_refresh_token")
        or db_cfg.get("GDRIVE_REFRESH_TOKEN")
        or os.getenv("GDRIVE_REFRESH_TOKEN", "").strip()
    )
    client_id = (
        db_cfg.get("gdrive_client_id")
        or db_cfg.get("GDRIVE_CLIENT_ID")
        or os.getenv("GDRIVE_CLIENT_ID", "").strip()
    )
    client_secret = (
        db_cfg.get("gdrive_client_secret")
        or db_cfg.get("GDRIVE_CLIENT_SECRET")
        or os.getenv("GDRIVE_CLIENT_SECRET", "").strip()
    )
    if not (refresh_token and client_id and client_secret):
        return None
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("access_token")
            raise RuntimeError(f"Google token endpoint returned {resp.status_code}: {resp.text[:500]}")
    except Exception as exc:
        raise RuntimeError(f"GDrive OAuth refresh failed: {exc}") from exc


def get_gdrive_access_token() -> Optional[str]:
    """Obtain OAuth2 access token for Google Drive API calls.

    Preference order (personal Gmail-friendly first):
      1. User OAuth2 refresh token (uses your Gmail Drive quota — free path)
      2. Explicit access token
      3. Service account / ADC (needs Shared Drive or Workspace domain-wide delegation)
    """
    db_cfg = get_backup_db_config()

    # Prefer renewable user OAuth credentials over any stale explicit token. If all
    # three values are present but refresh fails, propagate the error instead of
    # silently uploading as a service account.
    user_token = _oauth_user_access_token(db_cfg)
    if user_token:
        return user_token

    token = (
        db_cfg.get("gdrive_access_token")
        or db_cfg.get("GDRIVE_ACCESS_TOKEN")
        or os.getenv("GDRIVE_ACCESS_TOKEN", "").strip()
        or os.getenv("GOOGLE_DRIVE_ACCESS_TOKEN", "").strip()
    )
    if token:
        return token

    if not HAS_GOOGLE_AUTH:
        return None

    scopes = [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive",
    ]

    subject = (
        db_cfg.get("gdrive_subject")
        or db_cfg.get("gdrive_impersonate_user")
        or os.getenv("GDRIVE_IMPERSONATE_USER", "").strip()
    )

    sa_info = db_cfg.get("gdrive_service_account_json") or db_cfg.get("GDRIVE_SERVICE_ACCOUNT_JSON")
    if sa_info:
        try:
            info = json.loads(sa_info) if isinstance(sa_info, str) else sa_info
            creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            if subject and hasattr(creds, "with_subject"):
                creds = creds.with_subject(subject)
            creds.refresh(Request())
            return creds.token
        except Exception:
            pass

    sa_file = os.getenv("GDRIVE_SERVICE_ACCOUNT_FILE", "").strip() or os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if sa_file and os.path.exists(sa_file):
        try:
            creds = service_account.Credentials.from_service_account_file(sa_file, scopes=scopes)
            if subject and hasattr(creds, "with_subject"):
                creds = creds.with_subject(subject)
            creds.refresh(Request())
            return creds.token
        except Exception:
            pass

    sa_json = os.getenv("GDRIVE_SERVICE_ACCOUNT_JSON", "").strip()
    if sa_json:
        try:
            info = json.loads(sa_json)
            creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            if subject and hasattr(creds, "with_subject"):
                creds = creds.with_subject(subject)
            creds.refresh(Request())
            return creds.token
        except Exception:
            pass

    private_key = os.getenv("FIREBASE_ADMIN_PRIVATE_KEY", "").strip()
    client_email = os.getenv("FIREBASE_ADMIN_CLIENT_EMAIL", "").strip()
    project_id = os.getenv("FIREBASE_ADMIN_PROJECT_ID", "").strip()
    if private_key and client_email:
        try:
            formatted_key = private_key.replace("\\n", "\n")
            sa_info = {
                "type": "service_account",
                "project_id": project_id,
                "private_key": formatted_key,
                "client_email": client_email,
                "token_uri": os.getenv("FIREBASE_ADMIN_TOKEN_URI", "https://oauth2.googleapis.com/token"),
            }
            creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
            if subject and hasattr(creds, "with_subject"):
                creds = creds.with_subject(subject)
            creds.refresh(Request())
            return creds.token
        except Exception:
            pass

    try:
        creds, _ = google.auth.default(scopes=scopes)
        if subject and hasattr(creds, "with_subject"):
            creds = creds.with_subject(subject)
        creds.refresh(Request())
        return creds.token
    except Exception:
        pass

    return None


async def remove_old_gdrive_backups(
    client: httpx.AsyncClient,
    current_file_id: str,
    headers: Dict[str, str],
    params: Dict[str, str],
    folder_id: Optional[str] = None,
) -> int:
    """Find and remove old database backups from Google Drive after a successful new backup upload."""
    removed_count = 0
    try:
        query_parts = ["name contains 'nyaysahayak_backup_'", "trashed = false"]
        if current_file_id:
            query_parts.append(f"id != '{current_file_id}'")
        if folder_id:
            query_parts.append(f"'{folder_id}' in parents")

        q = " and ".join(query_parts)
        list_url = "https://www.googleapis.com/drive/v3/files"
        list_params = {**params, "q": q, "fields": "files(id, name, createdTime)"}

        resp = await client.get(list_url, headers=headers, params=list_params)
        if resp.status_code != 200:
            return 0

        files_data = resp.json().get("files", [])

        for old_file in files_data:
            old_id = old_file.get("id")
            if not old_id:
                continue

            del_url = f"https://www.googleapis.com/drive/v3/files/{old_id}"
            del_resp = await client.delete(del_url, headers=headers, params=params)

            if del_resp.status_code in (200, 204):
                removed_count += 1
            else:
                patch_url = f"https://www.googleapis.com/drive/v3/files/{old_id}"
                patch_resp = await client.patch(
                    patch_url, headers=headers, params=params, json={"trashed": True}
                )
                if patch_resp.status_code == 200:
                    removed_count += 1
    except Exception:
        pass

    return removed_count


async def upload_to_gdrive(file_path: str) -> Dict[str, Any]:
    """Upload compressed backup file directly to Google Drive using Resumable Upload (uploadType=resumable) and remove old backups."""
    try:
        token = get_gdrive_access_token()
    except RuntimeError as exc:
        return {
            "success": False,
            "error": (
                f"{exc}. Check gdrive_client_id, gdrive_client_secret, and "
                "gdrive_refresh_token in Admin Backup."
            ),
        }
    db_cfg = get_backup_db_config()
    folder_id = (
        db_cfg.get("gdrive_folder_id")
        or db_cfg.get("GDRIVE_FOLDER_ID")
        or os.getenv("GDRIVE_FOLDER_ID", "").strip()
        or os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    )

    if not token:
        return {
            "success": False,
            "reason": (
                "No valid Google Drive access token. For free personal Gmail Drive, set "
                "gdrive_client_id, gdrive_client_secret, and gdrive_refresh_token in Admin Backup "
                "(or GDRIVE_* env vars). Run: python scripts/gdrive_oauth_refresh_token.py"
            ),
        }

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    headers = {"Authorization": f"Bearer {token}"}
    params = {"supportsAllDrives": "true"}

    init_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true"

    metadata: Dict[str, Any] = {
        "name": filename,
        "mimeType": "application/gzip",
    }
    if folder_id:
        metadata["parents"] = [folder_id]

    init_headers = {
        **headers,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/gzip",
        "X-Upload-Content-Length": str(file_size),
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            # 1. Initiate Resumable Upload Session
            resp = await client.post(init_url, headers=init_headers, json=metadata)
            
            # Check for API Disabled (403 SERVICE_DISABLED)
            if resp.status_code == 403 and "SERVICE_DISABLED" in resp.text:
                activation_url = ""
                try:
                    error_details = resp.json().get("error", {}).get("details", [])
                    for detail in error_details:
                        metadata = detail.get("metadata", {})
                        if metadata.get("activationUrl"):
                            activation_url = metadata["activationUrl"]
                            break
                except (TypeError, ValueError):
                    pass
                if not activation_url:
                    proj_id = db_cfg.get("gcp_project_id") or db_cfg.get("gcp_project_number")
                    activation_url = (
                        "https://console.developers.google.com/apis/api/"
                        f"drive.googleapis.com/overview?project={proj_id}"
                        if proj_id
                        else "https://console.cloud.google.com/apis/library/drive.googleapis.com"
                    )
                return {
                    "success": False,
                    "error": (
                        "Google Drive API is disabled on your GCP Project. "
                        f"Please enable it at: {activation_url}"
                    ),
                    "details": resp.text
                }

            # Check for Service Account Storage Quota Limit
            if resp.status_code == 403 and "storageQuotaExceeded" in resp.text:
                return {
                    "success": False,
                    "error": (
                        "Resumable upload failed (403 storageQuotaExceeded): a Service Account has no storage "
                        "quota on personal Gmail Drive. For the free path, configure OAuth2 user credentials "
                        "(gdrive_client_id / gdrive_client_secret / gdrive_refresh_token) in Admin Backup — "
                        "they use your Gmail quota. Clear the service-account JSON so OAuth is used. "
                        "Generate a refresh token with: python scripts/gdrive_oauth_refresh_token.py"
                    ),
                    "details": resp.text,
                }

            upload_url = resp.headers.get("location") or resp.headers.get("Location")

            if resp.status_code not in (200, 201) or not upload_url:
                return {
                    "success": False,
                    "error": f"Failed to initiate resumable upload session ({resp.status_code}): {resp.text}"
                }

            # 2. Upload Binary File Content via Resumable PUT
            with open(file_path, "rb") as f:
                upload_headers = {
                    "Content-Length": str(file_size),
                    "Content-Type": "application/gzip",
                }
                put_resp = await client.put(upload_url, headers=upload_headers, content=f.read())
                
                if put_resp.status_code in (200, 201):
                    file_data = put_resp.json()
                    file_id = file_data.get("id")
                    removed_count = await remove_old_gdrive_backups(client, file_id, headers, params, folder_id)
                    return {"success": True, "file_id": file_id, "removed_old_backups": removed_count}
                
                # Check for Service Account Storage Quota error
                if put_resp.status_code == 403 and "storageQuotaExceeded" in put_resp.text:
                    return {
                        "success": False,
                        "error": (
                            "Resumable PUT failed (403 storageQuotaExceeded): Service Account has no quota on "
                            "personal Gmail Drive. Use OAuth2 user refresh token credentials instead "
                            "(Admin Backup → Client ID / Secret / Refresh token), then clear service-account JSON."
                        ),
                        "details": put_resp.text,
                    }

                return {
                    "success": False,
                    "error": f"Resumable upload PUT failed ({put_resp.status_code}): {put_resp.text}"
                }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


async def upload_to_github(file_path: str) -> bool:
    """Upload backup file to GitHub repository via GitHub API if GITHUB_TOKEN & GITHUB_REPO are configured."""
    token = os.getenv("GITHUB_TOKEN", "").strip()
    repo = os.getenv("GITHUB_REPO", "").strip() or os.getenv("GITHUB_REPOSITORY", "").strip()

    if not token or not repo:
        return False

    filename = os.path.basename(file_path)
    timestamp = datetime.utcnow().strftime("%Y-%m-%d_%H-%M-%S")
    path = f"backups/{filename}"

    try:
        with open(file_path, "rb") as f:
            content_b64 = base64.b64encode(f.read()).decode("utf-8")

        url = f"https://api.github.com/repos/{repo}/contents/{path}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        data: Dict[str, Any] = {
            "message": f"Database Backup: {timestamp}",
            "content": content_b64,
        }

        async with httpx.AsyncClient(timeout=300.0) as client:
            get_resp = await client.get(url, headers=headers)
            if get_resp.status_code == 200:
                data["sha"] = get_resp.json().get("sha")

            put_resp = await client.put(url, headers=headers, json=data)
            return put_resp.status_code in (200, 201)
    except Exception:
        return False


async def upload_to_discord(file_path: str, webhook_url: str) -> bool:
    """Upload compressed backup file to Discord channel via webhook, auto-splitting if > 7.5MB."""
    if not webhook_url:
        return False

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    file_size_mb = file_size / (1024 * 1024)
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # If file fits under Discord's safe limit, upload directly
    if file_size <= MAX_DISCORD_SINGLE_FILE_BYTES:
        message_content = (
            f"📦 **NyaySahayak Database Backup**\n"
            f"📅 **Timestamp**: `{timestamp} UTC`\n"
            f"📄 **File**: `{filename}`\n"
            f"📊 **Size**: `{file_size_mb:.2f} MB`"
        )

        async with httpx.AsyncClient(timeout=300.0) as client:
            with open(file_path, "rb") as f:
                files = {"file": (filename, f, "application/gzip")}
                data = {"content": message_content}
                response = await client.post(webhook_url, data=data, files=files)
                response.raise_for_status()
                return True

    # If file > 7.5 MB, split into 7 MB chunks and send sequentially
    chunk_size = int(7 * 1024 * 1024)  # 7 MB per chunk
    total_parts = (file_size + chunk_size - 1) // chunk_size
    part_num = 1

    async with httpx.AsyncClient(timeout=300.0) as client:
        with open(file_path, "rb") as f_in:
            while True:
                chunk = f_in.read(chunk_size)
                if not chunk:
                    break

                part_name = f"{filename}.part{part_num:02d}"
                chunk_mb = len(chunk) / (1024 * 1024)
                message_content = (
                    f"📦 **NyaySahayak Database Backup (Part {part_num}/{total_parts})**\n"
                    f"📅 **Timestamp**: `{timestamp} UTC`\n"
                    f"📄 **Chunk File**: `{part_name}`\n"
                    f"📊 **Chunk Size**: `{chunk_mb:.2f} MB`"
                )

                files = {"file": (part_name, chunk, "application/octet-stream")}
                data = {"content": message_content}
                response = await client.post(webhook_url, data=data, files=files)
                response.raise_for_status()
                part_num += 1

    return True


async def backup_database() -> Dict[str, Any]:
    """Execute pg_dump, compress backup, upload simultaneously to all configured services, and clean up temporary files."""
    os.makedirs(BACKUP_DIR, exist_ok=True)

    creds = get_db_credentials()
    timestamp = datetime.utcnow().strftime("%Y-%m-%d_%H-%M-%S")
    sql_file = os.path.join(BACKUP_DIR, f"nyaysahayak_backup_{timestamp}.sql")
    gz_file = f"{sql_file}.gz"

    env = os.environ.copy()
    if creds["password"]:
        env["PGPASSWORD"] = creds["password"]

    pg_dump_bin = shutil.which("pg_dump") or "pg_dump"

    try:
        # Step 1: Run pg_dump
        cmd = [
            pg_dump_bin,
            "-h", creds["host"],
            "-p", creds["port"],
            "-U", creds["user"],
            "-d", creds["dbname"],
            "-f", sql_file,
        ]

        try:
            process = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
            )
            if process.returncode != 0:
                raise RuntimeError(f"pg_dump failed (code {process.returncode}): {process.stderr}")
        except FileNotFoundError as fnf_err:
            raise RuntimeError(
                "pg_dump binary was not found on PATH. Please ensure postgresql-client is installed on your server."
            ) from fnf_err

        # Step 2: Compress with gzip
        with open(sql_file, "rb") as f_in:
            with gzip.open(gz_file, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

        # Step 3: Remove uncompressed sql file
        if os.path.exists(sql_file):
            os.remove(sql_file)

        compressed_size = os.path.getsize(gz_file)
        gz_filename = os.path.basename(gz_file)

        # Step 4: Run uploads simultaneously (Discord, Google Drive, GitHub)
        db_cfg = get_backup_db_config()
        webhook_url = (
            db_cfg.get("discord_webhook")
            or db_cfg.get("DISCORD_WEBHOOK")
            or os.getenv("DISCORD_WEBHOOK", "").strip()
        )

        discord_task = upload_to_discord(gz_file, webhook_url) if webhook_url else None
        gdrive_task = upload_to_gdrive(gz_file)
        github_task = upload_to_github(gz_file)

        results = await asyncio.gather(
            discord_task if discord_task else asyncio.sleep(0, result=False),
            gdrive_task if gdrive_task else asyncio.sleep(0, result={"success": False, "reason": "Not configured"}),
            github_task if github_task else asyncio.sleep(0, result=False),
            return_exceptions=True,
        )

        uploaded_discord = results[0] if isinstance(results[0], bool) else False
        gdrive_res = results[1] if isinstance(results[1], dict) else {"success": False, "error": str(results[1])}
        uploaded_github = results[2] if isinstance(results[2], bool) else False

        uploaded_gdrive = gdrive_res.get("success", False)
        removed_old_gdrive = gdrive_res.get("removed_old_backups", 0)

        return {
            "success": True,
            "filename": gz_filename,
            "size_bytes": compressed_size,
            "size_mb": round(compressed_size / (1024 * 1024), 2),
            "uploaded_to_discord": uploaded_discord,
            "uploaded_to_gdrive": uploaded_gdrive,
            "uploaded_to_github": uploaded_github,
            "old_gdrive_backups_removed": removed_old_gdrive,
            "gdrive_details": gdrive_res,
            "timestamp": timestamp,
        }

    finally:
        # Cleanup temporary files
        if os.path.exists(sql_file):
            try:
                os.remove(sql_file)
            except Exception:
                pass
        if os.path.exists(gz_file):
            try:
                os.remove(gz_file)
            except Exception:
                pass

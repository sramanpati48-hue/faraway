#!/usr/bin/env python3
"""One-shot helper: get a Google OAuth2 refresh token for personal Gmail Drive backups.

Free path (no Workspace): uploads use YOUR Gmail Drive quota instead of a service account.

Prerequisites
-------------
1. Google Cloud Console → APIs & Services → enable "Google Drive API".
2. Credentials → Create Credentials → OAuth client ID → Application type: Desktop app
   (or Web with redirect http://localhost:8765/).
3. OAuth consent screen: External, add your Gmail as a test user if app is in Testing.
4. Copy Client ID and Client Secret.

Usage
-----
  pip install google-auth-oauthlib
  python scripts/gdrive_oauth_refresh_token.py

Paste Client ID + Secret when prompted (or set GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET).
A browser opens; sign in with the Gmail that owns the backup folder.
Copy the printed refresh token into Admin → Backup → gdrive_refresh_token
(and client id/secret into the matching fields). Leave service-account JSON empty.
"""

from __future__ import annotations

import os
import sys

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
]


def main() -> int:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("Install: pip install google-auth-oauthlib")
        return 1

    client_id = os.getenv("GDRIVE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GDRIVE_CLIENT_SECRET", "").strip()

    if not client_id:
        client_id = input("OAuth Client ID: ").strip()
    if not client_secret:
        client_secret = input("OAuth Client Secret: ").strip()

    if not client_id or not client_secret:
        print("Client ID and Client Secret are required.")
        return 1

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    creds = flow.run_local_server(port=8765, prompt="consent", access_type="offline")

    if not creds.refresh_token:
        print(
            "No refresh_token returned. Revoke prior access at "
            "https://myaccount.google.com/permissions then re-run with prompt=consent."
        )
        return 1

    print("\n=== Paste these into Admin → Backup (or .env) ===\n")
    print(f"gdrive_client_id={client_id}")
    print(f"gdrive_client_secret={client_secret}")
    print(f"gdrive_refresh_token={creds.refresh_token}")
    print(
        "\nAlso set gdrive_folder_id to a folder YOU own (no need to share with a service account)."
        "\nLeave gdrive_service_account_json empty so OAuth is preferred."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

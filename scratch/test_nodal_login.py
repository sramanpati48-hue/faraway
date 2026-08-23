import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.database.auth_service import login

print("Testing Nodal Guide JWT Login...")
res = login("nodal.andhra.pradesh@nyaysahayak.in", "NodalGuide123!")
print("Login successful!")
print("User info:", res["user"])
print("Token type:", res["token_type"])
print("Access token generated:", bool(res["access_token"]))

import os
from dotenv import load_dotenv

# Try loading from default
load_dotenv()
print(f"GOOGLE_API_KEY from .env: {os.getenv('GOOGLE_API_KEY')}")

# Try loading from backend/agents/.env
load_dotenv(dotenv_path="backend/agents/.env")
print(f"GOOGLE_API_KEY from backend/agents/.env: {os.getenv('GOOGLE_API_KEY')}")

# List all keys to see if it's there under a different name
print("Keys in os.environ:", [k for k in os.environ.keys() if "API" in k])

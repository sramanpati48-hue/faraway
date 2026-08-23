import os
from google import genai
from groq import Groq
from dotenv import load_dotenv

from backend.paths import REPO_ROOT

load_dotenv()
load_dotenv(dotenv_path=REPO_ROOT / "backend" / "agents" / ".env")
load_dotenv(dotenv_path=REPO_ROOT / ".env")

# Configure Gemini
# Ensure GEMINI_API_KEY is in .env
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Configure Groq
# Ensure GROQ_API_KEY is in .env
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def transcribe_audio(audio_file_path: str, mime_type: str = "audio/mp3") -> str:
    """
    Transcribes audio using Gemini 1.5 Flash, falling back to Groq Whisper.
    """
    print(f"Transcribing {audio_file_path}...")
    
    # Read file bytes
    try:
        with open(audio_file_path, "rb") as f:
            audio_data = f.read()
    except Exception as e:
        return f"Error reading file: {e}"

    # 1. Try Gemini with Fallback Models
    # Order: Gemini 2.5 Flash (Primary) -> Gemini 3 Flash (Backup) -> Gemini 2.5 Flash Lite (High Rate Limit)
    # Based on user's active quotas.
    gemini_models = ["gemini-2.5-flash", "gemini-3-flash", "gemini-2.5-flash-lite"]
    
    for model_name in gemini_models:
        try:
            print(f"Attempting transcription with {model_name}...")
            
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    {"inline_data": {"mime_type": mime_type, "data": audio_data}},
                    "Transcribe this audio file accurately. Output ONLY the transcription."
                ]
            )
            
            return response.text.strip()
        except Exception as e:
            print(f"Gemini {model_name} transcription failed: {e}")
            continue # Try next model

    print("All Gemini models failed. Falling back to Groq Whisper...")
        
    # 2. Try Groq Whisper
    try:
        # Groq requires a file-like object with a name
        with open(audio_file_path, "rb") as file:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(audio_file_path), file.read()),
                model="whisper-large-v3",
                response_format="text"
            )
        return transcription.strip()
    except Exception as e2:
            print(f"Groq transcription failed: {e2}")
            return "Error: Could not transcribe audio with either service."

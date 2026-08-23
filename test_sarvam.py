import os
import requests
import base64
from dotenv import load_dotenv

load_dotenv("d:/projects/Nyaysahayak/.env")
SARVAM_KEY = os.getenv("SARVAM_API_KEY")

def test_tts():
    print("Testing TTS...")
    url = "https://api.sarvam.ai/text-to-speech"
    payload = {
        "inputs": ["Hello, how can I help you with your case today?"],
        "target_language_code": "hi-IN",
        "speaker": "meera",
        "pitch": 0,
        "pace": 1.0,
        "loudness": 1.5,
        "speech_sample_rate": 8000,
        "enable_preprocessing": True,
        "model": "bulbul:v1"
    }
    headers = {
        "api-subscription-key": SARVAM_KEY,
        "Content-Type": "application/json"
    }

    response = requests.request("POST", url, json=payload, headers=headers)
    print("TTS Status:", response.status_code)
    try:
        data = response.json()
        if "audios" in data:
            print("TTS Success: Received audio base64")
        else:
            print("TTS Response:", data)
    except Exception as e:
        print("Error parsing TTS response:", response.text)

if __name__ == "__main__":
    test_tts()

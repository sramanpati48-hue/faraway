import asyncio
import httpx
import os

async def test_tts():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://127.0.0.1:8000/api/synthesize",
            json={
                "text": "नमस्ते, मैं न्याय सहायक हूँ। मैं आपकी क्या मदद कर सकता हूँ?",
                "target_language_code": "hi-IN"
            },
            timeout=30.0
        )
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            with open("test_output.mp3", "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)
            print("Successfully saved test_output.mp3")
        else:
            print("Error:", response.text)

if __name__ == "__main__":
    asyncio.run(test_tts())

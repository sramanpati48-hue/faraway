import asyncio
import websockets
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

async def mock_moderator_client():
    uri = "ws://localhost:8000/ws/moderator"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected to Legal Moderator WebSocket!")
            print("Waiting for new case broadcasts...")
            
            while True:
                response = await websocket.recv()
                data = json.loads(response)
                
                print("\n==================================")
                print("🚨 NEW HIGH CRITICALITY CASE SECURED")
                print("==================================")
                print(f"Event Type: {data.get('event')}")
                print(f"User ID: {data.get('user_id')}")
                print(f"Incident Type: {data.get('incident_type')}")
                print("Structured Report JSON:")
                print(json.dumps(data.get('structured_report'), indent=2))
                
                # We've received the case, exit test successfully
                break
                
    except EOFError:
         print("Connection closed.")
    except Exception as e:
         print(f"❌ WebSocket error: {e}")

if __name__ == "__main__":
    asyncio.run(mock_moderator_client())

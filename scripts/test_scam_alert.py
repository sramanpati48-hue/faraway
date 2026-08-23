
import os
import sys
from dotenv import load_dotenv

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database.vector_db import VectorDB
from geopy.geocoders import Nominatim
import time

load_dotenv()
load_dotenv(dotenv_path="backend/agents/.env")

def test_geolocation():
    print("\n🌍 Testing Geocoding...")
    geolocator = Nominatim(user_agent="nyaysahayak_test")
    
    # Test coordinates (Bangalore - Koramangala approx)
    lat = 12.934533
    lon = 77.626579
    
    try:
        location = geolocator.reverse(f"{lat}, {lon}", language="en")
        address = location.raw.get('address', {})
        city = address.get('city', address.get('town', address.get('village', 'Unknown')))
        state_name = address.get('state', 'Unknown')
        print(f"✅ Geocoded: {city}, {state_name}")
        return city
    except Exception as e:
        print(f"❌ Geocoding Failed: {e}")
        return None

def test_scam_storage(city):
    if not city:
        print("⚠️ Skipping storage test due to geocoding failure")
        return

    print(f"\n📝 Testing Scam Storage for {city}...")
    db = VectorDB()
    
    test_scam = f"Test Scam Report for verification purposes in {city} at {time.time()}"
    
    # Add scam
    db.add_scam(test_scam, {"city": city, "state": "TestState", "source": "test_script"})
    
    time.sleep(1)

    print(f"\n🔍 Searching for scams in {city}...")
    results = db.search("scam report", namespaces="scams", filter={"city": city})
    
    found = any(test_scam in res for res in results)
    
    if found:
        print(f"✅ Successfully retrieved test scam from {city}!")
        print(f"   Results: {results}")
    else:
        print(f"❌ Failed to retrieve test scam. Results: {results}")

if __name__ == "__main__":
    city = test_geolocation()
    if city:
        test_scam_storage(city)

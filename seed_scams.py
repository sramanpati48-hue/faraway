import os
import random
import uuid
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# City centers for clustering
CITIES = [
    {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777, "weight": 100},  # Heavy congestion
    {"name": "Delhi", "lat": 28.7041, "lon": 77.1025, "weight": 90},    # Heavy
    {"name": "Bangalore", "lat": 12.9716, "lon": 77.5946, "weight": 70}, # Moderate-heavy
    {"name": "Kolkata", "lat": 22.5726, "lon": 88.3639, "weight": 60},   # Moderate
    {"name": "Hyderabad", "lat": 17.3850, "lon": 78.4867, "weight": 55}, # Moderate
    {"name": "Chennai", "lat": 13.0827, "lon": 80.2707, "weight": 50},   # Moderate
    {"name": "Pune", "lat": 18.5204, "lon": 73.8567, "weight": 40},      # Moderate-low
    {"name": "Jaipur", "lat": 26.9124, "lon": 75.7873, "weight": 20},    # Low
    {"name": "Lucknow", "lat": 26.8467, "lon": 80.9462, "weight": 15},   # Low
    {"name": "Ahmedabad", "lat": 23.0225, "lon": 72.5714, "weight": 20}, # Low
    {"name": "Patna", "lat": 25.5941, "lon": 85.1376, "weight": 10},     # Very Low
    {"name": "Guwahati", "lat": 26.1445, "lon": 91.7362, "weight": 10},  # Very Low
]

SCAM_TYPES = ["Phishing", "UPI Fraud", "Job Scam", "Investment Fraud", "OTP Scam", "Extortion", "Fake KYC"]

def generate_mock_data(total_records=1000):
    records = []
    
    cities = []
    for city in CITIES:
        cities.extend([city] * city["weight"])

    for _ in range(total_records):
        city = random.choice(cities)
        
        # Add random jitter to lat/lon to simulate different areas in the city / outskirts
        # 1 degree lat/lon is approx 111km. So 0.1 is ~11km.
        lat_jitter = random.uniform(-0.15, 0.15)
        lon_jitter = random.uniform(-0.15, 0.15)
        
        # 10% chance of random rural area all over India (broad bounding box)
        if random.random() < 0.10:
            final_lat = random.uniform(8.0, 32.0)
            final_lon = random.uniform(68.0, 95.0)
            city_name = "Rural / Unknown"
        else:
            final_lat = city["lat"] + lat_jitter
            final_lon = city["lon"] + lon_jitter
            city_name = city["name"]

        scam_type = random.choice(SCAM_TYPES)
        risk_level = random.choices(["High", "Medium", "Low"], weights=[0.5, 0.3, 0.2])[0]
        
        records.append({
            "title": f"{scam_type} reported in {city_name}",
            "description": f"A user reported a {scam_type.lower()} incident.",
            "scam_type": scam_type,
            "risk_level": risk_level,
            "city": city_name,
            "lat": final_lat,
            "lon": final_lon,
            "timestamp": (datetime.now() - timedelta(days=random.randint(0, 30), hours=random.randint(0,24))).isoformat()
        })
        
    return records

def seed_db():
    print("Generating mock data...")
    records = generate_mock_data(800)
    print(f"Generated {len(records)} records. Inserting into Supabase...")
    
    # Insert in batches of 100
    batch_size = 100
    for i in range(0, len(records), batch_size):
        batch = records[i:i+batch_size]
        supabase.table("mock_scams").insert(batch).execute()
        print(f"Inserted batch {i//batch_size + 1}/{len(records)//batch_size + 1}")
        
    print("Done seeding mock_scams table!")

if __name__ == "__main__":
    seed_db()

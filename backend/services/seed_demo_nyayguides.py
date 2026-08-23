"""
Development-only fixture seeder for NyayGuides.
Gated by NYAYGUIDE_DEMO_MODE=true or non-production environment.
All profiles use strictly fictional names, dummy contact data, and explicit [DEMO] labels.
"""
from __future__ import annotations

import os
import json
from dotenv import load_dotenv
from backend.database.postgres_pool import execute_one, execute_void

load_dotenv()

DEMO_NYAYGUIDES = [
    {
        "user_id": "demo_nyayguide_priya",
        "display_name": "[DEMO] Priya Sharma (NyayGuide)",
        "profile_photo_url": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200",
        "gender": "female",
        "languages": ["en", "hi", "pa"],
        "specializations": ["document_support", "complaint_filing_support", "office_navigation"],
        "latitude": 30.7333,
        "longitude": 76.7794,
        "availability_status": "AVAILABLE",
        "verification_status": "VERIFIED",
        "rating": 4.9,
    },
    {
        "user_id": "demo_nyayguide_sunita",
        "display_name": "[DEMO] Sunita Kaur (NyayGuide)",
        "profile_photo_url": "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200",
        "gender": "female",
        "languages": ["hi", "pa"],
        "specializations": ["digital_assistance", "office_navigation", "document_support"],
        "latitude": 30.7046,
        "longitude": 76.7179,
        "availability_status": "AVAILABLE",
        "verification_status": "VERIFIED",
        "rating": 4.8,
    },
    {
        "user_id": "demo_nyayguide_rajesh",
        "display_name": "[DEMO] Rajesh Kumar (NyayGuide)",
        "profile_photo_url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
        "gender": "male",
        "languages": ["en", "hi"],
        "specializations": ["office_navigation", "document_support", "digital_assistance"],
        "latitude": 30.7500,
        "longitude": 76.7600,
        "availability_status": "AVAILABLE",
        "verification_status": "VERIFIED",
        "rating": 4.7,
    },
    {
        "user_id": "demo_nyayguide_gurpreet",
        "display_name": "[DEMO] Gurpreet Singh (NyayGuide)",
        "profile_photo_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
        "gender": "male",
        "languages": ["pa", "hi"],
        "specializations": ["complaint_filing_support", "office_navigation"],
        "latitude": 30.6900,
        "longitude": 76.6900,
        "availability_status": "AVAILABLE",
        "verification_status": "VERIFIED",
        "rating": 4.85,
    },
    {
        "user_id": "demo_nyayguide_ananya",
        "display_name": "[DEMO] Ananya Sen (NyayGuide)",
        "profile_photo_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
        "gender": "female",
        "languages": ["en", "hi", "bn"],
        "specializations": ["digital_assistance", "document_support"],
        "latitude": 28.6139,
        "longitude": 77.2090,
        "availability_status": "AVAILABLE",
        "verification_status": "VERIFIED",
        "rating": 4.95,
    },
]


def seed_demo_nyayguides_if_enabled(force: bool = False) -> int:
    """
    Seeds fictional demo NyayGuides if NYAYGUIDE_DEMO_MODE=true or non-production environment.
    Never runs in production.
    """
    env = (os.getenv("NODE_ENV") or os.getenv("ENVIRONMENT") or "development").lower()
    demo_mode = os.getenv("NYAYGUIDE_DEMO_MODE", "true").lower() in ("true", "1", "yes")

    if env == "production" and not force:
        print("[NYAYGUIDE SEED] Refusing to seed demo NyayGuides in production environment.")
        return 0

    if not demo_mode and not force:
        print("[NYAYGUIDE SEED] NYAYGUIDE_DEMO_MODE is not enabled. Skipping fixture seeding.")
        return 0

    inserted_count = 0
    for guide in DEMO_NYAYGUIDES:
        sql = """
        INSERT INTO public.nyay_guides (
            user_id, display_name, profile_photo_url, gender, languages,
            specializations, latitude, longitude, location_updated_at,
            availability_status, verification_status, rating
        ) VALUES (
            %s, %s, %s, %s, %s::jsonb,
            %s::jsonb, %s, %s, now(),
            %s, %s, %s
        )
        ON CONFLICT (user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            profile_photo_url = EXCLUDED.profile_photo_url,
            gender = EXCLUDED.gender,
            languages = EXCLUDED.languages,
            specializations = EXCLUDED.specializations,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            location_updated_at = now(),
            availability_status = EXCLUDED.availability_status,
            verification_status = EXCLUDED.verification_status,
            rating = EXCLUDED.rating,
            updated_at = now();
        """
        execute_void(sql, (
            guide["user_id"],
            guide["display_name"],
            guide["profile_photo_url"],
            guide["gender"],
            json.dumps(guide["languages"]),
            json.dumps(guide["specializations"]),
            guide["latitude"],
            guide["longitude"],
            guide["availability_status"],
            guide["verification_status"],
            guide["rating"],
        ))
        inserted_count += 1

    print(f"[NYAYGUIDE SEED] Successfully seeded {inserted_count} [DEMO] NyayGuide fictional fixtures.")
    return inserted_count


if __name__ == "__main__":
    seed_demo_nyayguides_if_enabled(force=True)

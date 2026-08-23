"""Seed mock nodal guides (every state/UT) and NyaySahayak profiles into Postgres."""
from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.agents.local_justice import STATE_FORUMS, forum_for_state, normalize_state_name

# Approximate bounding boxes so location lookup has a hit in each state.
STATE_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    "andhra pradesh": (12.6, 19.9, 76.8, 84.8),
    "arunachal pradesh": (26.6, 29.5, 91.5, 97.4),
    "assam": (24.1, 28.0, 89.7, 96.0),
    "bihar": (24.3, 27.5, 83.3, 88.1),
    "chhattisgarh": (17.8, 24.1, 80.2, 84.4),
    "goa": (14.9, 15.8, 73.7, 74.4),
    "gujarat": (20.1, 24.7, 68.2, 74.5),
    "haryana": (27.6, 30.9, 74.5, 77.6),
    "himachal pradesh": (30.4, 33.2, 75.6, 79.0),
    "jharkhand": (21.9, 25.3, 83.3, 87.9),
    "karnataka": (11.5, 18.5, 74.0, 78.6),
    "kerala": (8.2, 12.8, 74.8, 77.4),
    "madhya pradesh": (21.1, 26.9, 74.0, 82.8),
    "maharashtra": (15.6, 22.1, 72.6, 80.9),
    "manipur": (23.8, 25.7, 93.0, 94.8),
    "meghalaya": (25.0, 26.1, 89.8, 92.8),
    "mizoram": (21.9, 24.5, 92.2, 93.4),
    "nagaland": (25.2, 27.0, 93.3, 95.2),
    "odisha": (17.8, 22.6, 81.4, 87.5),
    "punjab": (29.5, 32.5, 73.9, 76.9),
    "rajasthan": (23.0, 30.2, 69.5, 78.3),
    "sikkim": (27.0, 28.1, 88.0, 88.9),
    "tamil nadu": (8.1, 13.6, 76.2, 80.3),
    "telangana": (15.8, 19.9, 77.2, 81.8),
    "tripura": (22.9, 24.5, 91.1, 92.3),
    "uttar pradesh": (23.9, 30.4, 77.1, 84.6),
    "uttarakhand": (28.7, 31.5, 77.6, 81.0),
    "west bengal": (21.5, 27.2, 85.8, 89.9),
    "delhi": (28.4, 28.9, 76.8, 77.4),
    "jammu and kashmir": (32.3, 35.1, 73.8, 80.3),
    "ladakh": (32.3, 36.0, 75.9, 80.2),
    "chandigarh": (30.68, 30.77, 76.72, 76.84),
    "puducherry": (11.7, 12.1, 79.7, 79.9),
    "andaman and nicobar islands": (6.7, 13.6, 92.2, 94.0),
    "lakshadweep": (8.2, 12.3, 71.7, 74.0),
    "dadra and nagar haveli and daman and diu": (20.1, 20.8, 72.8, 73.2),
}

GUIDE_NAMES = [
    ("Sunita Devi", "Hindi"),
    ("Ramesh Yadav", "Hindi"),
    ("Priya Sharma", "Hindi"),
    ("Mohan Oraon", "Hindi"),
    ("Asha Patil", "Marathi"),
    ("Kiran Reddy", "Telugu"),
    ("Meera Nair", "Malayalam"),
    ("Arjun Singh", "Punjabi"),
    ("Lakshmi Iyer", "Tamil"),
    ("Farooq Ahmad", "Urdu"),
]

SAHAYAK_NAMES = [
    ("Anita Sharma", "Community Legal Volunteer"),
    ("Vikram Joshi", "NyaySahayak field guide"),
    ("Kavya Malhotra", "Women Support Facilitator"),
]


def _canonical_states() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for key in STATE_FORUMS:
        if key in {"jammu & kashmir", "andaman & nicobar", "the dadra and nagar haveli and daman and diu"}:
            continue
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def nodal_rows() -> list[dict]:
    rows = []
    for i, key in enumerate(_canonical_states()):
        forum = forum_for_state(key)
        bounds = STATE_BOUNDS.get(key, (8.0, 37.0, 68.0, 97.0))
        name, lang = GUIDE_NAMES[i % len(GUIDE_NAMES)]
        display_state = forum["state"]
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "name": f"{name}",
                "state": display_state,
                "city": display_state,
                "location": f"{forum['institution_name']}, {display_state}",
                "occupation": f"{forum['label']} Nodal Officer",
                "bio": (
                    f"Helps residents of {display_state} with petty local disputes at the "
                    f"{forum['institution_name']}. {forum['note']}."
                ),
                "avatar": f"https://ui-avatars.com/api/?name={name.replace(' ', '+')}&background=2d5a4e&color=fff&size=128",
                "contact_number": f"+91-98{(10000000 + i * 137) % 90000000:08d}",
                "email": f"nodal.{key.replace(' ', '.')[:18]}@nyaysahayak.in",
                "availability": "Available",
                "rating": 4.4 + ((i % 5) * 0.1),
                "cases_resolved": 40 + (i * 7) % 120,
                "languages": [lang, "Hindi", "English"] if lang not in {"Hindi", "English"} else ["Hindi", "English"],
                "lat_min": bounds[0],
                "lat_max": bounds[1],
                "lon_min": bounds[2],
                "lon_max": bounds[3],
                "institution_type": forum["institution_type"],
                "institution_name": forum["institution_name"],
                "regional_name": forum["regional_name"],
            }
        )
    return rows


def sahayak_rows() -> list[dict]:
    rows = []
    for i, key in enumerate(_canonical_states()):
        forum = forum_for_state(key)
        name, occ = SAHAYAK_NAMES[i % len(SAHAYAK_NAMES)]
        slug = key.replace(" ", "_")[:24]
        display_state = forum["state"]
        rows.append(
            {
                "uid": f"seed_ns_{slug}_001",
                "name": f"{name}",
                "email": f"ns.{slug[:18]}@nyaysahayak.in",
                "contact_number": f"+91-99{(20000000 + i * 211) % 90000000:08d}",
                "location": display_state,
                "state": display_state,
                "city": display_state,
                "occupation": occ,
                "languages": ["Hindi", "English"],
                "bio": f"On-ground NyaySahayak for {display_state}. Helps file, visit local forums, and walk you through next steps.",
                "avatar": f"https://ui-avatars.com/api/?name={name.replace(' ', '+')}&background=00634B&color=fff&size=128",
                "availability": "Available",
                "rating": 4.6,
                "cases_resolved": 30 + i,
            }
        )
    return rows


def seed(database_url: str) -> None:
    import psycopg
    from argon2 import PasswordHasher

    ph = PasswordHasher()
    default_password_hash = ph.hash("NodalGuide123!")

    guides = nodal_rows()
    sahayaks = sahayak_rows()
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM public.nodal_guides
                WHERE email LIKE 'nodal.%@nyaysahayak.in'
                   OR email LIKE '%.ng@nyaysahayak.in'
                """
            )
            for g in guides:
                cur.execute(
                    """
                    INSERT INTO public.nodal_guides (
                      id, name, state, city, location, occupation, bio, avatar, contact_number, email,
                      availability, rating, cases_resolved, languages,
                      lat_min, lat_max, lon_min, lon_max,
                      institution_type, institution_name, regional_name
                    )
                    VALUES (
                      %(id)s, %(name)s, %(state)s, %(city)s, %(location)s, %(occupation)s, %(bio)s, %(avatar)s,
                      %(contact_number)s, %(email)s, %(availability)s, %(rating)s, %(cases_resolved)s,
                      %(languages)s, %(lat_min)s, %(lat_max)s, %(lon_min)s, %(lon_max)s,
                      %(institution_type)s, %(institution_name)s, %(regional_name)s
                    )
                    """,
                    {**g, "languages": g["languages"]},
                )
                cur.execute(
                    "SELECT id FROM public.users WHERE lower(email) = lower(%s) LIMIT 1",
                    (g["email"],),
                )
                existing_u = cur.fetchone()
                if existing_u:
                    cur.execute(
                        """
                        UPDATE public.users
                        SET password_hash = %s, role = 'nodal_guide', status = 'active',
                            password_reset_required = false, display_name = %s, updated_at = now()
                        WHERE id = %s
                        """,
                        (default_password_hash, g["name"], existing_u[0]),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO public.users (email, mobile, password_hash, role, status, password_reset_required, display_name)
                        VALUES (%s, %s, %s, 'nodal_guide', 'active', false, %s)
                        """,
                        (g["email"], g["contact_number"], default_password_hash, g["name"]),
                    )
            for s in sahayaks:
                cur.execute(
                    """
                    INSERT INTO public.sahayak_profiles (
                      uid, name, email, contact_number, location, state, city, occupation, languages,
                      bio, avatar, availability, rating, cases_resolved
                    )
                    VALUES (
                      %(uid)s, %(name)s, %(email)s, %(contact_number)s, %(location)s, %(state)s, %(city)s,
                      %(occupation)s, %(languages)s, %(bio)s, %(avatar)s, %(availability)s, %(rating)s,
                      %(cases_resolved)s
                    )
                    ON CONFLICT (uid) DO UPDATE SET
                      name = EXCLUDED.name,
                      location = EXCLUDED.location,
                      state = EXCLUDED.state,
                      city = EXCLUDED.city,
                      occupation = EXCLUDED.occupation,
                      bio = EXCLUDED.bio,
                      availability = EXCLUDED.availability
                    """,
                    s,
                )
            conn.commit()
    print(f"Seeded {len(guides)} nodal guides (into nodal_guides + users) and upserted {len(sahayaks)} NyaySahayak profiles.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL is required")
    seed(args.database_url)


if __name__ == "__main__":
    main()

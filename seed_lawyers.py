from backend.database.firebase_db import db

def seed_lawyers():
    if not db:
        print("Firestore not initialized")
        return

    lawyers_data = [
        {
            "name": "Arjun Sharma",
            "specialization": "Family Law",
            "experience": 12,
            "hourlyRate": 1500,
            "rating": 4.8,
            "bio": "Expert in divorce, child custody, and domestic matters. Serving Delhi-NCR with a track record of empathetic and effective legal representation.",
            "avatar": "https://images.unsplash.com/photo-1556155092-490a1ba16284?q=80&w=250&h=250&auto=format&fit=crop",
            "location": "New Delhi",
            "verified": True
        },
        {
            "name": "Priyanka Roy",
            "specialization": "Criminal Defense",
            "experience": 8,
            "hourlyRate": 2500,
            "rating": 4.9,
            "bio": "Specializing in criminal litigation, bail applications, and high-stakes criminal trials. Committed to upholding your constitutional rights.",
            "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=250&h=250&auto=format&fit=crop",
            "location": "Kolkata",
            "verified": True
        },
        {
            "name": "Vikram Singh",
            "specialization": "Property & Real Estate",
            "experience": 15,
            "hourlyRate": 1200,
            "rating": 4.7,
            "bio": "15+ years experience in property dispute resolution, RERA compliance, and real estate transactions across North India.",
            "avatar": "https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?q=80&w=250&h=250&auto=format&fit=crop",
            "location": "Chandigarh",
            "verified": True
        },
        {
            "name": "Ananya Chatterjee",
            "specialization": "Corporate Law",
            "experience": 6,
            "hourlyRate": 3500,
            "rating": 4.6,
            "bio": "Assisting startups with funding rounds, IP protection, and compliance with the Companies Act. Focused on building strong legal foundations.",
            "avatar": "https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=250&h=250&auto=format&fit=crop",
            "location": "Mumbai",
            "verified": False
        },
        {
            "name": "Siddharth Verma",
            "specialization": "Labour Law",
            "experience": 10,
            "hourlyRate": 800,
            "rating": 4.5,
            "bio": "Advocating for worker rights and fair labor practices. Specialist in workplace harassment cases and wrongful termination.",
            "avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=250&h=250&auto=format&fit=crop",
            "location": "Bangalore",
            "verified": True
        }
    ]

    for ld in lawyers_data:
        try:
            db.collection("lawyers").add(ld)
            print(f"Added lawyer: {ld['name']}")
        except Exception as e:
            print(f"Error adding lawyer {ld['name']}: {e}")

if __name__ == "__main__":
    seed_lawyers()

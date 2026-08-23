import os
import sys

sys.path.append(os.getcwd())
from backend.database.firebase_db import db

def seed_legal_rights():
    legal_rights = [
        {
            "id": "police-fir-rights",
            "title": "Rights Against Police and FIR",
            "description": "Understand your rights when dealing with the police, including arrest procedures, filing exactly an FIR, and protection against harassment or illegal detention.",
            "action_prompt": "What are my rights regarding arrest and filing an FIR?"
        },
        {
            "id": "cyber-fraud-rights",
            "title": "Cyber Fraud Victim Rights",
            "description": "Information on immediate steps to take if you are a victim of online banking fraud, phishing, or identity theft, and how to report it to the cyber cell.",
            "action_prompt": "I'm a victim of cyber fraud. What are my rights and immediate steps?"
        },
        {
            "id": "women-legal-rights",
            "title": "Women Legal Rights",
            "description": "Comprehensive guide on laws protecting women against domestic violence, dowry harassment, sexual harassment at workplace, and maternity benefits.",
            "action_prompt": "Tell me about legal rights and protections for women in India."
        },
        {
            "id": "consumer-rights",
            "title": "Consumer Rights",
            "description": "Know your rights concerning faulty products, deficient services, misleading advertisements, and how to approach the Consumer Disputes Redressal Commission.",
            "action_prompt": "What are my rights as a consumer against defective products?"
        },
        {
            "id": "employee-rights",
            "title": "Employee Rights",
            "description": "Learn about your rights regarding minimum wages, working hours, wrongful termination, discrimination, and workplace safety.",
            "action_prompt": "What are my employee rights against unfair termination and unpaid wages?"
        },
        {
            "id": "property-land-rights",
            "title": "Property and Land Rights",
            "description": "Guidance on property disputes, succession and inheritance laws, tenant-landlord regulations, and verifying property titles.",
            "action_prompt": "I need help understanding my legal rights in a property dispute."
        },
        {
            "id": "free-legal-aid",
            "title": "Free Legal Aid Rights",
            "description": "Information on your constitutional right to free legal representation, eligibility criteria, and how to apply for services through NALSA.",
            "action_prompt": "How can I apply for free legal aid and what are the criteria?"
        }
    ]

    collection_ref = db.collection("legal_rights")
    
    # Check if already seeded to avoid duplicates
    existing = collection_ref.limit(1).get()
    if existing:
        print("Legal rights already seeded in Firestore.")
        return

    print("Seeding legal rights...")
    for right in legal_rights:
        doc_ref = collection_ref.document(right["id"])
        doc_ref.set(right)
        print(f"Added: {right['title']}")
        
    print("Seeding complete.")

if __name__ == "__main__":
    seed_legal_rights()

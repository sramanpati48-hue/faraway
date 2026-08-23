#!/usr/bin/env python3
"""Seed mock data for sidebar sections: legal rights, document templates,
case-filing guides, About Us site content, and (if empty) mock lawyers.

Usage:
    python scripts/seed_site_content.py
    python scripts/seed_site_content.py --skip-lawyers
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.database.postgres_pool import execute, execute_void, is_postgres_configured  # noqa: E402


LEGAL_RIGHTS = [
    ("police-fir-rights", "Police & FIR Rights",
     "You can file an FIR for cognizable offences. Police cannot refuse registration for lack of jurisdiction alone.",
     "Explain my rights when filing an FIR in India", "Criminal Law", "shield", 10),
    ("cyber-fraud-rights", "Cyber Fraud Rights",
     "Report UPI/banking fraud quickly via cybercrime.gov.in and your bank to improve recovery chances.",
     "Someone stole money from my UPI. What should I do?", "Cyber & Financial Fraud", "alert", 20),
    ("women-legal-rights", "Women Legal Rights",
     "Protections exist under domestic violence, workplace harassment, and criminal law frameworks.",
     "Explain legal protections available for women facing harassment", "Women's Rights", "users", 30),
    ("consumer-rights", "Consumer Rights",
     "Defective goods and unfair trade practices can be taken to consumer forums.",
     "How do I file a consumer complaint in India?", "Consumer Rights", "briefcase", 40),
    ("employee-rights", "Employee Rights",
     "Wage, workplace safety, and harassment protections apply across many employment contexts.",
     "What are my rights if my employer is withholding salary?", "Labour & Employment", "file", 50),
    ("property-land-rights", "Property & Land Rights",
     "Title disputes, possession issues, and inheritance claims have civil and revenue remedies.",
     "Help me understand options for a land possession dispute", "Property & Land", "book", 60),
    ("free-legal-aid", "Free Legal Aid",
     "Eligible persons can seek free legal services through NALSA / SLSA / DLSA networks.",
     "How can I get free legal aid near me?", "Governance", "scale", 70),
    ("tenant-rights", "Tenant & Rent Rights",
     "Tenants are protected against illegal eviction and arbitrary rent hikes under state rent laws.",
     "My landlord is not returning my security deposit. What can I do?", "Tenancy & Rent", "book", 80),
    ("accident-compensation-rights", "Accident Compensation Rights",
     "Road accident victims can claim compensation through Motor Accident Claims Tribunals.",
     "How do I claim compensation after a road accident?", "Motor & Accident", "alert", 90),
    ("rti-rights", "Right to Information",
     "Any citizen can seek information from public authorities under the RTI Act, 2005.",
     "How do I file an RTI application?", "RTI & Governance", "file", 100),
]


DOCUMENT_TEMPLATES = [
    ("rent-agreement", "Rent Agreement", "Property & Tenancy",
     "Standard residential rent/lease agreement between landlord and tenant.",
     "This Rent Agreement is made on {{date}} between {{landlord_name}} (Landlord) and {{tenant_name}} (Tenant) for the property at {{property_address}} for a monthly rent of Rs. {{rent_amount}}...",
     [{"key": "landlord_name", "label": "Landlord Name"}, {"key": "tenant_name", "label": "Tenant Name"},
      {"key": "property_address", "label": "Property Address"}, {"key": "rent_amount", "label": "Monthly Rent"}], 10),
    ("legal-notice", "Legal Notice", "General",
     "A formal legal notice to demand action or payment before litigation.",
     "To, {{recipient_name}}. Take notice that my client {{sender_name}} demands {{demand}} within {{days}} days, failing which legal proceedings shall be initiated...",
     [{"key": "recipient_name", "label": "Recipient"}, {"key": "sender_name", "label": "Sender"},
      {"key": "demand", "label": "Demand"}, {"key": "days", "label": "Notice Period (days)"}], 20),
    ("affidavit", "General Affidavit", "General",
     "A sworn statement of facts for use before authorities or courts.",
     "I, {{deponent_name}}, aged {{age}}, resident of {{address}}, do hereby solemnly affirm and declare as under: {{statement}}...",
     [{"key": "deponent_name", "label": "Deponent Name"}, {"key": "age", "label": "Age"},
      {"key": "address", "label": "Address"}, {"key": "statement", "label": "Statement"}], 30),
    ("consumer-complaint", "Consumer Complaint", "Consumer",
     "Complaint to the District Consumer Disputes Redressal Commission.",
     "Before the District Consumer Disputes Redressal Commission, {{district}}. Complainant: {{name}} vs {{opposite_party}}. Facts: {{facts}}. Relief sought: {{relief}}...",
     [{"key": "name", "label": "Complainant"}, {"key": "opposite_party", "label": "Opposite Party"},
      {"key": "district", "label": "District"}, {"key": "facts", "label": "Facts"}, {"key": "relief", "label": "Relief"}], 40),
    ("rti-application", "RTI Application", "Governance",
     "Application to a Public Information Officer under the RTI Act, 2005.",
     "To, The Public Information Officer, {{department}}. Under the RTI Act 2005, kindly provide the following information: {{information_sought}}...",
     [{"key": "department", "label": "Department"}, {"key": "information_sought", "label": "Information Sought"}], 50),
    ("power-of-attorney", "Power of Attorney", "General",
     "Authorise another person to act on your behalf for specified matters.",
     "I, {{principal_name}}, hereby appoint {{agent_name}} as my lawful attorney to act on my behalf for {{purpose}}...",
     [{"key": "principal_name", "label": "Principal"}, {"key": "agent_name", "label": "Agent"},
      {"key": "purpose", "label": "Purpose"}], 60),
    ("complaint-letter-police", "Police Complaint Letter", "Criminal",
     "A written complaint to the Station House Officer to register an FIR.",
     "To, The SHO, {{police_station}}. Subject: Complaint regarding {{subject}}. Respected Sir/Madam, I wish to report the following incident: {{details}}...",
     [{"key": "police_station", "label": "Police Station"}, {"key": "subject", "label": "Subject"},
      {"key": "details", "label": "Incident Details"}], 70),
    ("employment-resignation", "Resignation Letter", "Employment",
     "A formal resignation letter with notice period.",
     "To, {{manager_name}}, {{company}}. I hereby tender my resignation from the post of {{designation}}, effective {{last_day}}...",
     [{"key": "manager_name", "label": "Manager"}, {"key": "company", "label": "Company"},
      {"key": "designation", "label": "Designation"}, {"key": "last_day", "label": "Last Working Day"}], 80),
]


CASE_FILING_TEMPLATES = [
    ("file-fir", "File an FIR", "Criminal",
     "Register a First Information Report for a cognizable offence at the local police station.",
     ["Go to the police station having jurisdiction (or file a Zero FIR anywhere).",
      "Narrate the incident; provide a written complaint.",
      "Ensure the FIR is read over to you and get a free copy.",
      "Note the FIR number for future reference."],
     ["Identity proof", "Written complaint", "Any evidence (photos, messages)"], "1-2 hours", "Local Police Station",
     "I need help filing an FIR in India. Guide me step by step: jurisdiction vs Zero FIR, what to write in the complaint, getting a free FIR copy, and what to do if police refuse.",
     10),
    ("consumer-complaint-filing", "File a Consumer Complaint", "Consumer",
     "Approach the Consumer Commission for defective goods or deficient services.",
     ["Send a written complaint to the seller/service provider.",
      "Draft the complaint with facts and relief sought.",
      "File before the appropriate District/State/National Commission.",
      "Pay the nominal fee and attend hearings."],
     ["Purchase invoice/bill", "Warranty card", "Correspondence with seller"], "30-90 days", "Consumer Disputes Redressal Commission",
     "Help me file a consumer complaint in India. Guide me on sending a written notice to the seller, choosing District/State/National Commission, drafting facts and relief sought, fees, and documents I need.",
     20),
    ("cyber-crime-report", "Report a Cyber Crime", "Cyber",
     "Report online fraud or cyber offences through the national cybercrime portal.",
     ["Visit cybercrime.gov.in and register the complaint.",
      "Call helpline 1930 immediately for financial fraud.",
      "Inform your bank to freeze/reverse the transaction.",
      "Preserve screenshots, transaction IDs and messages."],
     ["Transaction details", "Screenshots", "Bank statement"], "Immediate", "National Cyber Crime Portal / 1930",
     "I need to report a cyber crime in India. Guide me through cybercrime.gov.in, helpline 1930 for financial fraud, informing my bank, and what evidence to preserve.",
     30),
    ("domestic-violence-complaint", "File a Domestic Violence Complaint", "Family",
     "Seek protection and relief under the PWDV Act, 2005.",
     ["Approach a Protection Officer, police, or magistrate.",
      "File an application (Form) for protection/residence/maintenance orders.",
      "Attend the hearing; interim orders can be granted quickly.",
      "Seek free legal aid if required."],
     ["Identity proof", "Evidence of abuse", "Medical records (if any)"], "Varies", "Magistrate / Protection Officer",
     "Help me file a domestic violence complaint under the PWDV Act. Explain Protection Officer / police / magistrate options, protection and residence orders, interim relief, and free legal aid.",
     40),
    ("motor-accident-claim", "File a Motor Accident Claim", "Motor",
     "Claim compensation before the Motor Accident Claims Tribunal.",
     ["Ensure an FIR is registered for the accident.",
      "Collect medical and vehicle documents.",
      "File the claim petition before the MACT.",
      "Attend hearings and produce evidence."],
     ["FIR copy", "Medical bills", "Insurance details", "Vehicle documents"], "6-18 months", "Motor Accident Claims Tribunal",
     "Guide me through filing a motor accident compensation claim before the MACT in India, including FIR, documents, petition drafting, and hearings.",
     50),
    ("cheque-bounce-case", "File a Cheque Bounce Case", "Criminal",
     "Initiate proceedings under Section 138 of the Negotiable Instruments Act.",
     ["Send a legal demand notice within 30 days of dishonour.",
      "Wait 15 days for payment after notice.",
      "File a complaint before the Magistrate within the limitation period.",
      "Attend hearings with the dishonoured cheque and bank memo."],
     ["Dishonoured cheque", "Bank return memo", "Demand notice copy"], "6-12 months", "Judicial Magistrate",
     "Help me file a cheque bounce case under Section 138 NI Act. Walk me through the demand notice timeline, waiting period, complaint filing, and required documents.",
     60),
    ("rti-filing", "File an RTI Application", "Governance",
     "Request information from a public authority under the RTI Act, 2005.",
     ["Identify the correct public authority and PIO.",
      "Write a clear application with specific questions.",
      "Pay the prescribed fee (Rs. 10 typically).",
      "Await response within 30 days; file first appeal if needed."],
     ["Application", "Fee receipt", "Identity proof (if required)"], "30 days", "Public Information Officer",
     "Help me file an RTI application in India. Guide me on identifying the PIO, drafting specific questions, fee payment, 30-day response, and first appeal.",
     70),
]


ABOUT_CONTENT = {
    "title": "About NyaySahayak",
    "tagline": "Justice made accessible for every Indian.",
    "mission": (
        "NyaySahayak is an AI-powered legal companion that helps citizens understand their rights, "
        "navigate the justice system, and connect with verified lawyers and Nyay Guides. We combine "
        "multilingual AI assistance with a curated legal knowledge base so that quality legal guidance "
        "is no longer a privilege."
    ),
    "stats": [
        {"label": "Legal knowledge base", "value": "Indexed"},
        {"label": "Lawyer network", "value": "Growing"},
        {"label": "Languages supported", "value": "3"},
        {"label": "Getting started", "value": "Free"},
    ],
    "values": [
        {"title": "Accessible", "description": "Legal help in your language, on any device."},
        {"title": "Trustworthy", "description": "Grounded in Indian statutes and verified experts."},
        {"title": "Empowering", "description": "We help you act, not just understand."},
    ],
    "team": [
        {"name": "NyaySahayak Legal Desk", "role": "Content & Research"},
        {"name": "AI Engineering", "role": "Product & Platform"},
    ],
}

LANDING_CONTENT = {
    "testimonials_disclaimer": (
        "Composite examples inspired by common case types — anonymised, not verified user reviews."
    ),
    "testimonials": [
        {
            "quote": (
                "I lost ₹38,000 to a fake customer-care link. NyaySahayak helped me understand Zero FIR "
                "and what to tell the cyber cell — calmly, without making me feel foolish."
            ),
            "name": "Composite example",
            "context": "Cyber fraud",
            "illustrative": True,
        },
        {
            "quote": (
                "My landlord served a sudden eviction notice. The platform walked me through what was "
                "legally valid and helped me draft a reply before I spoke to a lawyer."
            ),
            "name": "Composite example",
            "context": "Tenancy dispute",
            "illustrative": True,
        },
        {
            "quote": (
                "After months of workplace harassment, I needed someone to help me organise evidence. "
                "Having my case history in one place made the lawyer consultation actually useful."
            ),
            "name": "Composite example",
            "context": "Employment",
            "illustrative": True,
        },
    ],
}

MOCK_LAWYERS = [
    ("Priya Menon", "Cyber & Financial Fraud", "Senior Counsel / Specialist", "12", "3500",
     "Cybercrime and financial fraud specialist with over a decade helping victims recover from UPI, phishing and investment scams.", "Mumbai"),
    ("Rahul Verma", "Criminal Law", "Private Practice (PVT)", "9", "2500",
     "Criminal defence advocate handling bail, FIR quashing and trial matters across Delhi courts.", "Delhi"),
    ("Ananya Ghosh", "Family & Matrimonial", "Private Practice (PVT)", "8", "2000",
     "Family law expert focused on divorce, custody and maintenance with a compassionate, resolution-first approach.", "Kolkata"),
    ("Imran Sheikh", "Property & Land", "Senior Counsel / Specialist", "15", "4000",
     "Property and land dispute specialist experienced in title verification, partition and RERA matters.", "Hyderabad"),
    ("Sneha Iyer", "Consumer & Civil Disputes", "Panel / Retainer Lawyer", "7", "1800",
     "Consumer rights advocate winning refunds and compensation for defective products and deficient services.", "Chennai"),
    ("Vikram Rao", "Business & Employment", "Private Practice (PVT)", "11", "3000",
     "Employment and labour law counsel advising on terminations, PF/gratuity and workplace harassment.", "Bangalore"),
    ("Meera Nair", "Women's Rights", "Legal Aid / Pro Bono", "6", "1200",
     "Passionate about women's safety and rights, offering pro bono support in domestic violence and harassment cases.", "Pune"),
    ("Arjun Malhotra", "Claims & Compensation", "Private Practice (PVT)", "10", "2800",
     "Motor accident and insurance claims lawyer securing fair compensation through MACT and consumer forums.", "Jaipur"),
    ("Fatima Khan", "Criminal Law", "Legal Aid / Pro Bono", "5", "1000",
     "Legal aid advocate representing under-resourced clients in criminal and bail matters.", "Lucknow"),
    ("Rohit Sharma", "Property & Land", "Private Practice (PVT)", "13", "3200",
     "Real estate and tenancy disputes lawyer with strong drafting and negotiation experience.", "Ahmedabad"),
    ("Divya Menon", "Family & Matrimonial", "Senior Counsel / Specialist", "14", "3800",
     "Senior matrimonial counsel handling complex custody, alimony and mutual divorce settlements.", "Mumbai"),
    ("Sanjay Gupta", "Business & Employment", "Panel / Retainer Lawyer", "9", "2600",
     "Corporate and employment retainer advising startups on compliance, contracts and disputes.", "Delhi"),
    ("Kavya Reddy", "Cyber & Financial Fraud", "Private Practice (PVT)", "6", "1900",
     "Emerging cyber-law practitioner assisting with online fraud, data privacy and social media offences.", "Hyderabad"),
    ("Aditya Bose", "Consumer & Civil Disputes", "Private Practice (PVT)", "8", "2100",
     "Civil litigation and consumer disputes lawyer known for practical, cost-effective strategies.", "Kolkata"),
    ("Nisha Pillai", "Women's Rights", "Panel / Retainer Lawyer", "7", "1700",
     "Advocate for workplace safety and POSH compliance, supporting complainants end to end.", "Chennai"),
    ("Karan Johar", "Criminal Law", "Senior Counsel / Specialist", "16", "4200",
     "Seasoned criminal trial lawyer with a strong record in sessions and high court matters.", "Bangalore"),
    ("Pooja Deshmukh", "Property & Land", "Private Practice (PVT)", "9", "2400",
     "Land records, mutation and encroachment specialist assisting families with inheritance disputes.", "Pune"),
    ("Rajesh Kumar", "Claims & Compensation", "Legal Aid / Pro Bono", "5", "900",
     "Pro bono claims lawyer helping accident victims and their families access compensation.", "Patna"),
    ("Shreya Das", "Family & Matrimonial", "Private Practice (PVT)", "6", "1600",
     "Matrimonial and domestic relations advocate focused on amicable settlements.", "Guwahati"),
    ("Manish Agarwal", "Business & Employment", "Senior Counsel / Specialist", "18", "5000",
     "Senior counsel for commercial and employment disputes with arbitration expertise.", "Delhi"),
    ("Leela Krishnan", "Consumer & Civil Disputes", "Private Practice (PVT)", "10", "2700",
     "Consumer and civil disputes advocate with a strong track record before state commissions.", "Chennai"),
    ("Tarun Chatterjee", "Cyber & Financial Fraud", "Panel / Retainer Lawyer", "8", "2300",
     "Advises banks and individuals on fraud recovery, chargebacks and cyber complaints.", "Kolkata"),
    ("Ritu Sethi", "Women's Rights", "Legal Aid / Pro Bono", "9", "1300",
     "Dedicated women's rights advocate offering guidance on protection orders and maintenance.", "Delhi"),
    ("Harish Patel", "Property & Land", "Private Practice (PVT)", "12", "3100",
     "Property documentation and dispute resolution expert serving Gujarat and Maharashtra.", "Ahmedabad"),
    ("Ayesha Siddiqui", "Criminal Law", "Private Practice (PVT)", "7", "2000",
     "Criminal defence lawyer handling bail, cyber offences and women safety cases.", "Hyderabad"),
]

LAWYER_AVATARS = [
    "https://images.unsplash.com/photo-1556157382-97dee2dcb9d9?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?q=80&w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=800&auto=format&fit=crop",
]


def seed_legal_rights() -> None:
    for (rid, title, desc, prompt, category, icon, order) in LEGAL_RIGHTS:
        execute_void(
            """
            INSERT INTO public.legal_rights (id, title, description, action_prompt, category, icon_key, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title, description = EXCLUDED.description,
              action_prompt = EXCLUDED.action_prompt, category = EXCLUDED.category,
              icon_key = EXCLUDED.icon_key, sort_order = EXCLUDED.sort_order, updated_at = now()
            """,
            (rid, title, desc, prompt, category, icon, order),
        )
    print(f"Seeded {len(LEGAL_RIGHTS)} legal rights.")


def seed_document_templates() -> None:
    for (tid, title, category, desc, body, fields, order) in DOCUMENT_TEMPLATES:
        execute_void(
            """
            INSERT INTO public.document_templates (id, title, category, description, body, fields, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title, category = EXCLUDED.category, description = EXCLUDED.description,
              body = EXCLUDED.body, fields = EXCLUDED.fields, sort_order = EXCLUDED.sort_order, updated_at = now()
            """,
            (tid, title, category, desc, body, json.dumps(fields), order),
        )
    print(f"Seeded {len(DOCUMENT_TEMPLATES)} document templates.")


def seed_case_filing_templates() -> None:
    for (cid, title, category, desc, steps, docs, est, authority, prompt, order) in CASE_FILING_TEMPLATES:
        execute_void(
            """
            INSERT INTO public.case_filing_templates
              (id, title, category, description, steps, required_docs, estimated_time, authority, action_prompt, sort_order)
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title, category = EXCLUDED.category, description = EXCLUDED.description,
              steps = EXCLUDED.steps, required_docs = EXCLUDED.required_docs,
              estimated_time = EXCLUDED.estimated_time, authority = EXCLUDED.authority,
              action_prompt = EXCLUDED.action_prompt, sort_order = EXCLUDED.sort_order, updated_at = now()
            """,
            (cid, title, category, desc, json.dumps(steps), docs, est, authority, prompt, order),
        )
    print(f"Seeded {len(CASE_FILING_TEMPLATES)} case filing templates.")


def seed_about() -> None:
    execute_void(
        """
        INSERT INTO public.site_content (slug, value)
        VALUES ('about', %s::jsonb)
        ON CONFLICT (slug) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        """,
        (json.dumps(ABOUT_CONTENT),),
    )
    print("Seeded About Us content.")


def seed_landing() -> None:
    execute_void(
        """
        INSERT INTO public.site_content (slug, value)
        VALUES ('landing', %s::jsonb)
        ON CONFLICT (slug) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        """,
        (json.dumps(LANDING_CONTENT),),
    )
    print("Seeded landing page testimonials content.")


def seed_lawyers() -> None:
    existing = execute("SELECT count(*) AS n FROM public.lawyers")
    count = int(existing[0]["n"]) if existing else 0
    if count > 0:
        print(f"Lawyers table already has {count} rows; skipping lawyer seed.")
        return

    from backend.database.vector_db import VectorDB

    vdb = VectorDB()
    seeded = 0
    for idx, (name, spec, ltype, exp, rate, bio, location) in enumerate(MOCK_LAWYERS):
        uid = f"seed-lawyer-{idx + 1:03d}"
        avatar = LAWYER_AVATARS[idx % len(LAWYER_AVATARS)]
        rating = round(4.2 + (idx % 6) * 0.1, 1)
        execute_void(
            """
            INSERT INTO public.lawyers
              (user_id, name, email, specialization, lawyer_type, experience, hourly_rate,
               bio, location, avatar, contact_number, bar_registration_number, rating, verified)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
            ON CONFLICT (user_id) DO UPDATE SET
              name = EXCLUDED.name, specialization = EXCLUDED.specialization,
              lawyer_type = EXCLUDED.lawyer_type, experience = EXCLUDED.experience,
              hourly_rate = EXCLUDED.hourly_rate, bio = EXCLUDED.bio, location = EXCLUDED.location,
              avatar = EXCLUDED.avatar, rating = EXCLUDED.rating, updated_at = now()
            """,
            (
                uid, name, f"{name.split()[0].lower()}@example.com", spec, ltype, exp, rate,
                bio, location, avatar, "+91-90000-00000", f"BAR/{2024 - int(exp)}/{idx + 100}", rating,
            ),
        )
        try:
            vdb.add_lawyer(lawyer_id=uid, bio=bio, metadata={"name": name, "specialization": spec})
        except Exception as e:  # noqa: BLE001
            print(f"  ! embedding failed for {name}: {e}")
        seeded += 1
    print(f"Seeded {seeded} mock lawyers (with embeddings).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed sidebar-section mock data.")
    parser.add_argument("--skip-lawyers", action="store_true")
    args = parser.parse_args()

    if not is_postgres_configured():
        print("ERROR: DATABASE_URL not configured. Set it in .env before seeding.")
        sys.exit(1)

    seed_legal_rights()
    seed_document_templates()
    seed_case_filing_templates()
    seed_about()
    seed_landing()
    if not args.skip_lawyers:
        seed_lawyers()
    print("Done seeding site content.")


if __name__ == "__main__":
    main()

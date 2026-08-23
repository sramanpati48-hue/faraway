#!/usr/bin/env python3
"""Seed 300 templated legal articles with 768-d embeddings.

Embeddings are generated via the admin-configured Nyaysahayak embedding API
(``system_config.ai_embeddings`` -> ``external_embedding_url``/``/embed-texts``,
default ``https://130-211-122-175.sslip.io``). Idempotent by ``slug``.

Usage:
    python scripts/seed_articles.py
    python scripts/seed_articles.py --count 300 --batch 25
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from backend.database.postgres_pool import execute_void, is_postgres_configured  # noqa: E402
from backend.database.postgres_db import _format_pgvector  # noqa: E402

EMBEDDING_DIM = 768


def get_embed_texts_url() -> str:
    try:
        from backend.services.admin_models import get_embedding_config

        cfg = get_embedding_config()
        return f"{cfg.get('provider')}:{cfg.get('model')}"
    except Exception:
        return "nyaysahayak"


# ---------------------------------------------------------------------------
# Templated content generation
# ---------------------------------------------------------------------------

# category -> (list of base topics, list of authority/context blurbs)
CATEGORIES: dict[str, dict] = {
    "Property & Land": {
        "topics": [
            "Property Title Verification", "Sale Deed Registration", "Ancestral Property Partition",
            "Illegal Encroachment", "Tenant Eviction", "Benami Property", "Mutation of Land Records",
            "Gift Deed", "Adverse Possession", "Builder Delay & RERA",
        ],
        "authority": "Registration Act 1908, Transfer of Property Act 1882 and state RERA authorities",
        "prompt": "property or land dispute",
    },
    "Family & Matrimonial": {
        "topics": [
            "Mutual Divorce", "Contested Divorce", "Child Custody", "Maintenance & Alimony",
            "Domestic Violence Protection", "Dowry Harassment", "Marriage Registration",
            "Restitution of Conjugal Rights", "Adoption Procedure", "Guardianship Rights",
        ],
        "authority": "Hindu Marriage Act 1955, Special Marriage Act 1954 and the Protection of Women from Domestic Violence Act 2005",
        "prompt": "family or matrimonial matter",
    },
    "Criminal Law": {
        "topics": [
            "Filing an FIR", "Anticipatory Bail", "Regular Bail", "Quashing of FIR",
            "Cognizable vs Non-Cognizable Offences", "Rights on Arrest", "Bailable Offences",
            "Cheque Bounce (Section 138)", "Defamation", "Criminal Complaint before Magistrate",
        ],
        "authority": "Bharatiya Nyaya Sanhita 2023 and the Bharatiya Nagarik Suraksha Sanhita 2023",
        "prompt": "criminal law issue",
    },
    "Consumer Rights": {
        "topics": [
            "Filing a Consumer Complaint", "Defective Product Refund", "E-commerce Fraud",
            "Deficiency in Service", "Medical Negligence", "Unfair Trade Practices",
            "Insurance Claim Rejection", "Real Estate Consumer Rights", "Product Warranty Disputes",
            "Consumer Forum Jurisdiction",
        ],
        "authority": "the Consumer Protection Act 2019 and district/state consumer commissions",
        "prompt": "consumer complaint",
    },
    "Labour & Employment": {
        "topics": [
            "Wrongful Termination", "Unpaid Salary Recovery", "Provident Fund Disputes",
            "Gratuity Claims", "Sexual Harassment at Workplace", "Maternity Benefits",
            "Employment Bond Enforceability", "Contract Labour Rights", "Minimum Wages",
            "Workplace Injury Compensation",
        ],
        "authority": "the Industrial Disputes Act 1947, Code on Wages 2019 and the POSH Act 2013",
        "prompt": "workplace or employment problem",
    },
    "Cyber & Financial Fraud": {
        "topics": [
            "UPI & Banking Fraud", "Phishing Attacks", "Identity Theft", "Online Loan App Harassment",
            "Social Media Impersonation", "OTP Fraud", "Cryptocurrency Scams", "Data Privacy Breach",
            "Cyberstalking", "Fake Investment Schemes",
        ],
        "authority": "the Information Technology Act 2000 and the national cybercrime portal (cybercrime.gov.in)",
        "prompt": "cyber fraud or online scam",
    },
    "Women's Rights": {
        "topics": [
            "Protection from Domestic Violence", "Workplace Harassment Redressal", "Equal Property Rights",
            "Maternity Rights", "Right Against Stalking", "Free Legal Aid for Women",
            "Right to Privacy", "Anti-Dowry Protections", "Safe Reporting of Offences",
            "Reproductive Rights",
        ],
        "authority": "the Protection of Women from Domestic Violence Act 2005 and the POSH Act 2013",
        "prompt": "protection of women's legal rights",
    },
    "Tenancy & Rent": {
        "topics": [
            "Rent Agreement Essentials", "Security Deposit Recovery", "Illegal Rent Hike",
            "Eviction Notice Response", "Landlord Repair Obligations", "Subletting Rules",
            "Model Tenancy Act", "Commercial Lease Disputes", "Rent Control Protection",
            "Notice Period Rights",
        ],
        "authority": "the Model Tenancy Act 2021 and applicable state rent control laws",
        "prompt": "tenancy or rent dispute",
    },
    "Motor & Accident": {
        "topics": [
            "Accident Compensation Claim", "Third-Party Insurance", "Hit and Run Compensation",
            "MACT Tribunal Procedure", "Driving Licence Offences", "Traffic Challan Disputes",
            "Vehicle Insurance Claim", "No-Fault Liability", "FIR after Road Accident",
            "Disability Compensation",
        ],
        "authority": "the Motor Vehicles Act 1988 and Motor Accident Claims Tribunals",
        "prompt": "road accident or motor vehicle claim",
    },
    "RTI & Governance": {
        "topics": [
            "Filing an RTI Application", "First Appeal under RTI", "RTI Fee & Exemptions",
            "Public Information Officer Duties", "RTI for Government Records", "Second Appeal to CIC",
            "RTI Response Timelines", "Grievance Redressal", "Citizen Charter Rights",
            "Whistleblower Protection",
        ],
        "authority": "the Right to Information Act 2005 and Central/State Information Commissions",
        "prompt": "RTI or government transparency matter",
    },
}

ANGLES = [
    ("Overview", "A Complete Overview"),
    ("Step-by-Step Guide", "Step-by-Step Guide"),
    ("Rights & Remedies", "Your Rights and Legal Remedies"),
]

AUTHORS = [
    "NyaySahayak Editorial", "Adv. Priya Menon", "Adv. Rahul Verma",
    "Adv. Ananya Ghosh", "Adv. Imran Sheikh", "Legal Research Desk",
]


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def build_content(topic: str, angle_full: str, category: str, authority: str) -> str:
    intro = (
        f"# {topic}: {angle_full}\n\n"
        f"When you are dealing with a **{topic.lower()}** situation in India, understanding the "
        f"legal framework is the first step toward protecting your interests. This guide, prepared "
        f"by the NyaySahayak legal team, breaks down what the law says under {authority}, and how "
        f"an ordinary citizen can act with confidence.\n"
    )
    what = (
        f"## Understanding {topic}\n\n"
        f"'{topic}' broadly refers to a set of situations governed by {authority}. The exact remedy "
        f"available to you depends on the facts of your case, the jurisdiction, and any documentary "
        f"evidence you can gather. Courts and tribunals in India consistently emphasise that timely "
        f"action and proper documentation significantly improve outcomes.\n"
    )
    steps = (
        "## Practical Steps to Take\n\n"
        "1. **Gather documents** - collect every relevant record, receipt, agreement, or communication.\n"
        "2. **Send a written notice** - a clear legal notice often resolves disputes before litigation.\n"
        "3. **Approach the right forum** - identify the correct authority, tribunal, or court.\n"
        "4. **File your application/complaint** - ensure it is complete, signed, and within limitation.\n"
        "5. **Follow up** - track hearing dates and respond promptly to any queries.\n"
    )
    rights = (
        "## Know Your Rights\n\n"
        f"Under {authority}, you have the right to fair treatment, to be heard, and to seek redressal "
        "without harassment. Eligible persons may also access **free legal aid** through NALSA, the "
        "State Legal Services Authority (SLSA), or the District Legal Services Authority (DLSA).\n"
    )
    mistakes = (
        "## Common Mistakes to Avoid\n\n"
        "- Missing statutory time limits (limitation periods).\n"
        "- Relying on verbal assurances instead of written records.\n"
        "- Filing before the wrong forum, causing delays.\n"
        "- Ignoring a notice or summons.\n"
    )
    outro = (
        "## How NyaySahayak Can Help\n\n"
        f"NyaySahayak can guide you through a **{topic.lower()}** matter, help you understand your "
        "options, connect you with verified lawyers, and even assist in drafting the documents you "
        "need. Start a chat to describe your situation and get a personalised action plan.\n\n"
        "> Disclaimer: This article is for general information and is not a substitute for advice "
        "from a qualified advocate on your specific facts.\n"
    )
    return "\n".join([intro, what, steps, rights, mistakes, outro])


def build_summary(topic: str, angle: str, category: str) -> str:
    return (
        f"{topic} explained for Indian citizens - {angle.lower()} covering the law, the exact steps "
        f"to follow, your rights, and the remedies available. Part of the {category} knowledge base."
    )


def generate_articles(count: int) -> list[dict]:
    articles: list[dict] = []
    base_date = datetime.now(timezone.utc)
    idx = 0
    # 10 categories x 10 topics x 3 angles = 300
    for category, meta in CATEGORIES.items():
        for topic in meta["topics"]:
            for angle, angle_full in ANGLES:
                if len(articles) >= count:
                    break
                title = f"{topic}: {angle_full}"
                slug = slugify(f"{category}-{topic}-{angle}")
                summary = build_summary(topic, angle, category)
                content = build_content(topic, angle_full, category, meta["authority"])
                read_minutes = 4 + (idx % 7)
                published = base_date - timedelta(days=idx, hours=(idx * 7) % 24)
                articles.append(
                    {
                        "slug": slug,
                        "title": title,
                        "category": category,
                        "summary": summary,
                        "content": content,
                        "author": AUTHORS[idx % len(AUTHORS)],
                        "tags": [category, topic, angle],
                        "read_minutes": read_minutes,
                        "hero_image": None,
                        "published_at": published.isoformat(),
                        "embed_text": f"{title}. {summary}",
                    }
                )
                idx += 1
    return articles[:count]


def embed_batch(texts: list[str], url: str, retries: int = 3) -> list[list[float]]:
    del url  # provider is resolved from system_config
    from backend.services.text_embeddings import embed_texts

    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            return embed_texts(texts, task_type="RETRIEVAL_DOCUMENT")
        except Exception as e:  # noqa: BLE001
            last_err = e
            wait = 2 * (attempt + 1)
            print(f"  ! embed batch failed ({e}); retrying in {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"Embedding failed after {retries} attempts: {last_err}")


def upsert_article(article: dict, embedding: list[float] | None) -> None:
    execute_void(
        """
        INSERT INTO public.articles
          (slug, title, category, summary, content, author, tags, read_minutes,
           hero_image, published_at, embedding)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          summary = EXCLUDED.summary,
          content = EXCLUDED.content,
          author = EXCLUDED.author,
          tags = EXCLUDED.tags,
          read_minutes = EXCLUDED.read_minutes,
          hero_image = EXCLUDED.hero_image,
          published_at = EXCLUDED.published_at,
          embedding = EXCLUDED.embedding,
          updated_at = now()
        """,
        (
            article["slug"],
            article["title"],
            article["category"],
            article["summary"],
            article["content"],
            article["author"],
            article["tags"],
            article["read_minutes"],
            article["hero_image"],
            article["published_at"],
            _format_pgvector(embedding) if embedding else None,
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed legal articles with embeddings.")
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--batch", type=int, default=25)
    parser.add_argument("--skip-embeddings", action="store_true", help="Insert without embeddings (fast, no search).")
    args = parser.parse_args()

    if not is_postgres_configured():
        print("ERROR: DATABASE_URL not configured. Set it in .env before seeding.")
        sys.exit(1)

    embed_url = get_embed_texts_url()
    print(f"Embedding endpoint: {embed_url}")

    articles = generate_articles(args.count)
    print(f"Generated {len(articles)} templated articles across {len(CATEGORIES)} categories.")

    embeddings: list[list[float] | None] = [None] * len(articles)
    if not args.skip_embeddings:
        for start in range(0, len(articles), args.batch):
            chunk = articles[start : start + args.batch]
            texts = [a["embed_text"] for a in chunk]
            print(f"Embedding {start + 1}-{start + len(chunk)} / {len(articles)} ...")
            vecs = embed_batch(texts, embed_url)
            for i, v in enumerate(vecs):
                embeddings[start + i] = v

    inserted = 0
    for article, emb in zip(articles, embeddings):
        upsert_article(article, emb)
        inserted += 1
        if inserted % 50 == 0:
            print(f"Upserted {inserted}/{len(articles)} ...")

    print(f"Done. Upserted {inserted} articles.")


if __name__ == "__main__":
    main()

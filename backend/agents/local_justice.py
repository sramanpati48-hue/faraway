"""State-wise grassroots justice forums + small-dispute scoring for Cases suggestions."""
from __future__ import annotations

from typing import Any

# Normalized institution categories (not every row is a Gram Nyayalaya).
FORUM_GRAM_NYAYALAYA = "gram_nyayalaya"
FORUM_NYAYA_PANCHAYAT = "nyaya_panchayat"
FORUM_GRAM_KATCHAHRY = "gram_katchahry"
FORUM_VILLAGE_COURT = "village_court"
FORUM_CUSTOMARY = "customary_court"
FORUM_LOK_ADALAT = "lok_adalat"
FORUM_MEDIATION = "mediation_centre"
FORUM_NARI_ADALAT = "nari_adalat"

FORUM_LABELS = {
    FORUM_GRAM_NYAYALAYA: "Gram Nyayalaya",
    FORUM_NYAYA_PANCHAYAT: "Nyaya Panchayat",
    FORUM_GRAM_KATCHAHRY: "Gram Katchahry",
    FORUM_VILLAGE_COURT: "Village Court",
    FORUM_CUSTOMARY: "Customary / Village Council",
    FORUM_LOK_ADALAT: "Lok Adalat / mediation",
    FORUM_MEDIATION: "Mediation / Legal Services Clinic",
    FORUM_NARI_ADALAT: "Nari Adalat",
}

# (institution_type, local_name, hindi_or_regional, operational_note)
STATE_FORUMS: dict[str, tuple[str, str, str, str]] = {
    "andhra pradesh": (FORUM_LOK_ADALAT, "Gram/Ward mediation & Lok Adalat", "ग्राम/वार्ड मध्यस्थता", "ADR; no statutory Nyaya Panchayat"),
    "arunachal pradesh": (FORUM_CUSTOMARY, "Village Council", "गाँव परिषद", "Traditional/customary dispute settlement"),
    "assam": (FORUM_VILLAGE_COURT, "Gaon Panchayat / Village Court", "गाँव पंचायत", "Local and customary; Nari Adalat pilot"),
    "bihar": (FORUM_GRAM_KATCHAHRY, "Gram Katchahry", "ग्राम कचहरी", "Functioning Sarpanch-headed village court"),
    "chhattisgarh": (FORUM_LOK_ADALAT, "Panchayat mediation / Lok Adalat", "पंचायत मध्यस्थता", "Local mediation and settlement"),
    "goa": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya", "ग्राम न्यायालय", "Statutory grassroots court in notified areas"),
    "gujarat": (FORUM_LOK_ADALAT, "Lok Adalat / mediation", "लोक अदालत", "ADR rather than Nyaya Panchayat"),
    "haryana": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya", "ग्राम न्यायालय", "Statutory rural court in notified areas"),
    "himachal pradesh": (FORUM_MEDIATION, "Panchayat / local mediation", "पंचायत मध्यस्थता", "Minor local settlement"),
    "jharkhand": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / traditional bodies", "ग्राम न्यायालय", "Rural court; tribal institutions in some areas"),
    "karnataka": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Lok Adalat", "ग्राम न्यायालय", "Rural court and ADR"),
    "kerala": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Lok Adalat", "ഗ്രാമ ന്യായാലയം", "Statutory rural court and ADR"),
    "madhya pradesh": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya", "ग्राम न्यायालय", "Large operational Gram Nyayalaya system"),
    "maharashtra": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Lok Adalat", "ग्राम न्यायालय", "Rural court and ADR"),
    "manipur": (FORUM_CUSTOMARY, "Village / tribal customary institution", "ग्राम परिषद", "Customary dispute resolution"),
    "meghalaya": (FORUM_VILLAGE_COURT, "Village Court (ADC)", "Village Court", "Autonomous District Council justice"),
    "mizoram": (FORUM_VILLAGE_COURT, "Village Court / Village Council", "Village Council", "Local and customary justice"),
    "nagaland": (FORUM_CUSTOMARY, "Village / Customary Court", "Village Court", "Traditional village/tribal dispute resolution"),
    "odisha": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Lok Adalat", "ଗ୍ରାମ ନ୍ୟାୟାଳୟ", "Rural court/ADR in notified areas"),
    "punjab": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Gram Panchayat", "ਗ੍ਰਾਮ ਨਿਆਂਇਆਲਾ", "Local dispute resolution"),
    "rajasthan": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya", "ग्राम न्यायालय", "Large operational Gram Nyayalaya network"),
    "sikkim": (FORUM_CUSTOMARY, "Village Panchayat / customary", "गाँव पंचायत", "Local settlement"),
    "tamil nadu": (FORUM_LOK_ADALAT, "Lok Adalat / mediation", "லோக் அதாலத்", "ADR; no current statutory Nyaya Panchayat"),
    "telangana": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya", "గ్రామ న్యాయాలయం", "Notified; check operational status"),
    "tripura": (FORUM_CUSTOMARY, "Village / Tribal Council", "Village Council", "Local/customary dispute resolution"),
    "uttar pradesh": (FORUM_NYAYA_PANCHAYAT, "Nyaya Panchayat / Gram Nyayalaya", "न्याय पंचायत", "Village-level + statutory rural courts"),
    "uttarakhand": (FORUM_NYAYA_PANCHAYAT, "Nyaya Panchayat", "न्याय पंचायत", "Plains Nyaya Panchayat; hill local mechanisms"),
    "west bengal": (FORUM_NYAYA_PANCHAYAT, "Nyaya Panchayat", "ন্যায় পঞ্চায়েত", "Chapter VII, West Bengal Panchayat Act"),
    "delhi": (FORUM_MEDIATION, "DLSA clinic / mediation", "विधिक सेवा क्लिनिक", "Urban legal services rather than Gram Nyayalaya"),
    "jammu and kashmir": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Panchayat ADR", "ग्राम न्यायालय", "Rural justice/ADR; Nari Adalat pilot"),
    "jammu & kashmir": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / Panchayat ADR", "ग्राम न्यायालय", "Rural justice/ADR; Nari Adalat pilot"),
    "ladakh": (FORUM_GRAM_NYAYALAYA, "Gram Nyayalaya / customary", "ग्राम न्यायालय", "Rural/customary dispute resolution"),
    "chandigarh": (FORUM_MEDIATION, "Legal Services / Lok Adalat", "लोक अदालत", "UT legal services"),
    "puducherry": (FORUM_LOK_ADALAT, "Lok Adalat / mediation", "லோக் அதாலத்", "ADR"),
    "andaman and nicobar islands": (FORUM_CUSTOMARY, "Local / tribal council", "Village Council", "Island customary/local settlement"),
    "andaman & nicobar": (FORUM_CUSTOMARY, "Local / tribal council", "Village Council", "Island customary/local settlement"),
    "lakshadweep": (FORUM_CUSTOMARY, "Village / island council", "Village Council", "Local island dispute settlement"),
    "dadra and nagar haveli and daman and diu": (FORUM_LOK_ADALAT, "Lok Adalat / mediation", "लोक अदालत", "ADR"),
    "the dadra and nagar haveli and daman and diu": (FORUM_LOK_ADALAT, "Lok Adalat / mediation", "लोक अदालत", "ADR"),
}

_STATE_ALIASES = {
    "up": "uttar pradesh",
    "u.p.": "uttar pradesh",
    "u.p": "uttar pradesh",
    "mp": "madhya pradesh",
    "m.p.": "madhya pradesh",
    "tn": "tamil nadu",
    "ap": "andhra pradesh",
    "wb": "west bengal",
    "uk": "uttarakhand",
    "ua": "uttarakhand",
    "cg": "chhattisgarh",
    "hp": "himachal pradesh",
    "jk": "jammu and kashmir",
    "j&k": "jammu and kashmir",
    "nct of delhi": "delhi",
    "nct delhi": "delhi",
    "new delhi": "delhi",
    "orissa": "odisha",
    "pondicherry": "puducherry",
    "dnhdd": "dadra and nagar haveli and daman and diu",
    "daman and diu": "dadra and nagar haveli and daman and diu",
    "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
}

_SMALL_KW = (
    "goat", "sheep", "hen", "chicken", "livestock", "cattle", "cow", "buffalo",
    "crop", "harvest", "fence", "boundary", "neighbour", "neighbor", "panchayat",
    "village", "grazing", "irrigation", "water sharing", "tree", "wall", "noise",
    "petty", "stray", "wage", "daily wage", "land dispute", "field", "pond",
    "temple committee", "ration", "bpl", "house tax", "pathway", "right of way",
    "orchard", "mango", "well", "handpump", "encroachment small",
)
_SEVERE_KW = (
    "rape", "sexual", "pocso", "molest", "missing person", "kidnap", "murder",
    "homicide", "dowry death", "acid", "human trafficking", "terror",
    "mlat", "attempt to murder", "grievous", "firearm", "gunshot",
)

_PETTY_THEFT_KW = (
    "goat", "hen", "chicken", "cycle", "bicycle", "utensil", "crop", "petty theft",
    "stolen goat", "stole my goat", "sheep",
)


def normalize_state_name(raw: str | None) -> str:
    text = str(raw or "").strip().lower()
    text = text.replace(".", "").replace(",", " ")
    text = " ".join(text.split())
    if not text or text in {"unknown", "all", "india"}:
        return ""
    return _STATE_ALIASES.get(text, text)


def forum_for_state(state: str | None) -> dict[str, str]:
    key = normalize_state_name(state)
    row = STATE_FORUMS.get(key)
    if not row:
        return {
            "state": state or "",
            "institution_type": FORUM_MEDIATION,
            "institution_name": "Local mediation / Legal Services Clinic",
            "regional_name": "विधिक सेवा",
            "label": FORUM_LABELS[FORUM_MEDIATION],
            "note": "Generic local ADR when the state forum is unknown",
        }
    itype, name, regional, note = row
    return {
        "state": key.title() if key != "delhi" else "Delhi",
        "institution_type": itype,
        "institution_name": name,
        "regional_name": regional,
        "label": FORUM_LABELS.get(itype, name),
        "note": note,
    }


def _blob(report: dict, statement: str, category: str) -> str:
    return " ".join(
        [
            statement or "",
            str(report.get("incident_type") or ""),
            str(report.get("summary") or ""),
            str(report.get("user_verbatim") or ""),
            category or "",
        ]
    ).lower()


def is_small_local_dispute(
    report: dict | None,
    *,
    category: str = "",
    statement: str = "",
    criticality: str = "",
) -> bool:
    """Petty village/neighbour matters suitable for grassroots forums — not severe crime."""
    data = report if isinstance(report, dict) else {}
    blob = _blob(data, statement, category)
    if any(k in blob for k in _SEVERE_KW):
        return False
    if data.get("is_complex_mlat"):
        return False
    crit = (criticality or str(data.get("criticality") or "")).lower()
    if "high" in crit:
        # Still allow explicit petty livestock theft called out by the product
        if not any(k in blob for k in _PETTY_THEFT_KW):
            return False
    if data.get("cognizable") and any(k in blob for k in ("assault", "missing", "kidnap", "robbery", "dacoity")):
        return False
    fraud_under = data.get("fraud_under_10k")
    if fraud_under is False and any(k in blob for k in ("fraud", "scam", "cyber")):
        return False
    if any(k in blob for k in _SMALL_KW):
        return True
    if "small matter" in crit or crit.startswith("low"):
        return True
    if str(data.get("risk_level") or "").lower() == "low" and not data.get("cognizable"):
        return True
    return False


def profile_from_guide_row(row: dict[str, Any], forum: dict[str, str] | None = None) -> dict[str, Any]:
    forum = forum or {}
    gid = row.get("id") or row.get("uid")
    return {
        "uid": str(gid or ""),
        "id": str(gid or ""),
        "name": row.get("name") or "Nodal Guide",
        "location": row.get("location") or forum.get("state") or "",
        "state": row.get("state") or forum.get("state") or "",
        "occupation": row.get("occupation") or forum.get("institution_name") or "Nodal Guide",
        "bio": row.get("bio") or "",
        "avatar": row.get("avatar") or "",
        "contact_number": row.get("contact_number") or "",
        "email": row.get("email") or "",
        "availability": row.get("availability") or "Available",
        "rating": float(row.get("rating") or 4.5),
        "cases_resolved": int(row.get("cases_resolved") or 0),
        "languages": row.get("languages") or ["Hindi", "English"],
        "institution_type": row.get("institution_type") or forum.get("institution_type") or "",
        "institution_name": row.get("institution_name") or forum.get("institution_name") or "",
        "regional_name": row.get("regional_name") or forum.get("regional_name") or "",
        "forum_label": forum.get("label") or FORUM_LABELS.get(str(row.get("institution_type") or ""), "Local justice"),
        "forum_note": forum.get("note") or "",
    }

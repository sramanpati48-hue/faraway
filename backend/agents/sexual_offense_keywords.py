"""
Shared sexual-offense keyword detection across 22 scheduled Indian languages.
"""

from __future__ import annotations


# Structured by language so the mapping is maintainable and auditable.
SEXUAL_OFFENSE_KEYWORDS_BY_LANGUAGE: dict[str, list[str]] = {
    "assamese": [
        "ধর্ষণ",
        "যৌন নিৰ্যাতন",
        "শ্লীলতাহানি",
    ],
    "bengali": [
        "ধর্ষণ",
        "যৌন নির্যাতন",
        "শ্লীলতাহানি",
    ],
    "bodo": [
        "बलात्कार",
        "यौन उत्पीड़न",
    ],
    "dogri": [
        "बलात्कार",
        "यौन उत्पीड़न",
        "छेड़छाड़",
    ],
    "english": [
        "rape",
        "sexual assault",
        "sexual abuse",
        "sexual harassment",
        "sexual harrassment",
        "sexually harassed",
        "sexually harrassed",
        "sexually harass",
        "sexually harrass",
        "molest",
        "molestation",
        "groping",
        "groped",
        "forced sex",
        "child sexual abuse",
        "outrage modesty",
        "eve teasing",
        "stalking",
        "sexually harassed",
    ],
    "gujarati": [
        "બળાત્કાર",
        "લૈંગિક શોષણ",
        "લૈંગિક ઉત્પીડન",
    ],
    "hindi": [
        "बलात्कार",
        "बालतकार",
        "बलत्कार",
        "बलात्कर",
        "छेड़छाड़",
        "यौन उत्पीड़न",
        "यौन शोषण",
        "यौन हिंसा",
    ],
    "kannada": [
        "ಬಲಾತ್ಕಾರ",
        "ಲೈಂಗಿಕ ದೌರ್ಜನ್ಯ",
        "ಲೈಂಗಿಕ ಕಿರುಕುಳ",
    ],
    "kashmiri": [
        "جنسی زیادتی",
        "عصمت دری",
    ],
    "konkani": [
        "बलात्कार",
        "लैंगिक छळ",
        "balatkar",
    ],
    "maithili": [
        "बलात्कार",
        "यौन उत्पीड़न",
    ],
    "malayalam": [
        "ബലാത്സംഗം",
        "ലൈംഗികാതിക്രമം",
        "ലൈംഗിക പീഡനം",
    ],
    "manipuri": [
        "ধর্ষণ",
        "যৌন নির্যাতন",
        "sexual assault",
    ],
    "marathi": [
        "बलात्कार",
        "लैंगिक अत्याचार",
        "छेडछाड",
    ],
    "nepali": [
        "बलात्कार",
        "यौन दुर्व्यवहार",
        "यौन हिंसा",
    ],
    "odia": [
        "ଧର୍ଷଣ",
        "ଯୌନ ଉତ୍ପୀଡ଼ନ",
        "ଯୌନ ନିର୍ଯାତନା",
    ],
    "punjabi": [
        "ਬਲਾਤਕਾਰ",
        "ਜਿਨਸੀ ਉਤਪੀੜਨ",
        "ਛੇੜਛਾੜ",
    ],
    "sanskrit": [
        "बलात्कार",
        "यौनउत्पीडन",
    ],
    "santali": [
        "balatkar",
        "sexual assault",
    ],
    "sindhi": [
        "زيادتي",
        "زنا بالجبر",
        "جنسی زیادتی",
    ],
    "tamil": [
        "பாலியல் பலாத்காரம்",
        "பாலியல் வன்கொடுமை",
        "கற்பழிப்பு",
        "பாலியல் தொல்லை",
    ],
    "telugu": [
        "బలాత్కారం",
        "లైంగిక వేధింపు",
        "లైంగిక దాడి",
    ],
    "urdu": [
        "ریپ",
        "جنسی زیادتی",
        "عصمت دری",
    ],
}


def has_sexual_offense_signal(*texts: str) -> bool:
    """
    Return True if any known sexual-offense keyword appears in input texts.
    """
    combined = " ".join([str(t or "") for t in texts]).casefold()
    if not combined.strip():
        return False

    for keywords in SEXUAL_OFFENSE_KEYWORDS_BY_LANGUAGE.values():
        for keyword in keywords:
            if keyword and keyword.casefold() in combined:
                return True
    return False

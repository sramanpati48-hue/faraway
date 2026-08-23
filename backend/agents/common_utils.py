from geopy.geocoders import Nominatim
import ssl
import certifi
from backend.database.vector_db import VectorDB

# Initialize VectorDB once
vector_db = VectorDB()

# Fallback when admin config is unavailable (also default for chat_agent).
LEGAL_RAG_TOP_K = 10


def extract_search_query(message_content) -> str:
    """Normalizes a LangChain message content (str or multimodal list) into plain text."""
    if isinstance(message_content, str):
        return message_content
    if isinstance(message_content, list):
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                return item.get("text", "") or ""
    return ""


def format_legal_context(context_rows) -> str:
    """Formats retrieved legal_documents rows into a prompt-friendly context block."""
    context_docs = []
    for row in context_rows or []:
        if not isinstance(row, dict):
            continue
        header = " | ".join(
            [
                str(row.get("act_name") or "Unknown Act"),
                str(row.get("section_number") or "No Section"),
                str(row.get("title") or "Untitled"),
            ]
        )
        snippet = row.get("content") or row.get("summary") or ""
        metadata = {
            "id": row.get("id"),
            "category": row.get("category"),
            "authority": row.get("authority"),
            "legal_status": row.get("legal_status"),
            "source_url": row.get("source_url"),
            "pdf_page_reference": row.get("pdf_page_reference"),
            "similarity": row.get("similarity"),
            "keywords": row.get("keywords"),
            "related_acts": row.get("related_acts"),
        }
        context_docs.append(f"{header}\n{snippet}\nMetadata: {metadata}")
    return "\n\n".join(context_docs)


def retrieve_legal_context(
    query,
    top_k: int | None = None,
    filter_category: str | None = None,
    *,
    graph_id: str = "chat_agent",
    min_similarity: float | None = None,
):
    """Runs the RAG pipeline against public.legal_documents (Indian law vector store).

    Uses admin ``rag_retrieval`` thresholds for ``graph_id`` when ``top_k`` /
    ``min_similarity`` are not passed explicitly.

    Returns a tuple of (formatted_context_text, raw_context_rows) so callers can both
    inject the text into a system prompt and persist the rows into graph state.
    """
    from backend.services.rag_retrieval_config import (
        filter_rows_by_similarity,
        get_rag_retrieval_settings,
    )

    settings = get_rag_retrieval_settings(graph_id)
    resolved_top_k = int(top_k) if top_k is not None else int(settings["top_k"])
    resolved_min_sim = (
        float(min_similarity)
        if min_similarity is not None
        else float(settings["min_similarity"])
    )

    search_query = extract_search_query(query)
    context_rows = []
    if search_query and isinstance(search_query, str):
        context_rows = vector_db.search_legal_documents(
            search_query, top_k=resolved_top_k, filter_category=filter_category
        )
        context_rows = filter_rows_by_similarity(context_rows, resolved_min_sim)
    context_text = format_legal_context(context_rows)
    print(
        f"   Context Retrieved: {len(context_rows)} legal chunks "
        f"(graph={graph_id}, top_k={resolved_top_k}, min_sim={resolved_min_sim})"
    )
    return context_text, context_rows

def _nominatim():
    ctx = ssl.create_default_context(cafile=certifi.where())
    return Nominatim(user_agent="nyaysahayak_common_utils", ssl_context=ctx)


def location_is_usable(location_data) -> bool:
    """True when GPS coords or a non-empty city/state are present."""
    if not isinstance(location_data, dict) or not location_data:
        return False
    lat, lon = location_data.get("lat"), location_data.get("lon")
    if lat is not None and lon is not None:
        try:
            float(lat)
            float(lon)
            return True
        except (TypeError, ValueError):
            pass
    city = str(location_data.get("city") or "").strip().lower()
    state = str(location_data.get("state") or "").strip().lower()
    bad = {"", "unknown", "none", "null", "n/a"}
    return city not in bad or state not in bad | {"all"}


def geocode_area_name(area_text: str) -> dict:
    """
    Forward-geocode a free-text area (e.g. 'Rohini, Delhi') into a location dict.
    Returns {city, state, lat?, lon?, source, area}.
    """
    text = (area_text or "").strip()
    result = {
        "city": "Unknown",
        "state": "Unknown",
        "area": text,
        "source": "user_area",
    }
    if not text:
        return result
    try:
        geolocator = _nominatim()
        query = text if "india" in text.lower() else f"{text}, India"
        location = geolocator.geocode(query, language="en", addressdetails=True, timeout=10)
        if not location:
            # Fallback: treat last comma segment as state, rest as city
            parts = [p.strip() for p in text.split(",") if p.strip()]
            if len(parts) >= 2:
                result["city"] = parts[0]
                result["state"] = parts[-1]
            else:
                result["city"] = text
                result["state"] = text
            print(f"📍 Area parsed without geocode: {result['city']}, {result['state']}")
            return result
        address = (location.raw or {}).get("address") or {}
        city = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("suburb")
            or address.get("county")
            or text.split(",")[0].strip()
        )
        state_name = address.get("state") or address.get("state_district") or "Unknown"
        result.update(
            {
                "city": city,
                "state": state_name,
                "lat": float(location.latitude),
                "lon": float(location.longitude),
                "source": "user_area",
                "area": text,
            }
        )
        print(f"📍 Geocoded area '{text}' → {city}, {state_name}")
    except Exception as e:
        print(f"❌ Forward geocoding error: {e}")
        parts = [p.strip() for p in text.split(",") if p.strip()]
        if len(parts) >= 2:
            result["city"] = parts[0]
            result["state"] = parts[-1]
        else:
            result["city"] = text
    return result


def normalize_location_dict(location_data) -> dict:
    """
    Normalize GPS or city/state payloads into {city, state, lat?, lon?, source}.
    """
    if not isinstance(location_data, dict) or not location_data:
        return {}
    if location_data.get("city") and location_data.get("state"):
        city = str(location_data.get("city") or "").strip()
        state_name = str(location_data.get("state") or "").strip()
        if city.lower() not in {"unknown", ""} or state_name.lower() not in {"unknown", "", "all"}:
            out = {
                "city": city or "Unknown",
                "state": state_name or "Unknown",
                "source": location_data.get("source") or ("gps" if location_data.get("lat") is not None else "user_area"),
            }
            if location_data.get("lat") is not None:
                out["lat"] = location_data.get("lat")
            if location_data.get("lon") is not None:
                out["lon"] = location_data.get("lon")
            if location_data.get("area"):
                out["area"] = location_data.get("area")
            return out

    lat, lon = location_data.get("lat"), location_data.get("lon")
    if lat is not None and lon is not None:
        city, state_name, _ = get_user_location_context({"lat": lat, "lon": lon})
        return {
            "city": city,
            "state": state_name,
            "lat": lat,
            "lon": lon,
            "source": location_data.get("source") or "gps",
        }

    area = str(location_data.get("area") or location_data.get("city") or "").strip()
    if area:
        return geocode_area_name(area)
    return {}


def get_user_location_context(location_data):
    """
    Resolve City and State from lat/lon (reverse) or city/state fields.
    Returns:
        tuple: (city, state, location_string)
    """
    city = "Unknown"
    state_name = "Unknown"
    loc_str = "Location not provided"

    if not location_data or not isinstance(location_data, dict):
        return city, state_name, loc_str

    # Prefer already-known city/state (from supervisor area ask or prior normalize)
    existing_city = str(location_data.get("city") or "").strip()
    existing_state = str(location_data.get("state") or "").strip()
    if existing_city and existing_city.lower() != "unknown":
        city = existing_city
    if existing_state and existing_state.lower() not in {"unknown", "all"}:
        state_name = existing_state
    if city != "Unknown" or state_name != "Unknown":
        loc_str = f"{city}, {state_name}" if city != "Unknown" else state_name
        print(f"Using provided Location: {loc_str}")
        return city, state_name, loc_str

    lat, lon = location_data.get("lat"), location_data.get("lon")
    if lat is None or lon is None:
        return city, state_name, loc_str

    try:
        geolocator = _nominatim()
        location = geolocator.reverse(f"{lat}, {lon}", language="en")
        address = location.raw.get("address", {}) if location else {}
        city = address.get("city", address.get("town", address.get("village", "Unknown")))
        state_name = address.get("state", "Unknown")
        loc_str = f"{city}, {state_name}"
        print(f"Detected Location: {loc_str}")
    except Exception as e:
        print(f"Geocoding error: {e}")

    return city, state_name, loc_str

def get_local_scam_summary(city):
    """
    Searches VectorDB for scams in the given city and returns a summary string.
    """
    if city == "Unknown":
        return "No location data available to check for local scams."

    local_scams = vector_db.search(query="recent scams", namespaces="scams", filter={"city": city})
    
    if local_scams:
        print(f"   Context Retrieved: {len(local_scams)} local scam reports.")
        return "\n".join([f"- {s}" for s in local_scams])
    else:
        print(f"   Context Retrieved: 0 local scam reports.")
        return "No specific recent scams reported in this area."


def active_policy_prompt_block(scope: str) -> str:
    """Admin-authored policy rules for an agent scope, ready to append to a system prompt.

    Returns an empty string when no policy is active so callers can concatenate freely.
    The lookup is TTL-cached inside policy_studio, so this is safe on hot paths.
    """
    try:
        from backend.services.policy_studio import get_active_policy_text

        text = (get_active_policy_text(scope) or "").strip()
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] policy prompt block unavailable for {scope}: {exc}")
        return ""
    if not text:
        return ""
    return (
        "\n\nADMIN POLICY OVERRIDES (authoritative — follow these over the general rules above):\n"
        f"{text[:4000]}"
    )

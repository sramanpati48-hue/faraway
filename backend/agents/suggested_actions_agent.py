"""Build next-action chips, official links, local-forum routing, and NyaySahayak offer."""
from __future__ import annotations

from typing import Any

from langgraph.graph import END

from backend.agents.local_justice import (
    forum_for_state,
    is_small_local_dispute,
    profile_from_guide_row,
)
from backend.agents.response_sanitize import strip_classification_block
import backend.database.supabase_db as supabase_db


def _links_from_routing(routing: dict | None) -> list[dict[str, str]]:
    if not isinstance(routing, dict):
        return []
    raw = routing.get("links") or {}
    if not isinstance(raw, dict):
        return []
    out: list[dict[str, str]] = []
    labels = {
        "nalsa": "NALSA",
        "legal_aid": "Legal aid",
        "state_legal_aid": "State legal services",
        "cybercrime": "cybercrime.gov.in",
        "ncrb": "NCRB",
        "consumer": "Consumer commission",
        "ombudsman": "Banking ombudsman",
        "ncw": "NCW",
        "childline": "Childline 1098",
    }
    for key, url in raw.items():
        if not url or not isinstance(url, str):
            continue
        if not url.startswith("http"):
            continue
        out.append({"label": labels.get(str(key), str(key).replace("_", " ").title()), "url": url})
    return out


def _location_state(state: dict) -> str:
    loc = state.get("location") if isinstance(state.get("location"), dict) else {}
    details = state.get("user_details") if isinstance(state.get("user_details"), dict) else {}
    report = state.get("structured_report") if isinstance(state.get("structured_report"), dict) else {}
    nested = report.get("location") if isinstance(report.get("location"), dict) else {}
    nested_details = details.get("location") if isinstance(details.get("location"), dict) else {}
    return str(
        loc.get("state")
        or details.get("state")
        or nested_details.get("state")
        or nested.get("state")
        or ""
    )


def _blob(*parts: Any) -> str:
    return " ".join(str(p or "") for p in parts).lower()


def _lawyer_category_label(incident: str, category: str, report: dict) -> str:
    """Human label + search key aligned with lawyer practice-area mapping."""
    text = _blob(incident, category, report.get("summary"), report.get("user_verbatim"))
    if any(k in text for k in ("sexual", "harassment", "posh", "rape")):
        return "Criminal Law"
    if any(
        k in text
        for k in (
            "criminal",
            "missing",
            "kidnap",
            "assault",
            "theft",
            "robbery",
            "fir",
            "homicide",
            "murder",
            "cognizable",
        )
    ) or category in {"criminal", "crime"}:
        return "Criminal Law"
    if any(k in text for k in ("cyber", "upi", "otp", "phishing", "scam", "fraud")):
        return "Cyber & Financial Fraud"
    if any(k in text for k in ("domestic", "dowry", "divorce", "family", "matrimonial", "maintenance")):
        return "Family & Matrimonial"
    if any(k in text for k in ("property", "land", "tenant", "possession", "title")):
        return "Property & Land"
    if any(k in text for k in ("employment", "wage", "labour", "labor")):
        return "Business & Employment"
    if any(k in text for k in ("claim", "compensation", "insurance", "motor")):
        return "Claims & Compensation"
    if any(k in text for k in ("civil", "consumer", "contract", "cheque", "loan", "bank")) or category in {
        "civil",
        "consumer",
        "finance",
    }:
        return "Civil & Consumer Disputes"
    return "General Practice"


def _assess_lawyer_need(
    *,
    asked_lawyer: bool,
    lawyer_needed_flag: bool,
    is_sexual_offense: bool,
    small_local: bool,
    incident: str,
    category: str,
    report: dict,
    cognizable: bool,
    mlat: bool,
    fraud_under: Any,
    criticality: str,
    statement: str,
) -> tuple[bool, str, str]:
    """
    Decide carefully whether the user should be offered lawyer browsing.

    Returns (needed, category_label, short_reason).
    Sexual-offense support chips already include Connect Lawyer — skip duplicate here.
    Petty local disputes stay with nodal guides, not advocates.
    """
    category_label = _lawyer_category_label(incident, category, report)
    crit = (criticality or "").lower()
    high = "high" in crit
    medium = "medium" in crit or "moderate" in crit
    text = _blob(incident, category, statement, report.get("summary"), report.get("user_verbatim"))
    amount = str(report.get("amount_involved") or "")

    if asked_lawyer:
        return True, category_label, "You asked to connect with a lawyer."

    if is_sexual_offense:
        # Dedicated sexual-offense agent already offers Connect Lawyer / Female Lawyer.
        return False, category_label, ""

    if small_local:
        return False, category_label, ""

    if lawyer_needed_flag:
        return True, category_label, "This matter likely needs professional legal representation."

    if mlat:
        return True, category_label, "Cross-border / complex aspects usually need an advocate."

    # --- Criminal ---
    criminalish = category_label == "Criminal Law" or any(
        k in text
        for k in (
            "criminal",
            "fir",
            "police",
            "assault",
            "missing",
            "kidnap",
            "robbery",
            "homicide",
            "murder",
            "bail",
            "arrest",
            "cognizable",
        )
    )
    if criminalish:
        serious = any(
            k in text
            for k in (
                "assault",
                "missing",
                "kidnap",
                "robbery",
                "homicide",
                "murder",
                "bail",
                "arrest",
                "grievous",
                "weapon",
            )
        )
        # Petty low-stakes theft/info-only: police + self-help may be enough.
        petty_theft = ("theft" in text or "stolen" in text) and not serious and not high and not cognizable
        if petty_theft and not medium:
            return False, category_label, ""
        if cognizable or serious or high or medium:
            return (
                True,
                "Criminal Law",
                "Criminal matters of this seriousness benefit from an advocate for FIR, police, and court steps.",
            )
        return False, category_label, ""

    # --- Cyber / financial fraud ---
    if category_label == "Cyber & Financial Fraud" or any(k in text for k in ("fraud", "scam", "upi", "phishing")):
        if fraud_under is False or high or mlat:
            return (
                True,
                "Cyber & Financial Fraud",
                "Larger or complex fraud cases usually need a lawyer for recovery and complaints.",
            )
        # Small UPI loss: portal + bank first; lawyer optional.
        return False, category_label, ""

    # --- Family ---
    if category_label == "Family & Matrimonial" or any(
        k in text for k in ("divorce", "custody", "maintenance", "dowry", "domestic violence")
    ):
        return (
            True,
            "Family & Matrimonial",
            "Family and matrimonial disputes usually need a lawyer for filings and hearings.",
        )

    # --- Civil / property / consumer ---
    civilish = category_label in {
        "Civil & Consumer Disputes",
        "Property & Land",
        "Business & Employment",
        "Claims & Compensation",
    } or any(
        k in text
        for k in ("civil", "consumer", "contract", "property", "land", "tenant", "injunction", "notice")
    )
    if civilish:
        high_stakes = high or any(
            k in text
            for k in (
                "injunction",
                "eviction",
                "title",
                "possession",
                "specific performance",
                "writ",
                "appeal",
                "summons",
                "suit",
            )
        )
        money_signal = bool(amount) and any(ch.isdigit() for ch in amount)
        if high_stakes or money_signal or medium:
            return (
                True,
                category_label if category_label != "General Practice" else "Civil & Consumer Disputes",
                "Civil disputes with filings, notices, or meaningful stakes usually need a lawyer.",
            )
        # Pure rights-education / low-stakes consumer query — self-help forums first.
        return False, category_label, ""

    if high and cognizable:
        return True, category_label, "High-risk cognizable matters benefit from counsel."

    return False, category_label, ""


def suggested_actions_agent(state: dict) -> dict:
    print("\nSUGGESTED ACTIONS AGENT")
    report = state.get("structured_report") if isinstance(state.get("structured_report"), dict) else {}
    incident = str(report.get("incident_type") or "").lower()
    routing = state.get("routing_recommendation") if isinstance(state.get("routing_recommendation"), dict) else {}
    actions = list(state.get("suggested_actions") or [])
    links = list(state.get("suggested_links") or [])
    links.extend(_links_from_routing(routing))

    lawyer_needed = bool(state.get("lawyer_needed"))
    asked_lawyer = bool(state.get("explicit_lawyer_request"))
    intervention = bool(state.get("intervention_required"))
    cognizable = bool(report.get("cognizable"))
    mlat = bool(report.get("is_complex_mlat"))
    fraud_under = report.get("fraud_under_10k")
    criticality = str(report.get("criticality") or "")
    category = str(state.get("case_category") or report.get("case_category") or "").lower()
    statement = str(state.get("user_statement") or "")
    is_sexual_offense = category in {"sexual_offence", "sexual_offense"} or bool(
        state.get("high_sensitivity")
    ) or bool(state.get("sexual_offense_intake_flow"))

    # Drop finance/cyber chips that may have leaked from an earlier high-criticality pass.
    if is_sexual_offense:
        def _keep_so_action(a: Any) -> bool:
            if not isinstance(a, dict):
                return False
            label = str(a.get("label") or "").lower()
            payload = str(a.get("payload") or "").lower()
            action = str(a.get("action") or "").lower()
            if "bank" in label or payload == "1930":
                return False
            if action in {"show_helpline", "show_guide", "open_scam_heatmap"} and (
                "cyber" in label or "scam" in label or "complaint guide" in label
            ):
                return False
            if action == "open_scam_heatmap":
                return False
            return True

        actions = [a for a in actions if _keep_so_action(a)]
        links = [
            lk
            for lk in links
            if isinstance(lk, dict)
            and "cybercrime" not in str(lk.get("url") or "").lower()
            and "1930" not in str(lk.get("label") or "").lower()
            and "ombudsman" not in str(lk.get("label") or "").lower()
            and "rbi" not in str(lk.get("label") or "").lower()
        ]

    loc = state.get("location") if isinstance(state.get("location"), dict) else {}
    state_name = _location_state(state)
    city = str(loc.get("city") or "")
    forum = forum_for_state(state_name)
    matched_trends = list(state.get("matched_scam_trends") or report.get("matched_scam_trends") or [])
    similarity_note = str(state.get("scam_similarity_note") or report.get("scam_similarity") or "")
    small_local = (not is_sexual_offense) and is_small_local_dispute(
        report,
        category=category,
        statement=statement,
        criticality=criticality,
    )

    nodal_profiles: list[dict[str, Any]] = []
    if small_local:
        try:
            lat = loc.get("lat") or loc.get("latitude")
            lon = loc.get("lon") or loc.get("longitude")
            rows = []
            if hasattr(supabase_db, "get_nodal_guides_for_area"):
                rows = supabase_db.get_nodal_guides_for_area(state_name, lat, lon) or []
            elif lat is not None and lon is not None:
                one = supabase_db.get_nodal_guide_by_location(float(lat), float(lon))
                rows = [one] if one else []
            nodal_profiles = [profile_from_guide_row(r, forum) for r in rows if r]
        except Exception as exc:  # noqa: BLE001
            print(f"   ⚠️ nodal guide lookup skipped: {exc}")

    if (not is_sexual_offense) and matched_trends:
        area = city or forum.get("state") or "your area"
        actions.insert(
            0,
            {
                "label": f"Similar scams already happening in {area}",
                "action": "open_scam_heatmap",
                "payload": "open_scam_heatmap",
            },
        )
        links.append({"label": "Scam heatmap", "url": "/scam-heatmap"})
    if (not is_sexual_offense) and (
        "cyber" in incident or "fraud" in incident or "scam" in incident or matched_trends
    ):
        links.append({"label": "National Cybercrime Portal", "url": "https://www.cybercrime.gov.in"})
        links.append({"label": "Cybercrime helpline 1930", "url": "https://www.cybercrime.gov.in"})
    if "missing" in incident or "criminal" in incident or "theft" in incident:
        links.append({"label": "Find your police station (NCRB)", "url": "https://digitalpolice.gov.in"})
    if is_sexual_offense or "domestic" in incident or "dowry" in incident:
        links.append({"label": "NCW", "url": "https://ncw.nic.in"})
        links.append({"label": "Women helpline 181", "url": "https://www.ncw.nic.in"})
    if (not is_sexual_offense) and (
        "finance" in incident or "cheque" in incident or "loan" in incident or "bank" in incident
    ):
        links.append({"label": "RBI CMS / Ombudsman", "url": "https://cms.rbi.org.in"})

    seen: set[str] = set()
    deduped_links: list[dict[str, str]] = []
    for item in links:
        url = str(item.get("url") or "")
        if not url or url in seen:
            continue
        seen.add(url)
        deduped_links.append({"label": str(item.get("label") or url), "url": url})

    recommend_lawyer, lawyer_category, lawyer_reason = _assess_lawyer_need(
        asked_lawyer=asked_lawyer,
        lawyer_needed_flag=lawyer_needed,
        is_sexual_offense=is_sexual_offense,
        small_local=small_local,
        incident=incident,
        category=category,
        report=report,
        cognizable=cognizable,
        mlat=mlat,
        fraud_under=fraud_under,
        criticality=criticality,
        statement=statement,
    )

    has_lawyer_chip = any(
        isinstance(a, dict)
        and (
            str(a.get("node") or "") == "lawyer_forwarder"
            or str(a.get("action") or "") in {"browse_lawyers", "show_lawyers"}
        )
        for a in actions
    )
    if recommend_lawyer and not has_lawyer_chip and not small_local:
        short = lawyer_category.replace(" & ", "/").replace(" Disputes", "")
        actions.append(
            {
                "label": f"Browse {short} lawyers",
                "action": "browse_lawyers",
                "node": "lawyer_forwarder",
                "payload": f"Please recommend lawyers specializing in {lawyer_category} for my case",
                "category": lawyer_category,
                "reason": lawyer_reason,
            }
        )

    if small_local:
        actions = [
            a
            for a in actions
            if isinstance(a, dict)
            and str(a.get("node") or "") not in {"lawyer_forwarder", "sahayak"}
            and str(a.get("action") or "") not in {"browse_lawyers", "show_lawyers"}
        ]
        forum_label = forum.get("label") or "local justice body"
        actions.insert(
            0,
            {
                "label": f"Connect to {forum_label} nodal guide in your area",
                "action": "open_nodal_guide",
                "node": "nodal_guide",
                "payload": "open_nodal_guide",
            },
        )

    has_satisfied = any(str(a.get("action") or "") == "satisfied" for a in actions if isinstance(a, dict))
    if not has_satisfied:
        actions.append(
            {
                "label": "I’m satisfied with this guidance",
                "action": "satisfied",
                "payload": "satisfied",
            }
        )
        actions.append(
            {
                "label": "Book NyaySahayak on-ground help (₹49)",
                "action": "book_nyaysahayak",
                "payload": "book_nyaysahayak",
            }
        )

    incoming = str(state.get("next_step") or END)
    next_step: Any = END
    intervention_out = intervention
    if small_local:
        next_step = END
        intervention_out = False
    elif intervention or incoming == "legal_moderator":
        next_step = "legal_moderator"
    elif asked_lawyer:
        next_step = "lawyer_forwarder"

    wrap = ""
    if matched_trends:
        titles = ", ".join(
            str(t.get("title") or t.get("scam_type") or "scam")
            for t in matched_trends[:3]
            if isinstance(t, dict)
        )
        wrap += (
            similarity_note
            or (
                f"Similarity found to scams already happening in **{city or forum.get('state') or 'your area'}**: "
                f"{titles}."
            )
        )
        wrap += " Open Suggestions to view the heatmap and treat this as a known local pattern.\n\n"
    wrap += (
        f"This looks like a **local / petty dispute**. In {forum.get('state') or 'your area'}, "
        f"the usual grassroots forum is **{forum.get('institution_name')}** ({forum.get('regional_name')}). "
        "Open the nodal guide in Suggestions to view details and forward your case summary.\n\n"
        if small_local
        else ""
    )
    if recommend_lawyer and lawyer_reason and not small_local:
        wrap += (
            f"Based on your case, a **{lawyer_category}** lawyer may help. "
            f"{lawyer_reason} Open **Suggestions → Browse lawyers** to review matched advocates "
            "for this category.\n\n"
        )
    wrap += (
        "Are you satisfied with this guidance, or do you need **on-ground assistance** from a "
        "**NyaySahayak** (Nyay Guide) in your area to walk you through the next steps in person? "
        "On-ground help is **₹49**, paid securely, and books an appointment in this chat."
    )

    delta = strip_classification_block(state.get("user_facing_delta") or "")
    final = strip_classification_block(state.get("final_response") or delta)

    print(
        f"   local_dispute={small_local} forum={forum.get('institution_type')} "
        f"state={forum.get('state')} guides={len(nodal_profiles)} "
        f"lawyer_needed={recommend_lawyer} category={lawyer_category}"
    )

    # This node is rule-based, so the active policy rides along in state for the
    # LLM nodes downstream (and for run inspection) rather than steering a prompt here.
    from backend.agents.common_utils import active_policy_prompt_block

    policy_block = active_policy_prompt_block("chat_agent.suggested_actions")

    return {
        "active_policy_notes": policy_block,
        "suggested_actions": actions,
        "suggested_links": deduped_links,
        "lawyer_needed": recommend_lawyer and not small_local,
        "lawyer_category": lawyer_category if recommend_lawyer else None,
        "lawyer_need_reason": lawyer_reason if recommend_lawyer else None,
        "user_facing_delta": wrap,
        "final_response": final,
        "show_suggestions_rail": True,
        "phase": "complete" if not state.get("pending_questions") else state.get("phase") or "complete",
        "next_step": next_step,
        "intervention_required": intervention_out,
        "local_forum": forum,
        "small_local_dispute": small_local,
        "nodal_guide_profiles": nodal_profiles,
        "show_nodal_guide_suggest": bool(small_local and nodal_profiles),
        "ask_nyaysahayak": True,
        "matched_scam_trends": matched_trends,
        "scam_similarity_note": similarity_note,
    }

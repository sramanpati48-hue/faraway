import re

with open("backend/routes/local_justice_routes.py", "r", encoding="utf-8") as f:
    code = f.read()

new_endpoint = '''
from pydantic import BaseModel, Field

class NyayGuideRequest(BaseModel):
    case_id: str
    session_id: str
    confirmed: bool
    assistance_type: str
    location_consent: bool
    privacy_consent: bool
    idempotency_key: str

@router.post("/api/nyayguide/requests")
async def create_nyayguide_request(body: NyayGuideRequest, user=Depends(get_current_user)):
    """
    Final explicit citizen confirmation for physical NyayGuide dispatch.
    """
    user_id = _uid(user)
    
    # 1. Check authorized case ownership
    bundle = _case_bundle(body.session_id, body.case_id)
    if bundle["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized case ownership")
        
    # 2. Check confirmed=true
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation required")
        
    # 3. Valid assistance type
    valid_types = ["document_support", "office_navigation", "complaint_filing_support", "digital_assistance", "other"]
    if body.assistance_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid assistance type")
        
    # 4. Consents
    if not body.location_consent or not body.privacy_consent:
        raise HTTPException(status_code=400, detail="Location and privacy consent required for on-ground assistance")
        
    # 5. Idempotency Key check (simulated with basic DB or just accepted for now)
    if not body.idempotency_key:
        raise HTTPException(status_code=400, detail="idempotency_key is required")
        
    # Proceed to dispatch / create request
    # This represents the start of call-centre screening / searching
    
    request_id = f"ng_req_{body.idempotency_key[:8]}"
    return {
        "status": "success",
        "request_id": request_id,
        "workflow_state": "call_centre_screening",
        "message": "NyayGuide request confirmed and entered screening phase."
    }
'''

if "/api/nyayguide/requests" not in code:
    code += "\n" + new_endpoint
    with open("backend/routes/local_justice_routes.py", "w", encoding="utf-8") as f:
        f.write(code)
    print("Added /api/nyayguide/requests")
else:
    print("Endpoint already exists")

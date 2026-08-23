import os
from dotenv import load_dotenv

load_dotenv()

try:
    import firebase_admin
    from firebase_admin import credentials, firestore, auth
except ImportError:  # optional when JWT/Postgres auth is primary
    firebase_admin = None
    credentials = None
    firestore = None
    auth = None

# Build the credential dictionary from env vars
cert_dict = {
    "type": os.getenv("FIREBASE_ADMIN_TYPE"),
    "project_id": os.getenv("FIREBASE_ADMIN_PROJECT_ID"),
    "private_key_id": os.getenv("FIREBASE_ADMIN_PRIVATE_KEY_ID"),
    "private_key": os.getenv("FIREBASE_ADMIN_PRIVATE_KEY", "").replace('\\n', '\n'),
    "client_email": os.getenv("FIREBASE_ADMIN_CLIENT_EMAIL"),
    "client_id": os.getenv("FIREBASE_ADMIN_CLIENT_ID"),
    "auth_uri": os.getenv("FIREBASE_ADMIN_AUTH_URI"),
    "token_uri": os.getenv("FIREBASE_ADMIN_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("FIREBASE_ADMIN_AUTH_PROVIDER_CERT_URL"),
    "client_x509_cert_url": os.getenv("FIREBASE_ADMIN_CLIENT_CERT_URL"),
    "universe_domain": os.getenv("FIREBASE_ADMIN_UNIVERSE_DOMAIN", "googleapis.com")
}

_db = None
_init_attempted = False
_firebase_disabled = False
_disable_logged = False


def _log_once_disable(reason: str):
    global _disable_logged
    if not _disable_logged:
        print(f"⚠️ Firebase Admin disabled: {reason}")
        _disable_logged = True


def _disable_firebase(reason: str):
    global _firebase_disabled, _db
    _firebase_disabled = True
    _db = None
    _log_once_disable(reason)


def _is_invalid_jwt_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "invalid_grant" in message or "invalid jwt signature" in message


def _credentials_present() -> bool:
    required_keys = [
        "type", "project_id", "private_key", "client_email", "token_uri"
    ]
    return all(bool((cert_dict.get(k) or "").strip()) for k in required_keys)


def _ensure_db():
    global _db, _init_attempted
    if _firebase_disabled:
        return None
    if _db is not None:
        return _db
    if _init_attempted:
        return None

    _init_attempted = True
    if firebase_admin is None or credentials is None or firestore is None:
        _disable_firebase("firebase_admin package not installed")
        return None
    try:
        if not firebase_admin._apps:
            from backend.paths import REPO_ROOT

            # Prefer env-based credentials (Cloud Run / production). Local file is optional.
            json_path = REPO_ROOT / "scheme-guide-ai-firebase-adminsdk-ielsr-b2d0361494.json"
            if _credentials_present():
                cred = credentials.Certificate(cert_dict)
            elif json_path.exists():
                cred = credentials.Certificate(str(json_path))
            else:
                _disable_firebase("Missing Firebase Admin credentials; using Supabase-only path")
                return None
            firebase_admin.initialize_app(cred)

        _db = firestore.client()
        return _db
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature in Firebase service-account credentials")
        else:
            _disable_firebase(f"Initialization failed ({e})")
        return None


def is_available() -> bool:
    return _ensure_db() is not None

# --- Custom Database Methods ---

def create_user_record(uid: str, email: str, role: str = "victim"):
    """
    Creates a user record in the Firestore database.
    Roles: 'victim', 'lawyer', 'moderator'
    """
    db = _ensure_db()
    if not db:
        return False
    data = {"email": email, "role": role}
    try:
        db.collection("users").document(uid).set(data, merge=True)
        return True
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during create_user_record")
        print(f"Error creating user record: {e}")
        return False

def get_user_role(uid: str):
    """
    Fetches the user's role from the Firestore database.
    """
    db = _ensure_db()
    if not db:
        return None
    try:
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            return doc.to_dict().get("role")
        return None
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during get_user_role")
        print(f"Error identifying role for uid {uid}: {e}")
        return None

def get_chat_history(uid: str):
    """
    Fetches chat history for the user from Firestore.
    """
    db = _ensure_db()
    if not db:
        return []
    try:
        # Fetch the latest session from chatHistory
        docs = db.collection("users").document(uid).collection("chatHistory").order_by("timestamp", direction=firestore.Query.DESCENDING).limit(1).stream()
        for doc in docs:
            return doc.to_dict().get("session", [])
        return []
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during get_chat_history")
        print(f"Error fetching chat history: {e}")
        return []

def save_chat_history(uid: str, session_data: list):
    """
    Saves or syncs local chat history to the user's document in Firestore.
    """
    db = _ensure_db()
    if not db:
        return False
    try:
        from google.cloud import firestore
        # Save chat with a timestamp for better retrieval
        db.collection("users").document(uid).collection("chatHistory").add({
            "session": session_data,
            "timestamp": firestore.SERVER_TIMESTAMP
        })
        return True
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during save_chat_history")
        print(f"Error saving chat history: {e}")
        return False

def save_user_case(uid: str, case_id: str, structured_report: dict, session_data: list):
    """
    Saves a completed case and its associated chat session into the user's `cases` collection.
    """
    db = _ensure_db()
    if not db:
        return False
    try:
        from google.cloud import firestore
        data = {
            "case_id": case_id,
            "structured_report": structured_report,
            "session": session_data,
            "timestamp": firestore.SERVER_TIMESTAMP
        }
        db.collection("users").document(uid).collection("cases").document(case_id).set(data)
        return True
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during save_user_case")
        print(f"Error saving user case: {e}")
        return False

def get_user_cases(uid: str):
    """
    Retrieves all structured cases for a given user.
    """
    db = _ensure_db()
    if not db:
        return []
    try:
        from google.cloud import firestore
        docs = db.collection("users").document(uid).collection("cases").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
        cases = []
        for doc in docs:
            case_data = doc.to_dict()
            if "timestamp" in case_data and case_data["timestamp"]:
                try:
                    case_data["timestamp"] = case_data["timestamp"].isoformat()
                except Exception:
                    case_data["timestamp"] = str(case_data["timestamp"])
            cases.append(case_data)
        return cases
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during get_user_cases")
        print(f"Error fetching user cases: {e}")
        return []

def search_lawyers():
    """
    Fetches users with the 'lawyer' role from Firestore.
    """
    db = _ensure_db()
    if not db:
        return []
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = db.collection("users").where(filter=FieldFilter("role", "==", "lawyer")).stream()
        lawyers = []
        for doc in docs:
            data = doc.to_dict()
            lawyers.append({
                "uid": doc.id, 
                "email": data.get("email"),
                "professional_details": data.get("professional_details")
            })
        return lawyers
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during search_lawyers")
        print(f"Error searching lawyers: {e}")
        return []

def create_intervention_case(user_id: str, structured_report: dict, collection_name: str = "moderator"):
    """
    Creates a new intervention case in Firestore for moderators to review.
    Routes to `collection_name`, which is typically 'cases' or 'mlat'.
    """
    db = _ensure_db()
    if not db:
        return None
    try:
        from google.cloud import firestore
        doc_ref = db.collection(collection_name).document()
        doc_ref.set({
            "user_id": user_id,
            "structured_report": structured_report,
            "status": "pending",
            "created_at": firestore.SERVER_TIMESTAMP,
            "resolved_at": None,
            "moderator_response": None,
            "moderator_options": [],
            "collection": collection_name # Store its own collection name for easy reference
        })
        return doc_ref.id
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during create_intervention_case")
        print(f"Error creating intervention case in {collection_name}: {e}")
        return None

def forward_case_to_lawyer(user_id: str, user_name: str, structured_report: dict):
    """
    Forwards a case summary to the lawyer dashboard by saving it in the lawyer_cases collection.
    """
    db = _ensure_db()
    if not db:
        return None
    try:
        from google.cloud import firestore
        doc_ref = db.collection("lawyer_cases").document()
        doc_ref.set({
            "user_id": user_id,
            "user_name": user_name,
            "structured_report": structured_report,
            "status": "pending",
            "created_at": firestore.SERVER_TIMESTAMP,
            "resolved_at": None,
            "lawyer_id": None
        })
        return doc_ref.id
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during forward_case_to_lawyer")
        print(f"Error forwarding case to lawyer: {e}")
        return None

def resolve_intervention_case(case_id: str, moderator_text: str, options: list, collection_name: str = "moderator"):
    """
    Resolves a pending intervention case by adding the moderator's text and options.
    """
    db = _ensure_db()
    if not db:
        return False
    try:
        from google.cloud import firestore
        doc_ref = db.collection(collection_name).document(case_id)
        doc_ref.update({
            "status": "reviewed",
            "resolved_at": firestore.SERVER_TIMESTAMP,
            "moderator_response": moderator_text,
            "moderator_options": options
        })
        return True
    except Exception as e:
        if _is_invalid_jwt_error(e):
            _disable_firebase("Invalid JWT signature during resolve_intervention_case")
        print(f"Error resolving intervention case in {collection_name}: {e}")
        return False

"""SCR Supreme Court judgment fetcher for the RAG funnel.

Admin keyword search against scr.sci.gov.in with manual CAPTCHA entry.
Matching judgment PDFs are downloaded (skipping known case_path values),
recorded in scr_downloaded_cases, and auto-fed into rag_funnel sessions.
"""
from __future__ import annotations

import base64
import json
import re
import threading
import time
import urllib3
import uuid
from typing import Any, Callable, Optional
from urllib.parse import parse_qs

import requests
from bs4 import BeautifulSoup

from backend.database.postgres_pool import execute, execute_one, execute_void, is_postgres_configured
from backend.services import rag_funnel

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT_URL = "https://scr.sci.gov.in"
SEARCH_URL = f"{ROOT_URL}/scrsearch/?p=pdf_search/home/"
CAPTCHA_URL = f"{ROOT_URL}/scrsearch/vendor/securimage/securimage_show.php"
CAPTCHA_TOKEN_URL = f"{ROOT_URL}/scrsearch/?p=pdf_search/checkCaptcha"
PDF_LINK_URL = f"{ROOT_URL}/scrsearch/?p=pdf_search/openpdfcaptcha"
PDF_LINK_URL_WO_CAPTCHA = f"{ROOT_URL}/scrsearch/?p=pdf_search/openpdf"

SESSION_COOKIE = "SCR_SESSID"
ALT_SESSION_COOKIE = "PHPSESSID"
ECOURTS_TOKEN_COOKIE = "JSESSION"

# After this many PDF downloads the portal typically requires a fresh CAPTCHA.
NO_CAPTCHA_BATCH_SIZE = 25
PAGE_SIZE = 50
DEFAULT_MAX_RESULTS = 100
# Serialize RAG ingest (1 PDF at a time) + pause between PDFs to avoid
# free-tier LLM concurrency limits (e.g. Nvidia ResourceExhausted).
INGEST_COOLDOWN_SECONDS = 8.0

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
)

DEFAULT_SEARCH_PAYLOAD = (
    "&sEcho=1&iColumns=2&sColumns=,&iDisplayStart=0&iDisplayLength=10"
    "&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true"
    "&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true"
    "&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1"
    "&search_txt1=&search_txt2=&search_txt3=&search_txt4=&search_txt5="
    "&pet_res=&state_code=&state_code_li=&dist_code=null&case_no=&case_year="
    "&from_date=&to_date=&judge_name=&reg_year=&fulltext_case_type=&act="
    "&judge_txt=&act_txt=&section_txt=&judge_val=&act_val=&year_val=&judge_arr=&flag="
    "&disp_nature=&search_opt=PHRASE&date_val=ALL&fcourt_type=3"
    "&citation_yr=&citation_vol=&citation_supl=&citation_page=&case_no1=&case_year1="
    "&pet_res1=&fulltext_case_type1=&citation_keyword=&sel_lang=&proximity="
    "&neu_cit_year=&neu_no=&ncn=&bool_opt=&sort_flg=&ajax_req=true&app_token="
)

PDF_LINK_PAYLOAD = (
    "val=0&lang_flg=undefined&path=&citation_year=&fcourt_type=3"
    "&nc_display=&ajax_req=true"
)

OPEN_PDF_RE = re.compile(
    r"javascript:open_pdf\('(.*?)','(.*?)','(.*?)','(.*?)'\)"
)


class ScrScraperError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# SCR HTTP client
# ---------------------------------------------------------------------------


class SCRClient:
    """Session-aware client for scr.sci.gov.in pdf_search endpoints."""

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.verify = False
        self.session_id: Optional[str] = None
        self.ecourts_token: Optional[str] = None
        self.app_token: str = ""

    def init_session(self) -> None:
        res = self.session.get(
            f"{ROOT_URL}/scrsearch/",
            headers={"User-Agent": USER_AGENT},
            timeout=30,
        )
        res.raise_for_status()
        self.session_id = res.cookies.get(
            SESSION_COOKIE, res.cookies.get(ALT_SESSION_COOKIE)
        )
        self.ecourts_token = res.cookies.get(ECOURTS_TOKEN_COOKIE)
        if not self.ecourts_token:
            raise ScrScraperError(
                "Failed to get SCR session token. The portal may be blocking this IP."
            )
        # app_token sometimes appears in the HTML; keep empty if absent.
        match = re.search(r'name=["\']app_token["\']\s+value=["\']([^"\']*)["\']', res.text)
        if match:
            self.app_token = match.group(1) or ""

    def _cookie_header(self) -> str:
        return (
            f"{ECOURTS_TOKEN_COOKIE}={self.ecourts_token}; "
            f"{SESSION_COOKIE}={self.session_id}"
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Cookie": self._cookie_header(),
            "Origin": ROOT_URL,
            "Pragma": "no-cache",
            "Referer": f"{ROOT_URL}/",
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
        }

    def _update_session_from_response(self, response: requests.Response) -> None:
        new_id = response.cookies.get(
            SESSION_COOKIE, response.cookies.get(ALT_SESSION_COOKIE)
        )
        if new_id:
            self.session_id = new_id
        try:
            data = response.json()
            if isinstance(data, dict) and data.get("app_token"):
                self.app_token = str(data["app_token"])
        except Exception:  # noqa: BLE001
            pass

    def get_captcha_png(self) -> bytes:
        res = self.session.get(
            CAPTCHA_URL,
            headers={"Cookie": self._cookie_header(), "User-Agent": USER_AGENT},
            timeout=30,
        )
        res.raise_for_status()
        if not res.content or len(res.content) < 50:
            raise ScrScraperError("Empty CAPTCHA image from SCR portal")
        return res.content

    def get_captcha_b64(self) -> str:
        return base64.b64encode(self.get_captcha_png()).decode("ascii")

    def submit_captcha(self, captcha: str, search_opt: str = "PHRASE") -> dict[str, Any]:
        payload = {
            "captcha": (captcha or "").strip(),
            "search_opt": search_opt or "PHRASE",
            "ajax_req": "true",
        }
        if self.app_token:
            payload["app_token"] = self.app_token
        res = self.session.post(
            CAPTCHA_TOKEN_URL,
            headers=self._headers(),
            data=payload,
            timeout=30,
        )
        self._update_session_from_response(res)
        try:
            data = res.json()
        except Exception:  # noqa: BLE001
            data = {}
        if not isinstance(data, dict):
            data = {}
        # Portal returns various shapes; treat explicit invalid as failure.
        msg = str(data.get("message") or data.get("errormsg") or "").lower()
        if "invalid" in msg and "captcha" in msg:
            raise ScrScraperError("Invalid CAPTCHA")
        if data.get("session_expire") == "Y":
            raise ScrScraperError("SCR session expired; start a new search")
        return data

    def _default_search_payload(self) -> dict[str, str]:
        parsed = parse_qs(DEFAULT_SEARCH_PAYLOAD.lstrip("&"), keep_blank_values=True)
        return {k: (v[0] if v else "") for k, v in parsed.items()}

    def search(
        self,
        *,
        keyword: str,
        search_opt: str = "PHRASE",
        from_date: str = "",
        to_date: str = "",
        start: int = 0,
        length: int = PAGE_SIZE,
        sel_lang: str = "",
    ) -> dict[str, Any]:
        payload = self._default_search_payload()
        payload["sEcho"] = "1"
        payload["iDisplayStart"] = str(max(0, start))
        payload["iDisplayLength"] = str(max(1, min(1000, length)))
        payload["search_opt"] = search_opt or "PHRASE"
        payload["fcourt_type"] = "3"
        payload["ajax_req"] = "true"
        payload["from_date"] = from_date or ""
        payload["to_date"] = to_date or ""
        payload["sel_lang"] = sel_lang or ""
        # Keyword field: the public UI uses `text=`; AJAX also accepts search_txt1.
        kw = (keyword or "").strip()
        payload["text"] = kw
        payload["search_txt1"] = kw
        if self.app_token:
            payload["app_token"] = self.app_token

        res = self._request_api("POST", SEARCH_URL, payload)
        try:
            data = res.json()
        except Exception as exc:  # noqa: BLE001
            raise ScrScraperError(f"SCR search returned non-JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ScrScraperError("SCR search response was not an object")
        if data.get("session_expire") == "Y":
            raise ScrScraperError("SCR session expired during search")
        if data.get("errormsg"):
            raise ScrScraperError(str(data["errormsg"]))
        return data

    def _default_pdf_payload(self) -> dict[str, str]:
        parsed = parse_qs(PDF_LINK_PAYLOAD, keep_blank_values=True)
        return {k: (v[0] if v else "") for k, v in parsed.items()}

    def download_pdf(self, pdf_info: dict[str, Any], lang_code: str = "") -> Optional[bytes]:
        payload = self._default_pdf_payload()
        payload["val"] = str(pdf_info.get("val") or "0")
        payload["path"] = str(pdf_info.get("path") or "")
        payload["citation_year"] = str(pdf_info.get("citation_year") or "")
        payload["nc_display"] = str(pdf_info.get("nc_display") or "")
        payload["fcourt_type"] = "3"
        payload["ajax_req"] = "true"
        payload["lang_flg"] = lang_code or ""
        if self.app_token:
            payload["app_token"] = self.app_token

        res = self._request_api("POST", PDF_LINK_URL, payload)
        try:
            data = res.json()
        except Exception:  # noqa: BLE001
            data = {}
        if not isinstance(data, dict) or "outputfile" not in data:
            return None
        pdf_path = data["outputfile"]
        pdf_res = self.session.get(
            ROOT_URL + pdf_path,
            headers=self._headers(),
            timeout=60,
            allow_redirects=True,
        )
        content = pdf_res.content or b""
        # Empty or tiny "404" stub (~315 bytes) means missing PDF.
        if len(content) == 0 or len(content) == 315:
            return None
        if not content.startswith(b"%PDF"):
            # Some responses wrap the PDF; still accept if large enough.
            if len(content) < 500:
                return None
        return content

    def _request_api(
        self, method: str, url: str, payload: dict[str, Any], retries: int = 3
    ) -> requests.Response:
        last_exc: Optional[Exception] = None
        for attempt in range(retries):
            try:
                res = self.session.request(
                    method,
                    url,
                    headers=self._headers(),
                    data=payload,
                    timeout=60,
                )
                self._update_session_from_response(res)
                try:
                    data = res.json()
                except Exception:  # noqa: BLE001
                    data = {}

                if isinstance(data, dict):
                    # Per-PDF captcha challenge: return as-is for caller; worker pauses.
                    if (
                        "filename" in data
                        and isinstance(data.get("filename"), str)
                        and "securimage_show" in data["filename"]
                    ):
                        # Attempt openpdf without captcha first if already validated.
                        if url == PDF_LINK_URL:
                            res2 = self.session.post(
                                PDF_LINK_URL_WO_CAPTCHA,
                                headers=self._headers(),
                                data=payload,
                                timeout=60,
                            )
                            self._update_session_from_response(res2)
                            return res2
                        raise ScrScraperError("PDF download requires a new CAPTCHA")
                    if data.get("session_expire") == "Y":
                        raise ScrScraperError("SCR session expired")
                    if data.get("errormsg"):
                        raise ScrScraperError(str(data["errormsg"]))
                if (res.text or "").strip() == "" and attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                return res
            except ScrScraperError:
                raise
            except requests.RequestException as exc:
                last_exc = exc
                time.sleep(1.5 * (attempt + 1))
        raise ScrScraperError(f"SCR request failed after retries: {last_exc}")


# ---------------------------------------------------------------------------
# Result parsing
# ---------------------------------------------------------------------------


def extract_pdf_info_from_onclick(onclick: str) -> Optional[dict[str, str]]:
    match = OPEN_PDF_RE.search(onclick or "")
    if not match:
        return None
    path = match.group(3).split("#")[0]
    return {
        "val": match.group(1),
        "citation_year": match.group(2),
        "path": path,
        "nc_display": match.group(4),
    }


def parse_result_row(row: list[Any]) -> Optional[dict[str, Any]]:
    if not row or len(row) < 2:
        return None
    html = row[1] if isinstance(row[1], str) else str(row[1] or "")
    soup = BeautifulSoup(html, "html.parser")
    button = soup.find("button", {"role": "link"})
    if not button or not button.get("onclick"):
        # Fallback: any element with open_pdf in onclick.
        button = soup.find(attrs={"onclick": re.compile(r"open_pdf")})
    if not button or not button.get("onclick"):
        return None
    pdf_info = extract_pdf_info_from_onclick(button["onclick"])
    if not pdf_info:
        return None

    select_el = soup.find("select", {"name": "language"})
    if select_el:
        language_codes = [
            (opt.get("value") or "") for opt in select_el.find_all("option")
        ]
    else:
        language_codes = [""]

    title = ""
    # Prefer first visible text block as a title hint.
    text = soup.get_text(" ", strip=True)
    if text:
        title = text[:240]

    return {
        **pdf_info,
        "language_codes": language_codes,
        "title": title,
        "raw_html": html,
    }


def parse_search_results(res_dict: dict[str, Any]) -> list[dict[str, Any]]:
    report = res_dict.get("reportrow") or {}
    aa_data = report.get("aaData") if isinstance(report, dict) else None
    if not isinstance(aa_data, list):
        return []
    out: list[dict[str, Any]] = []
    for row in aa_data:
        if not isinstance(row, list):
            continue
        parsed = parse_result_row(row)
        if parsed:
            out.append(parsed)
    return out


# ---------------------------------------------------------------------------
# Dedup persistence
# ---------------------------------------------------------------------------


def case_exists(case_path: str) -> bool:
    if not is_postgres_configured() or not case_path:
        return False
    row = execute_one(
        "SELECT 1 AS ok FROM public.scr_downloaded_cases WHERE case_path = %s LIMIT 1",
        (case_path,),
    )
    return bool(row)


def get_ingested_case_prior(case_path: str) -> Optional[dict[str, Any]]:
    """Return prior ingest info when this case_path was already downloaded/ingested."""
    if not is_postgres_configured() or not case_path:
        return None
    row = execute_one(
        """
        SELECT c.case_path, c.neutral_citation, c.title, c.keyword, c.keywords,
               c.status, c.rag_session_id, c.scr_fetch_session_id, c.downloaded_at,
               f.keyword AS prior_session_keyword,
               r.document_name AS prior_document_name,
               r.status AS prior_rag_status
        FROM public.scr_downloaded_cases c
        LEFT JOIN public.scr_fetch_sessions f ON f.id = c.scr_fetch_session_id
        LEFT JOIN public.rag_ingest_sessions r ON r.id = c.rag_session_id
        WHERE c.case_path = %s
        LIMIT 1
        """,
        (case_path,),
    )
    if not row:
        return None
    status = str(row.get("status") or "")
    if status != "downloaded" and not row.get("rag_session_id"):
        return None
    out = _serialize_case(row)
    out["prior_session_keyword"] = row.get("prior_session_keyword") or row.get("keyword")
    out["prior_document_name"] = row.get("prior_document_name")
    out["prior_rag_status"] = row.get("prior_rag_status")
    return out


def record_downloaded_case(
    *,
    case_path: str,
    neutral_citation: Optional[str],
    citation_year: Optional[str],
    title: Optional[str],
    keyword: str,
    language_codes: Optional[list[str]],
    source_pdf_url: Optional[str],
    rag_session_id: Optional[str],
    created_by: Optional[str],
    status: str = "downloaded",
    scr_fetch_session_id: Optional[str] = None,
) -> dict[str, Any]:
    row = execute_one(
        """
        INSERT INTO public.scr_downloaded_cases
          (case_path, neutral_citation, citation_year, title, keyword, keywords,
           language_codes, source_pdf_url, rag_session_id, status, created_by,
           scr_fetch_session_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (case_path) DO UPDATE SET
          keywords = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(
                COALESCE(public.scr_downloaded_cases.keywords, ARRAY[]::text[])
                || ARRAY[EXCLUDED.keyword]
              )
            )
          ),
          title = COALESCE(EXCLUDED.title, public.scr_downloaded_cases.title),
          neutral_citation = COALESCE(EXCLUDED.neutral_citation, public.scr_downloaded_cases.neutral_citation),
          -- Prefer the newest successful ingest (supports explicit re-ingest).
          source_pdf_url = COALESCE(EXCLUDED.source_pdf_url, public.scr_downloaded_cases.source_pdf_url),
          rag_session_id = COALESCE(EXCLUDED.rag_session_id, public.scr_downloaded_cases.rag_session_id),
          scr_fetch_session_id = COALESCE(
            EXCLUDED.scr_fetch_session_id, public.scr_downloaded_cases.scr_fetch_session_id
          ),
          -- Never downgrade a successful download to skipped_duplicate.
          status = CASE
            WHEN EXCLUDED.status = 'downloaded' THEN 'downloaded'
            WHEN public.scr_downloaded_cases.status = 'downloaded' THEN public.scr_downloaded_cases.status
            ELSE EXCLUDED.status
          END
        RETURNING *
        """,
        (
            case_path,
            neutral_citation,
            citation_year,
            title,
            keyword,
            [keyword] if keyword else None,
            language_codes,
            source_pdf_url,
            rag_session_id,
            status,
            created_by,
            scr_fetch_session_id,
        ),
    )
    return _serialize_case(row) if row else {}


def list_cases(keyword: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    if not is_postgres_configured():
        return []
    limit = max(1, min(500, limit))
    if keyword and keyword.strip():
        rows = execute(
            """
            SELECT * FROM public.scr_downloaded_cases
            WHERE keyword ILIKE %s
               OR %s = ANY(keywords)
               OR neutral_citation ILIKE %s
               OR case_path ILIKE %s
            ORDER BY downloaded_at DESC
            LIMIT %s
            """,
            (
                f"%{keyword.strip()}%",
                keyword.strip(),
                f"%{keyword.strip()}%",
                f"%{keyword.strip()}%",
                limit,
            ),
        )
    else:
        rows = execute(
            """
            SELECT * FROM public.scr_downloaded_cases
            ORDER BY downloaded_at DESC
            LIMIT %s
            """,
            (limit,),
        )
    return [_serialize_case(r) for r in rows]


def _serialize_case(row: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not row:
        return {}
    out = dict(row)
    if out.get("downloaded_at") is not None and hasattr(out["downloaded_at"], "isoformat"):
        out["downloaded_at"] = out["downloaded_at"].isoformat()
    if out.get("rag_session_id") is not None:
        out["rag_session_id"] = str(out["rag_session_id"])
    if out.get("scr_fetch_session_id") is not None:
        out["scr_fetch_session_id"] = str(out["scr_fetch_session_id"])
    if out.get("id") is not None:
        out["id"] = str(out["id"])
    return out


# ---------------------------------------------------------------------------
# Persisted SCR fetch sessions + in-memory live-run registry
# ---------------------------------------------------------------------------

_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()

_PERSIST_KEYS = (
    "status",
    "found",
    "downloaded",
    "skipped_duplicates",
    "failed_downloads",
    "remaining",
    "message",
    "error",
)


def _serialize_fetch_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    if out.get("id") is not None:
        out["id"] = str(out["id"])
        out["run_id"] = out["id"]
    return out


def _insert_fetch_session(
    *,
    run_id: str,
    keyword: str,
    search_opt: str,
    from_date: str,
    to_date: str,
    max_results: int,
    language: str,
    config: dict[str, Any],
    created_by: Optional[str],
    status: str,
    message: Optional[str],
) -> None:
    execute_void(
        """
        INSERT INTO public.scr_fetch_sessions
          (id, created_by, keyword, search_opt, from_date, to_date, max_results,
           language, config, status, message)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
        """,
        (
            run_id,
            created_by,
            keyword,
            search_opt,
            from_date or None,
            to_date or None,
            max_results,
            language or None,
            json.dumps(config, default=str),
            status,
            message,
        ),
    )


def _persist_fetch_fields(run_id: str, fields: dict[str, Any]) -> None:
    sets: list[str] = []
    params: list[Any] = []
    for key in _PERSIST_KEYS:
        if key not in fields:
            continue
        sets.append(f"{key} = %s")
        params.append(fields[key])
    if not sets:
        return
    sets.append("updated_at = now()")
    params.append(run_id)
    try:
        execute_void(
            f"UPDATE public.scr_fetch_sessions SET {', '.join(sets)} WHERE id = %s",
            tuple(params),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ scr_scraper persist failed ({run_id}): {exc}")


def _run_get(run_id: str) -> Optional[dict[str, Any]]:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        return run


def _run_update(run_id: str, fields: dict[str, Any]) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if run:
            run.update(fields)
            run["updated_at"] = time.time()
    persist = {k: fields[k] for k in _PERSIST_KEYS if k in fields}
    if persist:
        _persist_fetch_fields(run_id, persist)


def _serialize_run(run: dict[str, Any]) -> dict[str, Any]:
    funnel = run.get("funnel_config") if isinstance(run.get("funnel_config"), dict) else {}
    return {
        "run_id": run.get("run_id"),
        "id": run.get("run_id"),
        "status": run.get("status"),
        "keyword": run.get("keyword"),
        "search_opt": run.get("search_opt"),
        "from_date": run.get("from_date"),
        "to_date": run.get("to_date"),
        "max_results": run.get("max_results"),
        "language": run.get("language"),
        "found": run.get("found", 0),
        "downloaded": run.get("downloaded", 0),
        "skipped_duplicates": run.get("skipped_duplicates", 0),
        "failed_downloads": run.get("failed_downloads", 0),
        "remaining": run.get("remaining", 0),
        "created_sessions": list(run.get("created_sessions") or []),
        "captcha_image": run.get("captcha_image"),
        "error": run.get("error"),
        "message": run.get("message"),
        "created_at": run.get("created_at"),
        "updated_at": run.get("updated_at"),
        "provider": funnel.get("provider"),
        "model": funnel.get("model"),
        "paused_session_id": run.get("paused_session_id"),
        "pending_duplicate": run.get("pending_duplicate"),
    }


def list_fetch_sessions(
    *,
    limit: int = 25,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[str] = None,
) -> dict[str, Any]:
    if not is_postgres_configured():
        return {"sessions": [], "total": 0, "limit": limit, "offset": offset}
    limit = max(1, min(100, limit))
    offset = max(0, offset)
    where: list[str] = []
    params: list[Any] = []
    if q and q.strip():
        where.append("(keyword ILIKE %s OR COALESCE(message, '') ILIKE %s OR COALESCE(error, '') ILIKE %s)")
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    if status and status.strip():
        where.append("status = %s")
        params.append(status.strip().lower())
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    total_row = execute_one(
        f"SELECT COUNT(*)::int AS total FROM public.scr_fetch_sessions {where_sql}",
        tuple(params),
    )
    rows = execute(
        f"""
        SELECT f.id, f.created_at, f.updated_at, f.created_by, f.keyword, f.search_opt,
               f.from_date, f.to_date, f.max_results, f.language, f.status,
               f.found, f.downloaded, f.skipped_duplicates, f.failed_downloads,
               f.remaining, f.message, f.error,
               (
                 SELECT COUNT(*)::int FROM public.rag_ingest_sessions r
                 WHERE r.scr_fetch_session_id = f.id
               ) AS pdf_count
        FROM public.scr_fetch_sessions f
        {where_sql}
        ORDER BY f.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    sessions = []
    for r in rows:
        s = _serialize_fetch_row(r)
        s["pdf_count"] = int(r.get("pdf_count") or 0)
        sessions.append(s)
    return {
        "sessions": sessions,
        "total": int((total_row or {}).get("total") or 0),
        "limit": limit,
        "offset": offset,
    }


def get_fetch_session(fetch_id: str, *, include_pdfs: bool = True) -> dict[str, Any]:
    if not is_postgres_configured():
        raise ScrScraperError("DATABASE_URL not configured")
    row = execute_one(
        "SELECT * FROM public.scr_fetch_sessions WHERE id = %s",
        (fetch_id,),
    )
    if not row:
        raise ScrScraperError("SCR fetch session not found")
    out = _serialize_fetch_row(row)
    # Merge live in-memory captcha / progress when this process owns the run.
    live = _run_get(fetch_id)
    if live:
        out["captcha_image"] = live.get("captcha_image")
        out["status"] = live.get("status") or out.get("status")
        out["message"] = live.get("message") or out.get("message")
        out["found"] = live.get("found", out.get("found"))
        out["downloaded"] = live.get("downloaded", out.get("downloaded"))
        out["skipped_duplicates"] = live.get(
            "skipped_duplicates", out.get("skipped_duplicates")
        )
        out["failed_downloads"] = live.get("failed_downloads", out.get("failed_downloads"))
        out["remaining"] = live.get("remaining", out.get("remaining"))
        out["error"] = live.get("error") if live.get("error") is not None else out.get("error")
        out["created_sessions"] = list(live.get("created_sessions") or [])
        out["paused_session_id"] = live.get("paused_session_id")
        out["pending_duplicate"] = live.get("pending_duplicate")
        funnel = live.get("funnel_config") if isinstance(live.get("funnel_config"), dict) else {}
        if funnel:
            out["provider"] = funnel.get("provider")
            out["model"] = funnel.get("model")
    else:
        cfg = out.get("config") if isinstance(out.get("config"), dict) else {}
        out["provider"] = cfg.get("provider")
        out["model"] = cfg.get("model")
    if include_pdfs:
        pdfs = execute(
            """
            SELECT id, created_at, updated_at, document_name, act_name, source_filename,
                   source_pdf_url, status, total_pages, processed_pages, chunk_count,
                   promoted_count, error, source_kind, scr_fetch_session_id
            FROM public.rag_ingest_sessions
            WHERE scr_fetch_session_id = %s
            ORDER BY created_at ASC
            """,
            (fetch_id,),
        )
        out["pdfs"] = [rag_funnel.serialize_session(p) for p in pdfs]
        # Chunk approval summary across the fetch.
        stats = execute_one(
            """
            SELECT
              COUNT(*) FILTER (WHERE c.status NOT IN ('rejected', 'promoted'))::int AS reviewable,
              COUNT(*) FILTER (WHERE c.status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE c.status = 'promoted')::int AS promoted,
              COUNT(*)::int AS total_chunks
            FROM public.rag_ingest_chunks c
            JOIN public.rag_ingest_sessions s ON s.id = c.session_id
            WHERE s.scr_fetch_session_id = %s
            """,
            (fetch_id,),
        )
        out["chunk_stats"] = dict(stats or {})
    return out


def _resolve_judgment_funnel_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Funnel config for SCR judgments: whole PDF -> one summarized chunk."""
    overrides = {
        k: cfg[k]
        for k in (
            "provider",
            "model",
            "summary_target_length",
            "quality_sample_count",
            "document_name",
            "act_name",
            "category",
            "authority",
        )
        if cfg.get(k) is not None
    }
    # Judgments are ingested as a single information-rich chunk, never page by page.
    overrides["ingest_mode"] = "summary"
    overrides.setdefault("category", "Supreme Court judgment")
    overrides.setdefault("authority", "Supreme Court of India")
    overrides.setdefault("act_name", "Supreme Court of India")
    overrides.setdefault("source_type", "scr_judgment_pdf")
    return rag_funnel.resolve_run_config(overrides)


def create_run(
    *,
    keyword: str,
    config: Optional[dict[str, Any]] = None,
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    if not is_postgres_configured():
        raise ScrScraperError("DATABASE_URL not configured")
    kw = (keyword or "").strip()
    if not kw:
        raise ScrScraperError("keyword is required")

    cfg = config or {}
    search_opt = str(cfg.get("search_opt") or "PHRASE").upper()
    if search_opt not in ("PHRASE", "AND", "OR"):
        search_opt = "PHRASE"
    max_results = int(cfg.get("max_results") or DEFAULT_MAX_RESULTS)
    max_results = max(1, min(500, max_results))
    from_date = str(cfg.get("from_date") or "").strip()
    to_date = str(cfg.get("to_date") or "").strip()
    language = str(cfg.get("language") or "").strip()  # "" = all / English default
    upload_to_cloudinary = bool(cfg.get("upload_to_cloudinary"))

    run_config = _resolve_judgment_funnel_config(cfg)

    client = SCRClient()
    try:
        client.init_session()
        captcha_b64 = client.get_captcha_b64()
    except ScrScraperError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ScrScraperError(f"Failed to init SCR session: {exc}") from exc

    run_id = str(uuid.uuid4())
    persist_config = {
        **run_config,
        "upload_to_cloudinary": upload_to_cloudinary,
        "search_opt": search_opt,
        "from_date": from_date,
        "to_date": to_date,
        "max_results": max_results,
        "language": language,
    }
    message = "Enter the CAPTCHA to start the search."
    _insert_fetch_session(
        run_id=run_id,
        keyword=kw,
        search_opt=search_opt,
        from_date=from_date,
        to_date=to_date,
        max_results=max_results,
        language=language,
        config=persist_config,
        created_by=created_by,
        status="awaiting_captcha",
        message=message,
    )
    run: dict[str, Any] = {
        "run_id": run_id,
        "status": "awaiting_captcha",
        "keyword": kw,
        "search_opt": search_opt,
        "from_date": from_date,
        "to_date": to_date,
        "max_results": max_results,
        "language": language,
        "upload_to_cloudinary": upload_to_cloudinary,
        "funnel_config": run_config,
        "created_by": created_by,
        "client": client,
        "pending_rows": [],
        "pending_index": 0,
        "found": 0,
        "downloaded": 0,
        "skipped_duplicates": 0,
        "failed_downloads": 0,
        "remaining": 0,
        "created_sessions": [],
        "captcha_image": captcha_b64,
        "error": None,
        "message": message,
        "created_at": time.time(),
        "updated_at": time.time(),
        "captcha_validated": False,
        "paused_session_id": None,
        "pending_duplicate": None,
        "force_reingest_paths": set(),
    }
    with _RUNS_LOCK:
        _RUNS[run_id] = run
    return _serialize_run(run)


def _ensure_live_run(run_id: str) -> dict[str, Any]:
    """Return in-memory run, rehydrating from DB after process restart when needed."""
    live = _run_get(run_id)
    if live:
        return live
    if not is_postgres_configured():
        raise ScrScraperError("Search run not found")
    row = execute_one("SELECT * FROM public.scr_fetch_sessions WHERE id = %s", (run_id,))
    if not row:
        raise ScrScraperError("Search run not found")

    status = str(row.get("status") or "").lower()
    if status == "completed" and int(row.get("remaining") or 0) <= 0:
        raise ScrScraperError("This search run is already completed")

    cfg = row.get("config") if isinstance(row.get("config"), dict) else {}
    run_config = _resolve_judgment_funnel_config(cfg)

    client = SCRClient()
    try:
        client.init_session()
        captcha_b64 = client.get_captcha_b64()
    except ScrScraperError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ScrScraperError(f"Failed to restore SCR session: {exc}") from exc

    message = "Server restarted — enter CAPTCHA to continue this fetch."
    run: dict[str, Any] = {
        "run_id": run_id,
        "status": "awaiting_captcha",
        "keyword": str(row.get("keyword") or ""),
        "search_opt": str(row.get("search_opt") or cfg.get("search_opt") or "PHRASE"),
        "from_date": str(row.get("from_date") or cfg.get("from_date") or ""),
        "to_date": str(row.get("to_date") or cfg.get("to_date") or ""),
        "max_results": int(row.get("max_results") or cfg.get("max_results") or DEFAULT_MAX_RESULTS),
        "language": str(row.get("language") or cfg.get("language") or ""),
        "upload_to_cloudinary": bool(cfg.get("upload_to_cloudinary")),
        "funnel_config": run_config,
        "created_by": row.get("created_by"),
        "client": client,
        "pending_rows": [],
        "pending_index": 0,
        "found": int(row.get("found") or 0),
        "downloaded": int(row.get("downloaded") or 0),
        "skipped_duplicates": int(row.get("skipped_duplicates") or 0),
        "failed_downloads": int(row.get("failed_downloads") or 0),
        "remaining": int(row.get("remaining") or 0),
        "created_sessions": [],
        "captcha_image": captcha_b64,
        "error": None,
        "message": message,
        "created_at": time.time(),
        "updated_at": time.time(),
        "captcha_validated": False,
        "paused_session_id": None,
        "pending_duplicate": None,
        "force_reingest_paths": set(),
    }
    with _RUNS_LOCK:
        _RUNS[run_id] = run
    _persist_fetch_fields(
        run_id,
        {
            "status": "awaiting_captcha",
            "message": message,
            "error": None,
        },
    )
    return run


def refresh_captcha(run_id: str) -> dict[str, Any]:
    run = _ensure_live_run(run_id)
    if run.get("status") == "running":
        raise ScrScraperError("Cannot refresh CAPTCHA while a download is running")
    client: SCRClient = run["client"]
    try:
        captcha_b64 = client.get_captcha_b64()
    except Exception as exc:  # noqa: BLE001
        raise ScrScraperError(f"Failed to fetch CAPTCHA: {exc}") from exc
    _run_update(
        run_id,
        {
            "status": "awaiting_captcha",
            "captcha_image": captcha_b64,
            "error": None,
            "message": "Enter the new CAPTCHA to continue.",
        },
    )
    return get_run(run_id)


def submit_captcha(run_id: str, captcha: str) -> dict[str, Any]:
    run = _ensure_live_run(run_id)
    if run.get("status") == "running":
        raise ScrScraperError("A download is already in progress for this run")
    if run.get("status") not in ("awaiting_captcha", "failed"):
        # Allow re-submit only when waiting or after a soft failure.
        if run.get("status") == "completed" and int(run.get("remaining") or 0) <= 0:
            raise ScrScraperError("This search run is already completed")

    client: SCRClient = run["client"]
    try:
        client.submit_captcha(captcha, search_opt=run.get("search_opt") or "PHRASE")
    except ScrScraperError as exc:
        # Re-fetch captcha so the UI can retry.
        try:
            captcha_b64 = client.get_captcha_b64()
        except Exception:  # noqa: BLE001
            captcha_b64 = None
        _run_update(
            run_id,
            {
                "status": "awaiting_captcha",
                "captcha_image": captcha_b64,
                "error": str(exc),
                "message": "CAPTCHA rejected. Try again.",
            },
        )
        raise ScrScraperError(str(exc)) from exc

    _run_update(
        run_id,
        {
            "status": "running",
            "captcha_validated": True,
            "captcha_image": None,
            "error": None,
            "message": "CAPTCHA accepted. Searching and downloading…",
        },
    )
    thread = threading.Thread(target=_run_worker, args=(run_id,), daemon=True)
    thread.start()
    return get_run(run_id)


def get_run(run_id: str) -> dict[str, Any]:
    run = _run_get(run_id)
    if run:
        return _serialize_run(run)
    # Fall back to persisted session (no live captcha after process restart).
    return get_fetch_session(run_id, include_pdfs=False)


def delete_run(run_id: str, *, delete_pdfs: bool = True) -> dict[str, Any]:
    with _RUNS_LOCK:
        _RUNS.pop(run_id, None)
    row = execute_one("SELECT id FROM public.scr_fetch_sessions WHERE id = %s", (run_id,))
    if not row:
        raise ScrScraperError("Search run not found")
    deleted_pdfs = 0
    if delete_pdfs:
        pdfs = execute(
            "SELECT id FROM public.rag_ingest_sessions WHERE scr_fetch_session_id = %s",
            (run_id,),
        )
        ids = [str(p["id"]) for p in pdfs if p.get("id")]
        if ids:
            # Chunks cascade via session FK; clear case ledger links first.
            execute_void(
                "UPDATE public.scr_downloaded_cases SET rag_session_id = NULL WHERE rag_session_id = ANY(%s::uuid[])",
                (ids,),
            )
            execute_void(
                "DELETE FROM public.rag_ingest_sessions WHERE id = ANY(%s::uuid[])",
                (ids,),
            )
            deleted_pdfs = len(ids)
    execute_void(
        "UPDATE public.scr_downloaded_cases SET scr_fetch_session_id = NULL WHERE scr_fetch_session_id = %s",
        (run_id,),
    )
    execute_void("DELETE FROM public.scr_fetch_sessions WHERE id = %s", (run_id,))
    return {"success": True, "deleted_pdfs": deleted_pdfs}


def _persist_funnel_config(run_id: str, funnel_config: dict[str, Any]) -> None:
    row = execute_one("SELECT config FROM public.scr_fetch_sessions WHERE id = %s", (run_id,))
    current = row.get("config") if row and isinstance(row.get("config"), dict) else {}
    merged = {**(current or {}), **funnel_config}
    execute_void(
        "UPDATE public.scr_fetch_sessions SET config = %s::jsonb, updated_at = now() WHERE id = %s",
        (json.dumps(merged, default=str), run_id),
    )


def resume_with_model(
    run_id: str,
    *,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> dict[str, Any]:
    """Continue a fetch paused for LLM quota after the admin changes provider/model."""
    run = _run_get(run_id)
    if not run:
        raise ScrScraperError(
            "Search run is not live in this server process. Restart the fetch or re-enter CAPTCHA."
        )
    if run.get("status") != "awaiting_model":
        raise ScrScraperError("This SCR session is not waiting for a model change")

    overrides = dict(run.get("funnel_config") or {})
    if provider:
        overrides["provider"] = provider
    if model:
        overrides["model"] = model
    new_cfg = rag_funnel.resolve_run_config(overrides)
    with _RUNS_LOCK:
        live = _RUNS.get(run_id)
        if live:
            live["funnel_config"] = new_cfg
    _persist_funnel_config(run_id, new_cfg)

    paused_sid = run.get("paused_session_id")

    def _continue() -> None:
        try:
            if paused_sid:
                result = rag_funnel.rerun_session_blocking(
                    paused_sid,
                    config_overrides={
                        "provider": new_cfg.get("provider"),
                        "model": new_cfg.get("model"),
                    },
                )
                status = str(result.get("status") or "")
                if status == "paused_quota" or (
                    status == "failed"
                    and rag_funnel._is_rate_limit_error(Exception(result.get("error") or ""))
                ):
                    err = result.get("error") or "rate limited"
                    _run_update(
                        run_id,
                        {
                            "status": "awaiting_model",
                            "paused_session_id": paused_sid,
                            "error": str(err)[:2000],
                            "message": (
                                "Still rate-limited after model change. "
                                "Pick another provider/model and continue again."
                            ),
                        },
                    )
                    return
                if status == "failed":
                    _run_update(
                        run_id,
                        {
                            "status": "awaiting_model",
                            "paused_session_id": paused_sid,
                            "error": str(result.get("error") or "rerun failed")[:2000],
                            "message": "Paused PDF still failed — change model and try again.",
                        },
                    )
                    return

                # Mark the paused PDF complete and advance past it.
                live = _run_get(run_id) or {}
                pending = list(live.get("pending_rows") or [])
                idx = int(live.get("pending_index") or 0)
                row = pending[idx] if 0 <= idx < len(pending) else {}
                path = row.get("path") or ""
                try:
                    record_downloaded_case(
                        case_path=path,
                        neutral_citation=row.get("nc_display"),
                        citation_year=row.get("citation_year"),
                        title=row.get("title"),
                        keyword=str(live.get("keyword") or ""),
                        language_codes=row.get("language_codes"),
                        source_pdf_url=result.get("source_pdf_url"),
                        rag_session_id=paused_sid,
                        created_by=live.get("created_by"),
                        status="downloaded",
                        scr_fetch_session_id=run_id,
                    )
                except Exception:  # noqa: BLE001
                    pass
                sessions = list(live.get("created_sessions") or [])
                sessions.append(
                    {
                        "session_id": paused_sid,
                        "case_path": path,
                        "neutral_citation": row.get("nc_display"),
                        "title": row.get("title"),
                    }
                )
                with _RUNS_LOCK:
                    r = _RUNS.get(run_id)
                    if r:
                        r["created_sessions"] = sessions
                downloaded = int(live.get("downloaded") or 0) + 1
                next_idx = idx + 1
                _run_update(
                    run_id,
                    {
                        "downloaded": downloaded,
                        "pending_index": next_idx,
                        "remaining": max(0, len(pending) - next_idx),
                        "paused_session_id": None,
                        "error": None,
                        "message": f"Resumed with {new_cfg.get('provider')}/{new_cfg.get('model')}. Continuing…",
                    },
                )
                time.sleep(INGEST_COOLDOWN_SECONDS)

            _run_update(
                run_id,
                {
                    "status": "running",
                    "paused_session_id": None,
                    "error": None,
                    "message": (
                        f"Continuing with {new_cfg.get('provider')}/{new_cfg.get('model')}…"
                    ),
                },
            )
            _run_worker(run_id)
        except Exception as exc:  # noqa: BLE001
            _run_update(
                run_id,
                {
                    "status": "awaiting_model",
                    "error": str(exc)[:2000],
                    "message": f"Resume failed: {exc}",
                },
            )

    _run_update(
        run_id,
        {
            "status": "running",
            "error": None,
            "message": f"Resuming with {new_cfg.get('provider')}/{new_cfg.get('model')}…",
        },
    )
    threading.Thread(target=_continue, daemon=True).start()
    return get_run(run_id)


def resolve_duplicate(run_id: str, *, action: str) -> dict[str, Any]:
    """Skip or re-ingest a PDF that was already ingested under another keyword session."""
    run = _run_get(run_id)
    if not run:
        raise ScrScraperError(
            "Search run is not live in this server process. Open the session while the backend still holds it."
        )
    if run.get("status") != "awaiting_duplicate":
        raise ScrScraperError("This SCR session is not waiting on a duplicate decision")
    decision = (action or "").strip().lower()
    if decision not in ("skip", "reingest"):
        raise ScrScraperError("action must be 'skip' or 'reingest'")

    dup = run.get("pending_duplicate") or {}
    path = str(dup.get("case_path") or "")
    if not path:
        raise ScrScraperError("No pending duplicate case on this run")

    pending = list(run.get("pending_rows") or [])
    idx = int(run.get("pending_index") or 0)
    keyword = str(run.get("keyword") or "")
    created_by = run.get("created_by")
    row = pending[idx] if 0 <= idx < len(pending) else {"path": path}

    if decision == "skip":
        try:
            record_downloaded_case(
                case_path=path,
                neutral_citation=dup.get("neutral_citation") or row.get("nc_display"),
                citation_year=row.get("citation_year"),
                title=dup.get("title") or row.get("title"),
                keyword=keyword,
                language_codes=row.get("language_codes"),
                source_pdf_url=None,
                rag_session_id=None,
                created_by=created_by,
                status="skipped_duplicate",
                scr_fetch_session_id=run_id,
            )
        except Exception:  # noqa: BLE001
            pass
        skipped = int(run.get("skipped_duplicates") or 0) + 1
        next_idx = idx + 1
        _run_update(
            run_id,
            {
                "status": "running",
                "skipped_duplicates": skipped,
                "pending_index": next_idx,
                "remaining": max(0, len(pending) - next_idx),
                "pending_duplicate": None,
                "error": None,
                "message": f"Skipped duplicate {path}. Continuing…",
            },
        )
    else:
        force = set(run.get("force_reingest_paths") or set())
        force.add(path)
        with _RUNS_LOCK:
            live = _RUNS.get(run_id)
            if live:
                live["force_reingest_paths"] = force
        _run_update(
            run_id,
            {
                "status": "running",
                "pending_duplicate": None,
                "error": None,
                "message": f"Re-ingesting {path}…",
            },
        )

    thread = threading.Thread(target=_run_worker, args=(run_id,), daemon=True)
    thread.start()
    return get_run(run_id)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


def _collect_candidates(run: dict[str, Any]) -> list[dict[str, Any]]:
    """Paginate SCR search until max_results or no more rows."""
    client: SCRClient = run["client"]
    keyword = run["keyword"]
    search_opt = run.get("search_opt") or "PHRASE"
    from_date = run.get("from_date") or ""
    to_date = run.get("to_date") or ""
    language = run.get("language") or ""
    max_results = int(run.get("max_results") or DEFAULT_MAX_RESULTS)

    candidates: list[dict[str, Any]] = []
    start = 0
    while len(candidates) < max_results:
        page_len = min(PAGE_SIZE, max_results - len(candidates))
        res = client.search(
            keyword=keyword,
            search_opt=search_opt,
            from_date=from_date,
            to_date=to_date,
            start=start,
            length=page_len,
            sel_lang=language,
        )
        rows = parse_search_results(res)
        if not rows:
            break
        for row in rows:
            if len(candidates) >= max_results:
                break
            candidates.append(row)
        if len(rows) < page_len:
            break
        start += page_len
        time.sleep(0.4)
    return candidates


def _ingest_pdf(
    *,
    pdf_bytes: bytes,
    pdf_info: dict[str, Any],
    keyword: str,
    funnel_config: dict[str, Any],
    upload_to_cloudinary: bool,
    created_by: Optional[str],
    scr_fetch_session_id: Optional[str] = None,
    on_progress: Optional[Callable[[str], None]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Create a rag_funnel session and run its pipeline to completion (blocking).

    One PDF at a time — avoids stacking concurrent LLM calls across sessions.
    """
    path = pdf_info.get("path") or "judgment"
    nc = pdf_info.get("nc_display") or path
    doc_name = str(nc)
    try:
        pages = rag_funnel.extract_pdf_pages(pdf_bytes)
    except Exception as exc:  # noqa: BLE001
        raise ScrScraperError(f"Failed to read PDF for {path}: {exc}") from exc
    has_text = any((p or "").strip() for p in pages)
    provider = str(funnel_config.get("provider") or "").strip().lower()
    if not has_text and provider not in rag_funnel._PDF_NATIVE_PROVIDERS:
        # Scanned judgment: only providers that read the PDF itself can handle it.
        raise ScrScraperError(f"No extractable text in PDF for {path}")

    source_pdf_url = None
    if upload_to_cloudinary:
        try:
            from backend.database.pdf_service import CloudinaryService

            result = CloudinaryService.upload_pdf(
                pdf_bytes, f"scr_{path}", str(created_by or "admin")
            )
            if result.get("success"):
                source_pdf_url = result.get("url")
        except Exception as exc:  # noqa: BLE001
            print(f"⚠️ scr_scraper Cloudinary upload failed ({path}): {exc}")

    cfg = dict(funnel_config)
    cfg["document_name"] = doc_name
    cfg["ingest_mode"] = "summary"
    cfg.setdefault("category", "Supreme Court judgment")
    cfg.setdefault("authority", "Supreme Court of India")
    cfg.setdefault("source_type", "scr_judgment_pdf")
    # Embed keyword context into act_name when not set.
    if not cfg.get("act_name"):
        cfg["act_name"] = f"SC judgment · {keyword}"

    session = rag_funnel.create_session(
        document_name=doc_name,
        pages=pages,
        config=cfg,
        source_filename=f"{path}_EN.pdf",
        source_pdf_url=source_pdf_url,
        created_by=created_by,
        source_kind="scr",
        scr_fetch_session_id=scr_fetch_session_id,
    )
    session_id = str(session["id"])
    # Let the pipeline send the file itself when the provider supports PDFs.
    rag_funnel.register_session_pdf(session_id, pdf_bytes)
    if on_progress:
        on_progress(f"Summarizing {path} (whole PDF → 1 chunk) → session {session_id[:8]}…")
    # Blocking: wait until this PDF finishes before the next download/ingest.
    result = rag_funnel.run_pipeline_blocking(session_id)
    status = str(result.get("status") or "")
    if status in ("paused_quota", "failed"):
        err = result.get("error") or "pipeline failed"
        if status == "paused_quota" or rag_funnel._is_rate_limit_error(Exception(err)):
            raise rag_funnel.RateLimitError(
                rag_funnel._friendly_rate_limit_message(Exception(err)),
                session_id=session_id,
            )
        raise ScrScraperError(f"RAG pipeline failed for {path}: {err}")
    return session_id, source_pdf_url


def _run_worker(run_id: str) -> None:
    run = _run_get(run_id)
    if not run:
        return
    try:
        # First captcha: collect candidates if we don't have them yet.
        if not run.get("pending_rows"):
            _run_update(run_id, {"message": "Searching SCR for matching judgments…"})
            candidates = _collect_candidates(run)
            # Dedup within the result set by path.
            seen: set[str] = set()
            unique: list[dict[str, Any]] = []
            for c in candidates:
                p = c.get("path") or ""
                if not p or p in seen:
                    continue
                seen.add(p)
                unique.append(c)
            _run_update(
                run_id,
                {
                    "pending_rows": unique,
                    "pending_index": 0,
                    "found": len(unique),
                    "remaining": len(unique),
                    "message": f"Found {len(unique)} judgment(s). Downloading…",
                },
            )
            run = _run_get(run_id) or run

        pending: list[dict[str, Any]] = list(run.get("pending_rows") or [])
        idx = int(run.get("pending_index") or 0)
        downloaded_this_batch = 0
        client: SCRClient = run["client"]
        keyword = run["keyword"]
        funnel_config = run.get("funnel_config") or {}
        upload_to_cloudinary = bool(run.get("upload_to_cloudinary"))
        created_by = run.get("created_by")
        language_pref = run.get("language") or ""

        while idx < len(pending):
            if downloaded_this_batch >= NO_CAPTCHA_BATCH_SIZE:
                # Need a fresh CAPTCHA for the next batch.
                try:
                    captcha_b64 = client.get_captcha_b64()
                except Exception as exc:  # noqa: BLE001
                    _run_update(
                        run_id,
                        {
                            "status": "awaiting_captcha",
                            "pending_index": idx,
                            "remaining": len(pending) - idx,
                            "captcha_image": None,
                            "error": f"Need a new CAPTCHA but fetch failed: {exc}",
                            "message": "Paused after batch; refresh CAPTCHA and continue.",
                        },
                    )
                    return
                _run_update(
                    run_id,
                    {
                        "status": "awaiting_captcha",
                        "pending_index": idx,
                        "remaining": len(pending) - idx,
                        "captcha_image": captcha_b64,
                        "error": None,
                        "message": (
                            f"Downloaded {downloaded_this_batch} in this batch. "
                            f"{len(pending) - idx} remaining — enter a new CAPTCHA to continue."
                        ),
                    },
                )
                return

            row = pending[idx]
            path = row.get("path") or ""
            idx += 1

            force_paths = set((_run_get(run_id) or {}).get("force_reingest_paths") or set())
            prior = None if path in force_paths else get_ingested_case_prior(path)
            if prior:
                # Pause and ask the admin whether to skip this already-ingested PDF.
                prior_kw = prior.get("prior_session_keyword") or prior.get("keyword") or "unknown"
                _run_update(
                    run_id,
                    {
                        "status": "awaiting_duplicate",
                        "pending_index": idx - 1,
                        "remaining": len(pending) - (idx - 1),
                        "pending_duplicate": {
                            "case_path": path,
                            "title": prior.get("title") or row.get("title"),
                            "neutral_citation": prior.get("neutral_citation")
                            or row.get("nc_display"),
                            "prior_session_keyword": prior_kw,
                            "prior_document_name": prior.get("prior_document_name"),
                            "prior_rag_session_id": prior.get("rag_session_id"),
                            "prior_fetch_session_id": prior.get("scr_fetch_session_id"),
                            "current_keyword": keyword,
                        },
                        "error": None,
                        "message": (
                            f"{path} was already ingested under keyword “{prior_kw}”. "
                            "Skip it or re-ingest?"
                        ),
                    },
                )
                return

            if case_exists(path) and path not in force_paths:
                # Ledger row without a prior ingest — silent skip + keyword association.
                try:
                    record_downloaded_case(
                        case_path=path,
                        neutral_citation=row.get("nc_display"),
                        citation_year=row.get("citation_year"),
                        title=row.get("title"),
                        keyword=keyword,
                        language_codes=row.get("language_codes"),
                        source_pdf_url=None,
                        rag_session_id=None,
                        created_by=created_by,
                        status="skipped_duplicate",
                        scr_fetch_session_id=run_id,
                    )
                except Exception:  # noqa: BLE001
                    pass
                skipped = int((_run_get(run_id) or {}).get("skipped_duplicates") or 0) + 1
                _run_update(
                    run_id,
                    {
                        "skipped_duplicates": skipped,
                        "pending_index": idx,
                        "remaining": len(pending) - idx,
                    },
                )
                continue

            # Prefer English (empty lang code) unless a specific language was requested.
            lang_codes = list(row.get("language_codes") or [""])
            if language_pref:
                if language_pref in lang_codes:
                    lang_codes = [language_pref]
                else:
                    lang_codes = [language_pref]
            else:
                # Prefer empty / EN first.
                lang_codes = sorted(
                    lang_codes,
                    key=lambda c: 0 if (not c or str(c).upper() == "EN") else 1,
                )

            pdf_bytes: Optional[bytes] = None
            used_lang = ""
            download_error: Optional[str] = None
            for lang in lang_codes:
                try:
                    pdf_bytes = client.download_pdf(row, lang_code=lang or "")
                    if pdf_bytes:
                        used_lang = lang or ""
                        break
                except ScrScraperError as exc:
                    msg = str(exc).lower()
                    if "captcha" in msg or "session expired" in msg:
                        # Pause for a new CAPTCHA; rewind index so this row is retried.
                        try:
                            captcha_b64 = client.get_captcha_b64()
                        except Exception:  # noqa: BLE001
                            captcha_b64 = None
                        _run_update(
                            run_id,
                            {
                                "status": "awaiting_captcha",
                                "pending_index": idx - 1,
                                "remaining": len(pending) - (idx - 1),
                                "captcha_image": captcha_b64,
                                "error": str(exc),
                                "message": "Portal requires a new CAPTCHA to continue downloads.",
                            },
                        )
                        return
                    download_error = str(exc)
                except Exception as exc:  # noqa: BLE001
                    download_error = str(exc)

            if not pdf_bytes:
                failed = int((_run_get(run_id) or {}).get("failed_downloads") or 0) + 1
                _run_update(
                    run_id,
                    {
                        "failed_downloads": failed,
                        "pending_index": idx,
                        "remaining": len(pending) - idx,
                        "message": (
                            f"Failed to download {path}"
                            + (f": {download_error}" if download_error else "")
                        ),
                    },
                )
                time.sleep(0.3)
                continue

            def _progress(msg: str) -> None:
                _run_update(
                    run_id,
                    {
                        "message": msg,
                        "pending_index": idx - 1,
                        "remaining": len(pending) - (idx - 1),
                    },
                )

            try:
                session_id, source_pdf_url = _ingest_pdf(
                    pdf_bytes=pdf_bytes,
                    pdf_info=row,
                    keyword=keyword,
                    funnel_config=funnel_config,
                    upload_to_cloudinary=upload_to_cloudinary,
                    created_by=created_by,
                    scr_fetch_session_id=run_id,
                    on_progress=_progress,
                )
                record_downloaded_case(
                    case_path=path,
                    neutral_citation=row.get("nc_display"),
                    citation_year=row.get("citation_year"),
                    title=row.get("title"),
                    keyword=keyword,
                    language_codes=[used_lang] if used_lang else row.get("language_codes"),
                    source_pdf_url=source_pdf_url,
                    rag_session_id=session_id,
                    created_by=created_by,
                    status="downloaded",
                    scr_fetch_session_id=run_id,
                )
                live = _run_get(run_id) or {}
                sessions = list(live.get("created_sessions") or [])
                sessions.append(
                    {
                        "session_id": session_id,
                        "case_path": path,
                        "neutral_citation": row.get("nc_display"),
                        "title": row.get("title"),
                    }
                )
                with _RUNS_LOCK:
                    r = _RUNS.get(run_id)
                    if r:
                        r["created_sessions"] = sessions
                downloaded = int(live.get("downloaded") or 0) + 1
                _run_update(
                    run_id,
                    {
                        "downloaded": downloaded,
                        "pending_index": idx,
                        "remaining": len(pending) - idx,
                        "message": (
                            f"Ingested {path} → session {session_id[:8]}… "
                            f"(cooling down {int(INGEST_COOLDOWN_SECONDS)}s before next PDF)"
                        ),
                    },
                )
                downloaded_this_batch += 1
                # Pause between PDFs so free-tier LLM quotas can recover.
                time.sleep(INGEST_COOLDOWN_SECONDS)
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️ scr_scraper ingest failed ({path}): {exc}")
                err_text = str(exc)
                rate_limited = (
                    isinstance(exc, rag_funnel.RateLimitError)
                    or "429" in err_text
                    or "rate limit" in err_text.lower()
                    or "free-models-per-day" in err_text.lower()
                    or "paused_quota" in err_text.lower()
                )
                if rate_limited:
                    # Pause progress — do not mark remaining PDFs failed one-by-one.
                    friendly = (
                        err_text
                        if isinstance(exc, rag_funnel.RateLimitError)
                        else rag_funnel._friendly_rate_limit_message(exc)
                    )
                    paused_sid = getattr(exc, "session_id", None)
                    _run_update(
                        run_id,
                        {
                            "status": "awaiting_model",
                            "pending_index": idx - 1,
                            "remaining": len(pending) - (idx - 1),
                            "paused_session_id": paused_sid,
                            "error": friendly[:2000],
                            "message": (
                                f"Paused after ingesting up to this point ({path}). "
                                "Change provider/model in the header, then continue."
                            ),
                        },
                    )
                    return
                failed = int((_run_get(run_id) or {}).get("failed_downloads") or 0) + 1
                _run_update(
                    run_id,
                    {
                        "failed_downloads": failed,
                        "pending_index": idx,
                        "remaining": len(pending) - idx,
                        "message": f"Ingest failed for {path}: {exc}",
                    },
                )
                time.sleep(INGEST_COOLDOWN_SECONDS)

        _run_update(
            run_id,
            {
                "status": "completed",
                "pending_index": idx,
                "remaining": 0,
                "captcha_image": None,
                "message": (
                    f"Done. found={run.get('found', 0)} "
                    f"downloaded={_run_get(run_id) and _run_get(run_id).get('downloaded', 0)} "
                    f"skipped={_run_get(run_id) and _run_get(run_id).get('skipped_duplicates', 0)}"
                ),
            },
        )
        # Refresh message with final counters.
        final = _run_get(run_id)
        if final:
            _run_update(
                run_id,
                {
                    "message": (
                        f"Done. Found {final.get('found', 0)}, "
                        f"downloaded {final.get('downloaded', 0)}, "
                        f"skipped {final.get('skipped_duplicates', 0)}, "
                        f"failed {final.get('failed_downloads', 0)}."
                    ),
                },
            )
    except Exception as exc:  # noqa: BLE001
        _run_update(
            run_id,
            {
                "status": "failed",
                "error": str(exc),
                "message": f"Search/download failed: {exc}",
            },
        )

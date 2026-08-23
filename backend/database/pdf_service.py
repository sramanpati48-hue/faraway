"""
PDF Generation and Cloudinary Upload Service for Case Reports
"""
import html
import json
import os
from datetime import datetime
from io import BytesIO
import urllib.parse
import urllib.request
from dotenv import load_dotenv
import cloudinary
import cloudinary.api
import cloudinary.uploader
import cloudinary.utils
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY, TA_RIGHT
import logging

logger = logging.getLogger(__name__)

from backend.paths import REPO_ROOT

load_dotenv()
load_dotenv(dotenv_path=REPO_ROOT / "backend" / "agents" / ".env")
load_dotenv(dotenv_path=REPO_ROOT / ".env")

# Configure Cloudinary
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME", ""),
    api_key=os.getenv("CLOUDINARY_API_KEY", ""),
    api_secret=os.getenv("CLOUDINARY_API_SECRET", "")
)


def resolve_question_labels(
    answers: dict | None = None,
    question_labels: dict | None = None,
    case_data: dict | None = None,
) -> dict[str, str]:
    """Map answer keys (q_0, …) to human-readable question text."""
    labels: dict[str, str] = {}

    def _merge(src: dict | None) -> None:
        if not isinstance(src, dict):
            return
        for key, value in src.items():
            text = str(value or "").strip()
            if text:
                labels[str(key)] = text

    _merge(question_labels)
    data = case_data if isinstance(case_data, dict) else {}
    _merge(data.get("question_labels") if isinstance(data.get("question_labels"), dict) else None)
    summary = data.get("situation_summary") if isinstance(data.get("situation_summary"), dict) else {}
    _merge(summary.get("question_labels") if isinstance(summary.get("question_labels"), dict) else None)

    pairs = data.get("qa_pairs")
    if not isinstance(pairs, list):
        pairs = summary.get("qa_pairs") if isinstance(summary, dict) else None
    if isinstance(pairs, list):
        for row in pairs:
            if not isinstance(row, dict):
                continue
            key = str(row.get("key") or "").strip()
            question = str(row.get("question") or "").strip()
            if key and question:
                labels.setdefault(key, question)

    # pending_questions catalog (when still present on the case payload)
    pending = data.get("pending_questions") or summary.get("pending_questions")
    if isinstance(pending, list):
        for i, item in enumerate(pending):
            if isinstance(item, dict):
                key = str(item.get("key") or f"q_{i}")
                question = str(item.get("question") or item.get("text") or "").strip()
                if key and question:
                    labels.setdefault(key, question)
            elif item:
                labels.setdefault(f"q_{i}", str(item).strip())

    return labels


def iter_qa_for_pdf(
    answers: dict | None,
    question_labels: dict | None = None,
    case_data: dict | None = None,
):
    """Yield (question_text, answer) rows for PDF/HTML rendering."""
    if not isinstance(answers, dict) or not answers:
        return
    labels = resolve_question_labels(answers, question_labels, case_data)
    for key, answer in answers.items():
        k = str(key)
        question = labels.get(k) or labels.get(key)
        if not question:
            # Prefer not to show raw q_0; fall back to a readable placeholder.
            if k.startswith("q_") and k[2:].isdigit():
                question = f"Follow-up question {int(k[2:]) + 1}"
            else:
                question = k
        yield question, answer


class PDFGenerator:
    """Generate PDF reports from structured case data."""
    
    def __init__(self):
        self.page_width, self.page_height = letter
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
    
    def _setup_custom_styles(self):
        """Setup custom paragraph styles for the PDF."""
        self.styles.add(ParagraphStyle(
            name='ReportTitle',
            parent=self.styles['Heading1'],
            fontSize=20,
            textColor=colors.HexColor('#1a202c'),
            spaceAfter=12,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        ))
        
        self.styles.add(ParagraphStyle(
            name='SectionHead',
            parent=self.styles['Heading2'],
            fontSize=14,
            textColor=colors.HexColor('#2d3748'),
            spaceAfter=8,
            spaceBefore=8,
            fontName='Helvetica-Bold'
        ))
        
        self.styles.add(ParagraphStyle(
            name='ReportBodyText',
            parent=self.styles['BodyText'],
            fontSize=10,
            alignment=TA_JUSTIFY,
            spaceAfter=6
        ))
        
        self.styles.add(ParagraphStyle(
            name='Label',
            fontSize=9,
            fontName='Helvetica-Bold',
            textColor=colors.HexColor('#4a5568'),
            spaceAfter=2
        ))
    
    def _sanitize_text(self, text):
        """Sanitize text for PDF rendering (convert special characters)."""
        if not text:
            return ""
        text = str(text)
        # Replace problematic characters
        replacements = {
            '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
            '•': '-', '→': '>',
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text[:5000]  # Limit text length

    def _resolve_logo_path(self) -> str:
        """Resolve NyaySahayak logo path if available in workspace."""
        from backend.paths import REPO_ROOT

        base_dir = str(REPO_ROOT)
        candidates = [
            os.path.join(base_dir, "web_app", "public", "logo.png"),
            os.path.join(base_dir, "web_app", "public", "3.png"),
            os.path.join(base_dir, "web_app", "public", "2.png"),
            os.path.join(base_dir, "assets", "logo.png"),
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        return ""
    
    def generate_pdf(self, case_data: dict, answers: dict = None, question_labels: dict = None) -> bytes:
        """
        Generate PDF from structured case data.
        
        Args:
            case_data: Structured report dict with incident_type, risk_level, summary, etc.
            answers: User's answers to follow-up questions (optional)
            question_labels: Map of answer key → question text (optional)
        
        Returns:
            PDF bytes
        """
        self._question_labels = question_labels
        buffer = BytesIO()
        
        # Create PDF document
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=0.75*inch,
            bottomMargin=0.75*inch
        )
        
        elements = []
        support_email = os.getenv("NYAYSAHAYAK_SUPPORT_EMAIL", "support@nyaysahayak.in")
        support_phone = os.getenv("NYAYSAHAYAK_SUPPORT_PHONE", "+91-1930 (Cyber Helpline)")
        support_website = os.getenv("NYAYSAHAYAK_SUPPORT_WEBSITE", "www.nyaysahayak.in")

        # Branded header
        logo_path = self._resolve_logo_path()
        if logo_path:
            try:
                logo = Image(logo_path, width=1.3 * inch, height=1.3 * inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 0.08 * inch))
            except Exception as logo_err:
                logger.warning(f"Logo render skipped: {logo_err}")
        
        # Title
        elements.append(Paragraph("LEGAL CASE REPORT", self.styles['ReportTitle']))
        elements.append(Paragraph("NyaySahayak AI Legal Assistant", self.styles['Normal']))
        elements.append(Paragraph(f"Contact: {support_email} | {support_phone} | {support_website}", self.styles['Normal']))
        elements.append(Spacer(1, 0.2*inch))
        
        # Case Header
        timestamp = datetime.now().strftime("%d %B %Y at %H:%M")
        elements.append(Paragraph(f"Report Generated: {timestamp}", self.styles['Normal']))
        elements.append(Spacer(1, 0.15*inch))
        
        # Horizontal line
        line_data = [['_' * 80]]
        line_table = Table(line_data, colWidths=[7*inch])
        line_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#cbd5e0')),
        ]))
        elements.append(line_table)
        elements.append(Spacer(1, 0.2*inch))
        
        # Case Summary Section
        elements.append(Paragraph("CASE SUMMARY", self.styles['SectionHead']))
        
        summary_data = [
            ["Incident Type:", self._sanitize_text(case_data.get("incident_type", "General"))],
            ["Risk Level:", self._sanitize_text(case_data.get("risk_level", "Low"))],
            ["Criticality:", self._sanitize_text(case_data.get("criticality", "Unknown"))],
        ]
        
        if case_data.get("amount_involved"):
            summary_data.append(["Amount Involved:", self._sanitize_text(case_data.get("amount_involved"))])
        
        if case_data.get("cognizable"):
            summary_data.append(["Cognizable Offense:", "Yes"])
        
        summary_table = Table(summary_data, colWidths=[1.5*inch, 4.5*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#edf2f7')),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#2d3748')),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cbd5e0')),
        ]))
        elements.append(summary_table)
        elements.append(Spacer(1, 0.2*inch))

        report_summary = self._sanitize_text(case_data.get("summary", "")).strip()
        if report_summary:
            elements.append(Paragraph("DETAILED CASE SUMMARY", self.styles['SectionHead']))
            elements.append(Paragraph(report_summary, self.styles['ReportBodyText']))
            elements.append(Spacer(1, 0.15*inch))
        
        # User's Statement
        elements.append(Paragraph("YOUR STATEMENT", self.styles['SectionHead']))
        user_summary = self._sanitize_text(case_data.get("user_verbatim", case_data.get("summary", "N/A")))
        elements.append(Paragraph(f'"{user_summary}"', self.styles['ReportBodyText']))
        elements.append(Spacer(1, 0.15*inch))
        
        # Location
        location = case_data.get("location", {})
        if location and location.get("city") != "Unknown":
            elements.append(Paragraph("LOCATION DETAILS", self.styles['SectionHead']))
            loc_data = [
                ["City:", self._sanitize_text(location.get("city", "N/A"))],
                ["State:", self._sanitize_text(location.get("state", "N/A"))],
            ]
            loc_table = Table(loc_data, colWidths=[1.5*inch, 4.5*inch])
            loc_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#edf2f7')),
                ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#2d3748')),
                ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cbd5e0')),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
            ]))
            elements.append(loc_table)
            elements.append(Spacer(1, 0.15*inch))
        
        # Applicable Laws
        statutory_sections = case_data.get("statutory_sections", [])
        if statutory_sections:
            elements.append(Paragraph("APPLICABLE LAWS", self.styles['SectionHead']))
            laws_list = "<br/>".join([f"• {self._sanitize_text(law)}" for law in statutory_sections])
            elements.append(Paragraph(laws_list, self.styles['ReportBodyText']))
            elements.append(Spacer(1, 0.15*inch))
        
        # Action Checklist
        checklist = case_data.get("checklist", [])
        if checklist:
            elements.append(Paragraph("RECOMMENDED ACTIONS", self.styles['SectionHead']))
            checklist_items = "<br/>".join([f"✓ {self._sanitize_text(item)}" for item in checklist])
            elements.append(Paragraph(checklist_items, self.styles['ReportBodyText']))
            elements.append(Spacer(1, 0.15*inch))
        
        # Additional Information (if answers provided)
        qa_rows = list(iter_qa_for_pdf(answers, question_labels, case_data))
        if qa_rows:
            elements.append(PageBreak())
            elements.append(Paragraph("ADDITIONAL INFORMATION", self.styles['SectionHead']))
            
            for question, answer in qa_rows:
                elements.append(Paragraph(f"<b>Q: {self._sanitize_text(question)}</b>", self.styles['Normal']))
                elements.append(Paragraph(f"A: {self._sanitize_text(answer)}", self.styles['ReportBodyText']))
                elements.append(Spacer(1, 0.1*inch))
        
        # Footer
        elements.append(Spacer(1, 0.3*inch))
        footer_line = Table([["_" * 80]], colWidths=[7*inch])
        footer_line.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#cbd5e0')),
        ]))
        elements.append(footer_line)
        elements.append(Spacer(1, 0.08*inch))
        elements.append(Paragraph(
            f"NyaySahayak Support | Email: {support_email} | Phone: {support_phone} | Web: {support_website}",
            self.styles['Normal']
        ))
        elements.append(Spacer(1, 0.05*inch))
        elements.append(Paragraph(
            "This report is generated by NyaySahayak AI Legal Assistant and is for informational purposes only. "
            "Please consult with a qualified legal professional for specific legal advice.",
            self.styles['Normal']
        ))
        
        # Build PDF
        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()


class CloudinaryService:
    """Handle file uploads to Cloudinary."""

    @staticmethod
    def upload_image(
        file_bytes: bytes,
        *,
        folder: str = "articles",
        filename: str | None = None,
        public_id: str | None = None,
    ) -> dict:
        """
        Upload an image (hero/cover assets) to Cloudinary.

        Returns dict with success, url, public_id, width, height, format.
        """
        try:
            if not os.getenv("CLOUDINARY_CLOUD_NAME") or not os.getenv("CLOUDINARY_API_KEY"):
                return {"success": False, "error": "Cloudinary is not configured"}

            safe_folder = (folder or "articles").strip().strip("/")
            if not safe_folder or ".." in safe_folder:
                safe_folder = "articles"
            folder_path = f"nyaysahayak/{safe_folder}"

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            base_name = (public_id or "").strip()
            if not base_name:
                stem = (filename or "image").rsplit(".", 1)[0]
                stem = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in stem)[:48] or "image"
                base_name = f"{stem}_{stamp}"

            upload_preset = os.getenv("CLOUDINARY_UPLOAD_PRESET", "").strip()
            upload_options: dict = {
                "resource_type": "image",
                "folder": folder_path,
                "public_id": base_name,
                "overwrite": False,
                "unique_filename": True,
            }
            if upload_preset:
                upload_options["upload_preset"] = upload_preset

            result = cloudinary.uploader.upload(BytesIO(file_bytes), **upload_options)
            url = result.get("secure_url") or result.get("url")
            logger.info(f"Image uploaded to Cloudinary: {url}")
            return {
                "success": True,
                "url": url,
                "public_id": result.get("public_id"),
                "width": result.get("width"),
                "height": result.get("height"),
                "format": result.get("format"),
                "bytes": result.get("bytes"),
                "uploaded_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Cloudinary image upload error: {e}")
            return {"success": False, "error": str(e)}
    
    @staticmethod
    def upload_pdf(pdf_bytes: bytes, case_id: str, user_id: str) -> dict:
        """
        Upload PDF to Cloudinary with proper folder structure.
        
        Args:
            pdf_bytes: PDF file content as bytes
            case_id: Unique case ID
            user_id: Firebase user ID
        
        Returns:
            Dict with upload result (url, public_id, etc.)
        """
        try:
            folder_path = f"nyaysahayak/cases/{case_id}"
            public_id = f"{case_id}_report_v{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            upload_preset = os.getenv("CLOUDINARY_UPLOAD_PRESET", "").strip()

            upload_options = {
                "resource_type": "raw",
                "folder": folder_path,
                "public_id": public_id,
                "format": "pdf",
                "overwrite": False,
                "context": {
                    "case_id": case_id,
                    "user_id": user_id,
                    "generated_at": datetime.now().isoformat()
                }
            }
            if upload_preset:
                upload_options["upload_preset"] = upload_preset

            result = cloudinary.uploader.upload(BytesIO(pdf_bytes), **upload_options)

            uploaded_public_id = result.get("public_id")
            signed_url = None
            if uploaded_public_id:
                try:
                    sign_kwargs = {
                        "resource_type": "raw",
                        "type": "upload",
                        "secure": True,
                        "sign_url": True
                    }
                    if not str(uploaded_public_id).lower().endswith(".pdf"):
                        sign_kwargs["format"] = "pdf"

                    signed_url, _ = cloudinary.utils.cloudinary_url(
                        uploaded_public_id,
                        **sign_kwargs
                    )
                except Exception as sign_err:
                    logger.warning(f"Could not generate signed Cloudinary URL: {sign_err}")
            
            delivery_url = result.get("secure_url") if upload_preset else (signed_url or result.get("secure_url") or result.get("url"))
            if isinstance(delivery_url, str) and ".pdf.pdf" in delivery_url:
                delivery_url = delivery_url.replace(".pdf.pdf", ".pdf")
            logger.info(f"PDF uploaded to Cloudinary: {delivery_url}")
            
            return {
                "success": True,
                "url": delivery_url,
                "public_id": uploaded_public_id,
                "uploaded_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Cloudinary upload error: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    @staticmethod
    def delete_old_pdf(public_id: str) -> bool:
        """Delete old PDF version from Cloudinary."""
        try:
            result = cloudinary.uploader.destroy(public_id, resource_type="raw")
            logger.info(f"Deleted old PDF: {public_id}")
            return result.get("result") == "ok"
        except Exception as e:
            logger.error(f"Error deleting PDF: {e}")
            return False

    @staticmethod
    def get_case_pdf_access_url(case_id: str) -> str | None:
        """
        Build a browser-accessible authenticated URL for latest case PDF in Cloudinary.
        Useful when stored delivery URLs return 401 for raw resources.
        """
        try:
            public_id = CloudinaryService.get_latest_case_pdf_public_id(case_id)
            if not public_id:
                return None

            download_public_id = public_id[:-4] if public_id.lower().endswith(".pdf") else public_id
            download_url = cloudinary.utils.private_download_url(
                download_public_id,
                "pdf",
                resource_type="raw",
                type="upload",
                attachment=False
            )
            return download_url
        except Exception as e:
            logger.error(f"Error building case PDF access URL for case_id={case_id}: {e}")
            return None

    @staticmethod
    def get_latest_case_pdf_public_id(case_id: str) -> str | None:
        """Returns latest Cloudinary raw public_id for a case PDF."""
        try:
            prefix = f"nyaysahayak/cases/{case_id}/"
            res = cloudinary.api.resources(
                resource_type="raw",
                type="upload",
                prefix=prefix,
                max_results=50
            )
            resources = res.get("resources", []) if isinstance(res, dict) else []
            if not resources:
                return None

            def _created_at(item: dict) -> str:
                return str(item.get("created_at") or "")

            latest = sorted(resources, key=_created_at, reverse=True)[0]
            public_id = str(latest.get("public_id") or "")
            return public_id or None
        except Exception as e:
            logger.error(f"Error finding latest case PDF public_id for case_id={case_id}: {e}")
            return None

    @staticmethod
    def download_case_pdf_bytes(case_id: str) -> tuple[bytes, str] | None:
        """
        Downloads latest case PDF server-side using Cloudinary signed private download URL.
        Returns bytes + filename for direct API streaming.
        """
        try:
            public_id = CloudinaryService.get_latest_case_pdf_public_id(case_id)
            if not public_id:
                return None

            download_public_id = public_id[:-4] if public_id.lower().endswith(".pdf") else public_id
            download_url = cloudinary.utils.private_download_url(
                download_public_id,
                "pdf",
                resource_type="raw",
                type="upload",
                attachment=False
            )

            with urllib.request.urlopen(download_url, timeout=25) as resp:
                pdf_bytes = resp.read()

            filename = public_id.split("/")[-1]
            if not filename.lower().endswith(".pdf"):
                filename = f"{filename}.pdf"

            return pdf_bytes, filename
        except Exception as e:
            logger.error(f"Error downloading case PDF bytes for case_id={case_id}: {e}")
            return None


def _esc(value) -> str:
    return html.escape("" if value is None else str(value))


def render_report_html(case_data: dict, answers: dict = None, question_labels: dict = None) -> str:
    """Structured legal report as print-ready HTML for Browserless."""
    data = case_data if isinstance(case_data, dict) else {}
    support_email = os.getenv("NYAYSAHAYAK_SUPPORT_EMAIL", "support@nyaysahayak.in")
    support_phone = os.getenv("NYAYSAHAYAK_SUPPORT_PHONE", "+91-1930 (Cyber Helpline)")
    support_website = os.getenv("NYAYSAHAYAK_SUPPORT_WEBSITE", "www.nyaysahayak.in")
    timestamp = datetime.now().strftime("%d %B %Y at %H:%M")
    location = data.get("location") if isinstance(data.get("location"), dict) else {}
    sections = data.get("statutory_sections") or []
    checklist = data.get("checklist") or []
    section_html = "".join(f"<li>{_esc(s)}</li>" for s in sections) or "<li>None listed</li>"
    checklist_html = "".join(f"<li>{_esc(item)}</li>" for item in checklist) or "<li>None listed</li>"
    answers_html = ""
    qa_rows = list(iter_qa_for_pdf(answers, question_labels, data))
    if qa_rows:
        qa = "".join(
            f"<p><strong>Q: {_esc(q)}</strong><br/>A: {_esc(a)}</p>"
            for q, a in qa_rows
        )
        answers_html = f"<h2>Additional information</h2>{qa}"
    loc_html = ""
    if location and location.get("city") not in (None, "", "Unknown"):
        loc_html = (
            "<h2>Location</h2>"
            f"<p>{_esc(location.get('city', 'N/A'))}, {_esc(location.get('state', 'N/A'))}</p>"
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>NyaySahayak Legal Case Report</title>
<style>
  body {{ font-family: Georgia, 'Times New Roman', serif; color: #1a202c; margin: 40px; line-height: 1.45; }}
  h1 {{ text-align: center; font-size: 22px; letter-spacing: 0.04em; margin-bottom: 4px; }}
  .sub {{ text-align: center; color: #4a5568; font-size: 13px; margin: 0 0 24px; }}
  h2 {{ font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #2d3748; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 8px 0 20px; }}
  th, td {{ border: 1px solid #cbd5e0; padding: 8px 10px; font-size: 13px; }}
  th {{ background: #edf2f7; text-align: right; width: 28%; }}
  .footer {{ margin-top: 36px; font-size: 11px; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 12px; }}
</style>
</head>
<body>
  <h1>LEGAL CASE REPORT</h1>
  <p class="sub">NyaySahayak AI Legal Assistant<br/>Contact: {_esc(support_email)} | {_esc(support_phone)} | {_esc(support_website)}</p>
  <p class="sub">Report generated: {_esc(timestamp)}</p>
  <h2>Case summary</h2>
  <table>
    <tr><th>Incident type</th><td>{_esc(data.get("incident_type", "General"))}</td></tr>
    <tr><th>Risk level</th><td>{_esc(data.get("risk_level", "Low"))}</td></tr>
    <tr><th>Criticality</th><td>{_esc(data.get("criticality", "Unknown"))}</td></tr>
    {f'<tr><th>Amount involved</th><td>{_esc(data.get("amount_involved"))}</td></tr>' if data.get("amount_involved") else ""}
    {f'<tr><th>Cognizable offense</th><td>Yes</td></tr>' if data.get("cognizable") else ""}
  </table>
  <h2>Detailed case summary</h2>
  <p>{_esc(data.get("summary") or "")}</p>
  <h2>Your statement</h2>
  <p>“{_esc(data.get("user_verbatim", data.get("summary", "N/A")))}”</p>
  {loc_html}
  <h2>Applicable laws</h2>
  <ul>{section_html}</ul>
  <h2>Recommended actions</h2>
  <ol>{checklist_html}</ol>
  {answers_html}
  <div class="footer">
    NyaySahayak Support | Email: {_esc(support_email)} | Phone: {_esc(support_phone)} | Web: {_esc(support_website)}<br/>
    This report is generated by NyaySahayak AI Legal Assistant and is for informational purposes only.
    Please consult with a qualified legal professional for specific legal advice.
  </div>
</body>
</html>"""


def _pdf_via_browserless(html_doc: str) -> bytes | None:
    api_key = (os.getenv("BROWSERLESS_API_KEY") or "").strip()
    if not api_key:
        return None
    base = (os.getenv("BROWSERLESS_URL") or "https://production-sfo.browserless.io/pdf").strip()
    parsed = urllib.parse.urlparse(base)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("token", api_key)
    url = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))
    payload = json.dumps({
        "html": html_doc,
        "options": {
            "format": "A4",
            "printBackground": True,
            "margin": {"top": "0.6in", "bottom": "0.6in", "left": "0.6in", "right": "0.6in"},
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            if body[:4] == b"%PDF":
                return body
            logger.warning("Browserless PDF response was not a PDF; falling back to ReportLab")
            return None
    except Exception as e:
        logger.warning(f"Browserless PDF failed, using ReportLab fallback: {e}")
        return None


def generate_and_upload_report_pdf(
    case_data: dict,
    case_id: str,
    user_id: str,
    answers: dict = None,
    question_labels: dict = None,
) -> dict:
    """
    Generate PDF from case data (Browserless HTML when configured, ReportLab otherwise)
    and upload to Cloudinary.
    """
    try:
        # Prefer explicit labels; also accept labels nested on case_data / situation_summary.
        labels = question_labels
        if not labels and isinstance(case_data, dict):
            labels = case_data.get("question_labels")
            if not labels:
                summary = case_data.get("situation_summary")
                if isinstance(summary, dict):
                    labels = summary.get("question_labels")
        html_doc = render_report_html(case_data or {}, answers, labels)
        pdf_bytes = _pdf_via_browserless(html_doc)
        if not pdf_bytes:
            pdf_gen = PDFGenerator()
            pdf_bytes = pdf_gen.generate_pdf(case_data, answers, labels)

        cloud_service = CloudinaryService()
        upload_result = cloud_service.upload_pdf(pdf_bytes, case_id, user_id)

        return upload_result

    except Exception as e:
        logger.error(f"Error generating/uploading PDF: {e}")
        return {
            "success": False,
            "error": str(e)
        }


def ensure_report_pdf_url(
    case_data: dict | None,
    case_id: str | None,
    user_id: str | None,
    answers: dict | None = None,
    existing_url: str | None = None,
    question_labels: dict | None = None,
) -> str | None:
    if existing_url:
        return existing_url
    if not case_id or not user_id or not isinstance(case_data, dict) or not case_data:
        return None
    result = generate_and_upload_report_pdf(
        case_data, str(case_id), str(user_id), answers, question_labels=question_labels
    )
    if result.get("success"):
        return result.get("url")
    return None

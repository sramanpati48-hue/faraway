# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary:** Indian citizens and residents facing legal uncertainty — cyber fraud, consumer disputes, workplace or domestic issues, tenancy, cheques, motor accidents, and similar everyday legal problems. They are often stressed, time-constrained, and unfamiliar with courts, police, or formal complaint processes.

**Secondary audiences (confirmed in product):**
- **Victims / general users** — chat-first guidance, case history, formalised case filing, document access, legal library.
- **Lawyers** — client cases, profile, assignment flows.
- **Nyay Guides / Sahayaks** — guided handoff, case review, intervention.
- **Moderators** — queue review for sensitive or escalated matters.
- **Admins** — CMS, SEO, RAG funnel, user management, AI model configuration.

## Product Purpose

NyaySahayak (also written Nyaysahayak) is an AI-powered legal companion that helps people **understand their rights**, **figure out practical next steps**, and **connect with verified human help** when automation is not enough.

Success means a user can: describe a situation in plain language, receive grounded guidance tied to Indian law and procedure, start or track a formalised case, and escalate to lawyers or Nyay Guides without losing context.

## Positioning

Unlike generic chatbots or static legal FAQ sites, NyaySahayak combines **agentic routing** (specialised agents for cyber, civil, domestic, scam, and document workflows), **RAG over Indian legal corpora**, **persistent case sessions**, and **human handoff** (moderators, Sahayaks, lawyers) in one product — oriented specifically to the Indian justice-access gap.

## Operating Context

- Users interact primarily through the **Next.js web app** (`web_app/`), with routes such as `/home` (workspace dashboard), `/cases` (AI chat workspace), `/my-cases`, `/find-help`, `/legal-rights`, `/documents`, and role-specific dashboards.
- Backend is **FastAPI + LangGraph** (`backend/`) with **PostgreSQL + pgvector** for persistence and retrieval.
- Real-time features use **WebSockets**; chat history and sessions sync to the backend.
- **India-specific** helplines and procedures are first-class (e.g. 112, 181, 1930, cybercrime.gov.in, NALSA) — see in-app urgent-help content in `web_app/lib/home/mockData.ts` and sidebar.
- Dev entry: `cd web_app && npm run dev` (port 3000); API at `http://localhost:8000`.

## Capabilities and Constraints

**Confirmed capabilities:**
- Multi-agent legal chat with streaming responses and session history.
- Case sidebar, search, rename, share, delete; home dashboard and cases workspace.
- Formalised case tracking, PDF generation (Cloudinary when configured).
- Find legal help (lawyers, guides), legal library / rights content, documents.
- Clash mode (practice courtroom / real-life case scenarios).
- Admin panel for content, SEO, embeddings, RAG funnel, users.
- Auth with role-based routing (victim, lawyer, sahayak, moderator, admin).

**Constraints:**
- Not a substitute for licensed legal representation; product copy frames guidance and navigation, not guaranteed outcomes.
- Grounding quality depends on ingested legal corpus and configured LLM/embeddings.
- Open-source / self-hosted deployment; external service keys required for full functionality (see `docs/PROJECT_OVERVIEW.md`, `.env.example`).

**Terminology:** *Case* (chat session or formalised matter), *Nyay Guide* / *Sahayak* (human guides), *formalised case* (tracked complaint/filing workflow).

## Brand Commitments

- **Name:** NyaySahayak / Nyaysahayak (logo asset: `web_app/public/2.png`).
- **Tagline (in-app fallback):** “Legal help for all” (sidebar); “Justice made accessible for every Indian” (about fallback).
- **Primary brand color:** `#00634B` (emerald green), with supporting neutrals and amber for urgent help.
- **Voice (from product UI):** Empathetic, plain-language, action-oriented — e.g. “You deserve to be heard”; help users understand rights and next steps without hype.
- **Typography (current victim workspace — incumbent, not binding for all future surfaces):** Instrument Serif for key headlines; DM Sans for UI body and sidebar.

## Evidence on Hand

| Asset | Location / notes |
|-------|------------------|
| Product & architecture docs | `README.md`, `docs/CODEBASE.md`, `docs/PROJECT_OVERVIEW.md` |
| About / mission copy (API + fallback) | `web_app/app/(dashboard)/about/page.tsx` |
| Urgent helplines, mock case data | `web_app/lib/home/mockData.ts` |
| Logo & marketing images | `web_app/public/` |
| CMS-driven about content | `GET /api/content/about` |

**Do not fabricate:** customer testimonials, live user counts beyond CMS/admin data, lawyer roster sizes except where CMS/about API provides them, court outcomes, or pricing/licensing claims not present in repo.

## Product Principles

1. **Meet people where they are** — plain language, voice-friendly chat, mobile-aware shell; assume stress and low legal literacy.
2. **Ground before you guide** — prefer RAG and Indian procedural facts over generic LLM advice.
3. **Persist the story** — sessions, cases, and handoffs must not lose user context.
4. **Human when it matters** — escalate to moderators, Sahayaks, and lawyers for sensitive or high-stakes paths.
5. **Accessible justice, not performative UI** — clarity and trust over decorative “legal tech” tropes.

## Accessibility & Inclusion

- Multi-language support is a stated product goal (about fallback: 3 languages); implementation depth **undecided in repo** — verify before claiming full i18n coverage.
- Urgent helplines and sensitive flows (e.g. domestic violence templates) require calm, readable UI and careful copy; no product-specific WCAG certification documented — treat **operate-mode** surfaces as needing strong contrast, keyboard paths, and screen-reader-friendly labels as work proceeds.

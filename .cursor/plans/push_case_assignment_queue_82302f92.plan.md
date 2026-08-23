---
name: Push case assignment queue
overview: "Replace the DB webhook poller with push-on-create assignment: maintain online moderator/sahayak queues, notify a ranked top-3 set via WebSocket, and ensure case location comes from GPS or a supervisor area ask (LLM-normalized) so it shows in admin graph state and cases chat."
todos:
  - id: kill-poller-dispatcher
    content: Remove WebhookPoller startup; add case_dispatcher that pushes on create_intervention / forward_case_to_sahayak
    status: completed
  - id: presence-queue
    content: Extend websocket_manager + dashboards for uid presence; send identity on connect; targeted send_to_uids
    status: completed
  - id: schema-ranked-notify
    content: "Migration: sahayak state/city, case location + notified_user_ids; top-3 ranking + claim broadcast"
    status: completed
  - id: supervisor-location
    content: GPS path + supervisor area ask; LLM normalize + geocode_area_name; unify state.location
    status: completed
  - id: ui-reflect-location
    content: Show location in ChatInterface, LangGraphTester inspector/Supervisor badge, AdminCasesPanel sahayak cases
    status: completed
  - id: dashboard-catchup
    content: Change moderator/sahayak REST initial load to notified/assigned-to-me only (no global pending fetch)
    status: completed
isProject: false
---

# Push Case Assignment + Location Intake

## Problem

[`backend/webhook_poller.py`](backend/webhook_poller.py) polls pending rows every 15s and fan-outs to global `moderator` / `sahayak` WebSocket channels. On every reload it rebroadcasts all pending cases (the logs you saw). Dashboards also REST-fetch the full pending queue. Sahayak “nearby” copy is fake — no geo filter. Location is GPS-only; supervisor never asks for area if permission is denied.

## Target flow

```mermaid
sequenceDiagram
  participant Victim as ChatUI
  participant Sup as Supervisor
  participant Create as ModeratorOrSahayakAgent
  participant Queue as PresenceQueue
  participant WS as WebSocketManager

  Victim->>Sup: query + location or null
  alt GPS missing
    Sup->>Victim: ask area name
    Victim->>Sup: e.g. "Rohini, Delhi"
    Sup->>Sup: LLM normalize to city/state (+ geocode)
  end
  Sup->>Create: route with state.location filled
  Create->>Create: persist case + location
  Create->>Queue: pick top3 available matches
  Queue->>WS: push case_assigned to those uids
  Note over WS: No poller; recipients do not discover via global fetch
```

**Locked decisions**
- Notify a ranked set of up to **3** available recipients; **first accept still claims**.
- Moderators: rank among **currently online** moderators (least open caseload, then connect time).
- Sahayaks: rank among **currently online** guides whose profile area matches victim **state/city** (fallback: free-text `location` ILIKE).
- Location: browser GPS first; if denied/absent, supervisor blocks routing until area is collected and LLM-filled.

---

## 1. Kill the poller; push on create

- Stop starting [`poller`](backend/main.py) in FastAPI lifespan; leave [`webhook_poller.py`](backend/webhook_poller.py) unused or delete after cutover.
- Add a small dispatcher (e.g. `backend/case_dispatcher.py`) used immediately after:
  - [`create_intervention_case`](backend/database/postgres_db.py) in [`legal_moderator.py`](backend/agents/legal_moderator.py)
  - [`forward_case_to_sahayak`](backend/database/postgres_db.py) in [`sahayak_agent.py`](backend/agents/sahayak_agent.py)
- Dispatcher builds the existing payload shapes (`new_intervention` / `new_sahayak_case`) and pushes only to selected recipient channels (not global `sahayak` / `moderator` fan-out).
- Persist who was notified (new jsonb column `notified_user_ids text[]` on `interventions` and `sahayak_cases`) so reconnect catch-up can be targeted.

---

## 2. Presence / availability queue

Extend [`websocket_manager.py`](backend/websocket_manager.py):

- On connect to `/ws/moderator` and `/ws/sahayak`, require (or accept as first message) `{uid, role, state?, city?}` and register in an in-memory presence map.
- Track: `uid → {websocket, role, state, city, connected_at, open_cases}`.
- On disconnect, remove from queue.
- Add helpers: `list_online(role)`, `send_to_uids(uids, message)`.

Frontend ([`LegalModeratorDashboard.tsx`](web_app/components/dashboard/LegalModeratorDashboard.tsx), [`sahayak/page.tsx`](web_app/app/(dashboard)/sahayak/page.tsx)):

- After WS open, send identity payload with uid + profile area.
- Keep handling `new_intervention` / `new_sahayak_case`, but discovery is push-only.
- Change initial REST load from “all pending” to “pending notified to me / assigned to me” (new query params or endpoints). No client polling interval for case discovery.

---

## 3. Ranked assignment (top 3)

In dispatcher:

**Moderators:** take online moderators, sort by fewest open pending interventions they were notified for / are handling, take 3, push, store `notified_user_ids`.

**Sahayaks:** filter online sahayaks where profile `state` (new column) or `location` text matches victim `state`/`city` from case location; sort by rating then open caseload; take 3; push; store `notified_user_ids`. If fewer than 3 in-area online, fill remaining from other online sahayaks only if zero in-area matches (so area preference is real, not empty).

Keep existing accept/resolve APIs; optionally reject accept if caller not in `notified_user_ids` (except admin). When accepted, broadcast `case_claimed` to the other notified uids so their UI drops it.

Schema migration (new file under `backend/database/migrations/`):

- `sahayak_profiles`: add `state text`, `city text` (backfill later from free-text `location` where possible).
- `sahayak_cases`: add `location jsonb`, `notified_user_ids text[]`.
- `interventions`: add `notified_user_ids text[]`.
- Optional: `cases.location jsonb` for chat/admin case list consistency (or read from `structured_report.location` only — prefer writing top-level `cases.location` if cases rows are updated on report).

---

## 4. Location intake (GPS + supervisor area ask)

**Chat UI** — [`ChatInterface.tsx`](web_app/components/chat/ChatInterface.tsx):

- Keep `getCurrentPosition`; on deny/error set an explicit `locationDenied` flag and still send `location: null`.
- When backend returns resolved location (or after area answer), show a compact location line in the cases chat header/thread (city, state) so the victim sees what was captured.

**Supervisor** — [`agent_graph.py`](backend/agent_graph.py) `supervisor_agent`:

- Before routing to specialists/moderator/sahayak: resolve effective location from `user_details.location` (GPS) or existing `state.location`.
- If missing: set `awaiting_user_input` + prompt asking for area (city/district + state), do not route yet. Mirror existing clarify / question-pause patterns.
- On next turn with pending location ask: LLM extracts `{city, state, area}`; forward-geocode area string via Nominatim (extend [`common_utils.py`](backend/agents/common_utils.py) with `geocode_area_name` + make `get_user_location_context` accept city/state-only without requiring lat/lon).
- Write normalized `{city, state, lat?, lon?, source: "gps"|"user_area"}` into both `state.location` and `user_details.location`, then continue normal routing.

**Downstream consistency:**

- [`legal_moderator.py`](backend/agents/legal_moderator.py): fall back `state.get("location") or user_details.get("location") or structured_report.get("location")`.
- [`sahayak_agent.py`](backend/agents/sahayak_agent.py): pass location into `forward_case_to_sahayak`; filter recommended profiles by area; push via dispatcher.
- [`report_agent.py`](backend/agents/report_agent.py): reuse the same normalized location object (no duplicate reverse-geocode when city/state already present).

---

## 5. Reflect location on admin graph + cases chat

**Admin React Flow** — [`LangGraphTester.tsx`](web_app/components/admin/LangGraphTester.tsx):

- Pass `initial_state.location` / `user_details.location` into `adminApi.createRun` when testing (and honor seed presets that already include location).
- Surface `location` from checkpoint / `final_state` in the node inspector (and a small badge on the Supervisor node when present) so the pane you pointed at shows area alongside VISITED timing.

**Cases chat / admin cases:**

- Chat: show complainant location chip when `structured_report.location` or stream event includes it.
- [`AdminCasesPanel.tsx`](web_app/components/admin/AdminCasesPanel.tsx) already shows intervention `location`; ensure sahayak case detail reads the new `sahayak_cases.location` the same way.

---

## 6. Cleanup

- Remove poller startup + docs that prescribe 5–15s polling ([`docs/WEBHOOK_POLLER_GUIDE.md`](docs/WEBHOOK_POLLER_GUIDE.md), [`docs/CODEBASE.md`](docs/CODEBASE.md) § webhook poller) only if you want docs updated in the same change; otherwise a short note that push-on-create replaced it.
- Keep legacy Supabase webhook broadcast path in `main.py` only if still needed; prefer routing it through the same dispatcher so behavior stays one path.

---

## Out of scope

- Mobile FCM/APNs (web WS presence only).
- Multi-worker shared presence (still in-process; same limitation as today’s WS manager — document it).
- Auto-assign exclusive ownership without accept (first-accept claim remains).

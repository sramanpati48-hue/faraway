import asyncio
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # channel (e.g. 'moderator', uid) → open sockets
        self.active_channels: Dict[str, List[WebSocket]] = {}
        # presence: uid → metadata for available moderators / sahayaks
        self.presence: Dict[str, Dict[str, Any]] = {}
        # websocket → uid for cleanup
        self._socket_uid: Dict[WebSocket, str] = {}
        # Main FastAPI event loop — set on first connect so sync threads can schedule sends
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None

    def _remember_loop(self):
        try:
            self._main_loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def _schedule(self, coro):
        """Schedule a coroutine on the FastAPI loop from sync or async contexts."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
            return
        except RuntimeError:
            pass
        loop = self._main_loop
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, loop)
            return
        try:
            asyncio.run(coro)
        except Exception as e:
            print(f"⚠️ Failed to schedule websocket send: {e}")

    async def connect(self, websocket: WebSocket, channel: str = "default"):
        await websocket.accept()
        self._remember_loop()
        if channel not in self.active_channels:
            self.active_channels[channel] = []
        self.active_channels[channel].append(websocket)
        try:
            print(
                f"WebSocket connected to channel '{channel}'. "
                f"Total in channel: {len(self.active_channels[channel])}"
            )
        except Exception:
            pass

    def disconnect(self, websocket: WebSocket, channel: str = "default"):
        if channel in self.active_channels and websocket in self.active_channels[channel]:
            self.active_channels[channel].remove(websocket)
            try:
                print(
                    f"WebSocket disconnected from channel '{channel}'. "
                    f"Total in channel: {len(self.active_channels[channel])}"
                )
            except Exception:
                pass
        uid = self._socket_uid.pop(websocket, None)
        if uid and self.presence.get(uid, {}).get("websocket") is websocket:
            self.presence.pop(uid, None)
            print(f"👋 Presence cleared for uid '{uid}'")

    def register_presence(
        self,
        websocket: WebSocket,
        *,
        uid: str,
        role: str,
        state: Optional[str] = None,
        city: Optional[str] = None,
        open_cases: int = 0,
    ):
        if not uid:
            return
        prev = self.presence.get(uid)
        if prev and prev.get("websocket") and prev["websocket"] is not websocket:
            self._socket_uid.pop(prev["websocket"], None)
        self.presence[uid] = {
            "uid": uid,
            "role": (role or "").strip().lower(),
            "state": (state or "").strip(),
            "city": (city or "").strip(),
            "connected_at": time.time(),
            "open_cases": int(open_cases or 0),
            "websocket": websocket,
        }
        self._socket_uid[websocket] = uid
        print(f"✅ Presence registered: uid={uid} role={role} state={state} city={city}")

    def update_open_cases(self, uid: str, open_cases: int):
        if uid in self.presence:
            self.presence[uid]["open_cases"] = int(open_cases or 0)

    def list_online(self, role: str) -> List[Dict[str, Any]]:
        role_l = (role or "").strip().lower()
        aliases = {role_l}
        if role_l == "sahayak":
            aliases |= {"guide", "nyay_guide", "sahayak"}
        out = []
        for entry in self.presence.values():
            if entry.get("role") in aliases:
                out.append(
                    {
                        "uid": entry["uid"],
                        "role": entry["role"],
                        "state": entry.get("state") or "",
                        "city": entry.get("city") or "",
                        "connected_at": entry.get("connected_at") or 0,
                        "open_cases": int(entry.get("open_cases") or 0),
                    }
                )
        return out

    async def broadcast(self, message: str, channel: Optional[str] = None):
        """Send to all clients on a channel (or all channels if channel is None)."""
        channels_to_broadcast = [channel] if channel else list(self.active_channels.keys())

        for ch in channels_to_broadcast:
            if ch not in self.active_channels:
                continue
            disconnected_clients = []
            for connection in self.active_channels[ch]:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    print(f"⚠️ Error broadcasting to websocket client on channel '{ch}': {e}")
                    disconnected_clients.append(connection)

            for client in disconnected_clients:
                self.disconnect(client, ch)

    async def send_to_uids(self, uids: List[str], message: str):
        """Push a message to specific online users (by presence uid channel + personal channel)."""
        seen: set = set()
        for uid in uids or []:
            if not uid or uid in seen:
                continue
            seen.add(uid)
            entry = self.presence.get(uid)
            sockets: List[WebSocket] = []
            if entry and entry.get("websocket"):
                sockets.append(entry["websocket"])
            # Also send on personal uid channel if any
            for sock in self.active_channels.get(uid, []) or []:
                if sock not in sockets:
                    sockets.append(sock)
            for connection in sockets:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    print(f"⚠️ Error sending to uid '{uid}': {e}")
                    role = (entry or {}).get("role") or "default"
                    channel = "moderator" if role == "moderator" else "sahayak" if role in {
                        "sahayak", "guide", "nyay_guide"
                    } else uid
                    self.disconnect(connection, channel)

    def broadcast_sync(self, data: Dict[str, Any], channel: Optional[str] = None):
        """Schedule async broadcast from sync agent threads."""
        message = json.dumps(data, default=str)
        self._schedule(self.broadcast(message, channel))

    def send_to_uids_sync(self, uids: List[str], data: Dict[str, Any]):
        """Schedule targeted push from sync agent threads."""
        message = json.dumps(data, default=str)
        self._schedule(self.send_to_uids(uids, message))


manager = ConnectionManager()

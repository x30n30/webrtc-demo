"""
WebSocket signaling server — multi-peer edition.

Protocol changes vs 2-peer original:
  join        → server replies {type:"welcome", peerId, peers:[{peerId,name}]}
                all existing peers receive {type:"peer-joined", peerId, name}
  offer/answer/ice-candidate  must carry "to": peerId
                server stamps "from": peerId and forwards
  disconnect  → all remaining peers receive {type:"peer-left", peerId, name}
  No room-size limit.

Backwards-compat messages kept:
  list-rooms, peek, clear-room
"""

import asyncio
import json
import os
import uuid
import websockets
import websockets.exceptions


def make_handler():
    """Return a fresh (rooms, handler) pair — isolated rooms dict per call."""
    rooms: dict = {}

    async def handler(ws):
        room_id = None
        peer_id = None
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                # ── Utility messages (no room membership required) ──────────

                if msg_type == "list-rooms":
                    await _send(ws, {
                        "type": "rooms-list",
                        "rooms": [
                            {"name": r, "count": len(e), "names": [x["name"] for x in e]}
                            for r, e in rooms.items() if e
                        ],
                    })
                    continue

                if msg_type == "peek":
                    r = msg.get("room", "default")
                    entries = rooms.get(r, [])
                    await _send(ws, {
                        "type": "room-status",
                        "count": len(entries),
                        "names": [e["name"] for e in entries],
                    })
                    continue

                if msg_type == "clear-room":
                    r = msg.get("room", "default")
                    entries = rooms.pop(r, [])
                    for entry in entries:
                        await _send(entry["ws"], {"type": "room-cleared"})
                        await entry["ws"].close()
                    continue

                # ── Join ────────────────────────────────────────────────────

                if msg_type == "join":
                    room_id = msg["room"]
                    name = msg.get("name", "Anonymous")
                    peer_id = str(uuid.uuid4())

                    existing = rooms.get(room_id, [])

                    # Tell new peer their ID and who is already in the room
                    await _send(ws, {
                        "type": "welcome",
                        "peerId": peer_id,
                        "peers": [{"peerId": e["peerId"], "name": e["name"]} for e in existing],
                    })

                    # Notify every existing peer about the newcomer
                    for entry in existing:
                        await _send(entry["ws"], {
                            "type": "peer-joined",
                            "peerId": peer_id,
                            "name": name,
                        })

                    if room_id not in rooms:
                        rooms[room_id] = []
                    rooms[room_id].append({"ws": ws, "name": name, "peerId": peer_id})
                    continue

                # ── Routed signaling (offer / answer / ice-candidate) ───────

                if msg_type in ("offer", "answer", "ice-candidate"):
                    to_id = msg.get("to")
                    target_ws = _get_peer_by_id(to_id, room_id, rooms)
                    if target_ws is None:
                        continue

                    payload = {"type": msg_type, "from": peer_id}
                    if msg_type in ("offer", "answer"):
                        payload["sdp"] = msg["sdp"]
                    else:
                        payload["candidate"] = msg["candidate"]

                    await _send(target_ws, payload)

        finally:
            if room_id is not None and peer_id is not None:
                peers = rooms.get(room_id, [])
                my_entry = next((e for e in peers if e["peerId"] == peer_id), None)
                remaining = [e for e in peers if e["peerId"] != peer_id]

                if not remaining:
                    rooms.pop(room_id, None)
                else:
                    rooms[room_id] = remaining
                    left_name = my_entry["name"] if my_entry else "Anonymous"
                    for entry in remaining:
                        await _send(entry["ws"], {
                            "type": "peer-left",
                            "peerId": peer_id,
                            "name": left_name,
                        })

    return rooms, handler


async def start_server(port: int):
    """Start a pure WebSocket signaling server (used by tests and standalone)."""
    _rooms, handler = make_handler()
    server = await websockets.serve(handler, "localhost", port)
    return server


def _get_peer_by_id(peer_id, room_id, rooms):
    if peer_id is None or room_id is None:
        return None
    for entry in rooms.get(room_id, []):
        if entry["peerId"] == peer_id:
            return entry["ws"]
    return None


async def _send(ws, msg):
    try:
        await ws.send(json.dumps(msg))
    except websockets.exceptions.ConnectionClosed:
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))

    async def main():
        server = await start_server(port)
        print(f"Signaling server listening on ws://localhost:{port}")
        await server.wait_closed()

    asyncio.run(main())

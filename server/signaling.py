"""
WebSocket signaling server — asyncio port of signaling.js.

rooms: dict[roomId, list[{"ws": ws, "name": str}]]  — max 2 peers per room
"""

import asyncio
import json
import os
import websockets
import websockets.exceptions


def make_handler():
    """Return a fresh (rooms, handler) pair.

    Each call gets its own isolated rooms dict — used by http_server and tests.
    """
    rooms: dict = {}

    async def handler(ws):
        room_id = None
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

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

                if msg_type == "join":
                    room_id = msg["room"]
                    name = msg.get("name", "Anonymous")
                    if room_id not in rooms:
                        rooms[room_id] = [{"ws": ws, "name": name}]
                    else:
                        peers = rooms[room_id]
                        if len(peers) >= 2:
                            await _send(ws, {"type": "room-full"})
                            continue
                        peers.append({"ws": ws, "name": name})
                        await _send(peers[0]["ws"], {"type": "peer-joined", "name": name})
                        await _send(ws, {"type": "peer-info", "name": peers[0]["name"]})
                    continue

                peer = _get_other_peer(ws, room_id, rooms)
                if peer is None:
                    continue

                if msg_type == "offer":
                    await _send(peer, {"type": "offer", "sdp": msg["sdp"]})
                elif msg_type == "answer":
                    await _send(peer, {"type": "answer", "sdp": msg["sdp"]})
                elif msg_type == "ice-candidate":
                    await _send(peer, {"type": "ice-candidate", "candidate": msg["candidate"]})

        finally:
            if room_id is not None:
                peers = rooms.get(room_id)
                if peers:
                    my_entry = next((e for e in peers if e["ws"] is ws), None)
                    remaining = [e for e in peers if e["ws"] is not ws]
                    if not remaining:
                        del rooms[room_id]
                    else:
                        rooms[room_id] = remaining
                        left_name = my_entry["name"] if my_entry else "Anonymous"
                        await _send(remaining[0]["ws"], {"type": "peer-left", "name": left_name})

    return rooms, handler


async def start_server(port: int):
    """Start a pure WebSocket signaling server (used by tests and standalone)."""
    _rooms, handler = make_handler()
    server = await websockets.serve(handler, "localhost", port)
    return server


def _get_other_peer(ws, room_id, rooms):
    if room_id is None:
        return None
    peers = rooms.get(room_id)
    if not peers:
        return None
    for entry in peers:
        if entry["ws"] is not ws:
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

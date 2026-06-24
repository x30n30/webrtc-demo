"""
WebSocket signaling server — asyncio port of signaling.js.

rooms: dict[roomId, list[websocket]]  — max 2 peers per room
"""

import asyncio
import json
import os
import websockets
import websockets.exceptions


async def start_server(port: int):
    """Start a pure WebSocket signaling server (used by tests and production).

    Each call gets its own rooms dict, so multiple servers can run independently.
    Returns the websockets Server object; caller can read
    server.sockets[0].getsockname()[1] for the bound port when port=0.
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

                if msg_type == "join":
                    room_id = msg["room"]
                    if room_id not in rooms:
                        rooms[room_id] = [ws]
                    else:
                        peers = rooms[room_id]
                        if len(peers) >= 2:
                            await _send(ws, {"type": "room-full"})
                            continue
                        peers.append(ws)
                        await _send(peers[0], {"type": "peer-joined"})
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
                    remaining = [p for p in peers if p is not ws]
                    if not remaining:
                        del rooms[room_id]
                    else:
                        rooms[room_id] = remaining
                        await _send(remaining[0], {"type": "peer-left"})

    server = await websockets.serve(handler, "localhost", port)
    return server


def _get_other_peer(ws, room_id, rooms):
    if room_id is None:
        return None
    peers = rooms.get(room_id)
    if not peers:
        return None
    for p in peers:
        if p is not ws:
            return p
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

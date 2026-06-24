"""
Signaling server tests — direct port of signaling.test.js (8 tests).

Each test gets a fresh server on an OS-assigned port via the `server`
fixture.  Real WebSocket connections are used; no mocking.
"""

import asyncio
import json
import pytest
import websockets

from server.signaling import start_server


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
async def server():
    srv = await start_server(0)
    port = srv.sockets[0].getsockname()[1]
    yield srv, port
    srv.close()
    await srv.wait_closed()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def connect(port):
    return await websockets.connect(f"ws://localhost:{port}")


async def next_message(ws):
    raw = await ws.recv()
    return json.loads(raw)


async def send_msg(ws, msg):
    await ws.send(json.dumps(msg))


# ── Tests ─────────────────────────────────────────────────────────────────────

# Test 1
async def test_server_starts_and_accepts_connection(server):
    srv, port = server
    ws = await connect(port)
    # Connection succeeded — state should be OPEN (websockets 16.x uses .state.name)
    assert ws.state.name == "OPEN"
    await ws.close()


# Test 2
async def test_first_client_joining_receives_no_immediate_message(server):
    srv, port = server
    ws = await connect(port)
    await send_msg(ws, {"type": "join", "room": "test-room"})

    msg = None
    try:
        msg = await asyncio.wait_for(next_message(ws), timeout=0.2)
    except asyncio.TimeoutError:
        pass

    assert msg is None
    await ws.close()


# Test 3
async def test_second_client_joining_triggers_peer_joined(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-a"})
    pending = asyncio.create_task(next_message(ws1))
    await send_msg(ws2, {"type": "join", "room": "room-a"})

    msg = await pending
    assert msg["type"] == "peer-joined"
    await ws1.close()
    await ws2.close()


# Test 4
async def test_third_client_receives_room_full(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-b"})
    await send_msg(ws2, {"type": "join", "room": "room-b"})
    await next_message(ws1)  # consume peer-joined

    pending = asyncio.create_task(next_message(ws3))
    await send_msg(ws3, {"type": "join", "room": "room-b"})
    msg = await pending
    assert msg["type"] == "room-full"

    await ws1.close()
    await ws2.close()
    await ws3.close()


# Test 5
async def test_offer_forwarded_to_peer(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-c"})
    await send_msg(ws2, {"type": "join", "room": "room-c"})
    await next_message(ws1)  # consume peer-joined
    await next_message(ws2)  # consume peer-info

    pending = asyncio.create_task(next_message(ws2))
    await send_msg(ws1, {"type": "offer", "sdp": {"type": "offer", "sdp": "fake-sdp"}})
    msg = await pending
    assert msg["type"] == "offer"
    assert msg["sdp"]["sdp"] == "fake-sdp"

    await ws1.close()
    await ws2.close()


# Test 6
async def test_answer_forwarded_to_peer(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-d"})
    await send_msg(ws2, {"type": "join", "room": "room-d"})
    await next_message(ws1)  # consume peer-joined

    pending = asyncio.create_task(next_message(ws1))
    await send_msg(ws2, {"type": "answer", "sdp": {"type": "answer", "sdp": "fake-answer"}})
    msg = await pending
    assert msg["type"] == "answer"
    assert msg["sdp"]["sdp"] == "fake-answer"

    await ws1.close()
    await ws2.close()


# Test 7
async def test_ice_candidate_forwarded_to_peer(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-e"})
    await send_msg(ws2, {"type": "join", "room": "room-e"})
    await next_message(ws1)  # consume peer-joined
    await next_message(ws2)  # consume peer-info

    pending = asyncio.create_task(next_message(ws2))
    await send_msg(ws1, {"type": "ice-candidate", "candidate": {"candidate": "fake-ice"}})
    msg = await pending
    assert msg["type"] == "ice-candidate"
    assert msg["candidate"]["candidate"] == "fake-ice"

    await ws1.close()
    await ws2.close()


# Test 8
async def test_client_disconnect_triggers_peer_left(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-f"})
    await send_msg(ws2, {"type": "join", "room": "room-f"})
    await next_message(ws1)  # consume peer-joined

    pending = asyncio.create_task(next_message(ws1))
    await ws2.close()
    msg = await pending
    assert msg["type"] == "peer-left"

    await ws1.close()


# Test 9
async def test_list_rooms_returns_active_rooms(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-listed", "name": "Alice"})

    pending = asyncio.create_task(next_message(ws2))
    await send_msg(ws2, {"type": "list-rooms"})
    msg = await pending

    assert msg["type"] == "rooms-list"
    assert len(msg["rooms"]) == 1
    assert msg["rooms"][0]["name"] == "room-listed"
    assert msg["rooms"][0]["count"] == 1
    assert "Alice" in msg["rooms"][0]["names"]

    await ws1.close()
    await ws2.close()


# Test 10 (was 9)
async def test_list_rooms_empty_when_no_rooms(server):
    srv, port = server
    ws = await connect(port)

    pending = asyncio.create_task(next_message(ws))
    await send_msg(ws, {"type": "list-rooms"})
    msg = await pending

    assert msg["type"] == "rooms-list"
    assert msg["rooms"] == []

    await ws.close()


# Test 11 (was 10)
async def test_peer_joined_includes_joining_peers_name(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-g", "name": "Alice"})
    pending = asyncio.create_task(next_message(ws1))
    await send_msg(ws2, {"type": "join", "room": "room-g", "name": "Bob"})

    msg = await pending
    assert msg["type"] == "peer-joined"
    assert msg["name"] == "Bob"

    await ws1.close()
    await ws2.close()


# Test 10
async def test_peek_empty_room_returns_zero_count(server):
    srv, port = server
    ws = await connect(port)

    pending = asyncio.create_task(next_message(ws))
    await send_msg(ws, {"type": "peek", "room": "empty-room"})

    msg = await pending
    assert msg["type"] == "room-status"
    assert msg["count"] == 0
    assert msg["names"] == []

    await ws.close()


# Test 11
async def test_peek_room_with_one_peer_returns_name(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-h", "name": "Alice"})

    pending = asyncio.create_task(next_message(ws2))
    await send_msg(ws2, {"type": "peek", "room": "room-h"})

    msg = await pending
    assert msg["type"] == "room-status"
    assert msg["count"] == 1
    assert "Alice" in msg["names"]

    await ws1.close()
    await ws2.close()


# Test 12
async def test_join_without_name_defaults_to_anonymous(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-i"})
    pending = asyncio.create_task(next_message(ws1))
    await send_msg(ws2, {"type": "join", "room": "room-i"})

    msg = await pending
    assert msg["type"] == "peer-joined"
    assert msg["name"] == "Anonymous"

    await ws1.close()
    await ws2.close()


# Test 13
async def test_clear_room_sends_room_cleared_to_peers(server):
    srv, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    await send_msg(ws1, {"type": "join", "room": "room-j", "name": "Alice"})
    await send_msg(ws2, {"type": "join", "room": "room-j", "name": "Bob"})
    await next_message(ws1)  # consume peer-joined

    pending = asyncio.create_task(next_message(ws1))
    await send_msg(ws3, {"type": "clear-room", "room": "room-j"})
    msg = await pending
    assert msg["type"] == "room-cleared"

    await ws3.close()

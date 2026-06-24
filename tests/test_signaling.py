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

"""
Multi-peer signaling tests.

New protocol vs 2-peer original:
  - join  → server replies with {type:"welcome", peerId, peers:[{peerId,name}]}
  - existing peers receive {type:"peer-joined", peerId, name}
  - offer/answer/ice-candidate carry  "to": peerId  and server stamps "from": peerId
  - disconnect → all remaining peers receive {type:"peer-left", peerId, name}
  - no room-size limit
"""

import asyncio
import json
import pytest
import websockets

from server.signaling import start_server


# ── Fixtures ──────────────────────────────────────────────────────────────────

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

async def recv(ws):
    return json.loads(await ws.recv())

async def send(ws, msg):
    await ws.send(json.dumps(msg))

async def join(ws, room, name="Anon"):
    await send(ws, {"type": "join", "room": room, "name": name})
    return await recv(ws)          # welcome


# ── Tests ─────────────────────────────────────────────────────────────────────

# 1. First joiner gets welcome with their peerId and empty peer list
async def test_first_join_receives_welcome(server):
    _, port = server
    ws = await connect(port)
    welcome = await join(ws, "r1", "Alice")

    assert welcome["type"] == "welcome"
    assert "peerId" in welcome
    assert welcome["peerId"] != ""
    assert welcome["peers"] == []
    await ws.close()


# 2. Second joiner gets welcome with first peer already listed
async def test_second_join_welcome_includes_first_peer(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    w1 = await join(ws1, "r2", "Alice")
    # consume peer-joined on ws1 before reading ws2's welcome
    task = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r2", "Bob")
    await task  # peer-joined on ws1

    assert w2["type"] == "welcome"
    assert len(w2["peers"]) == 1
    assert w2["peers"][0]["peerId"] == w1["peerId"]
    assert w2["peers"][0]["name"] == "Alice"
    await ws1.close(); await ws2.close()


# 3. Existing peer receives peer-joined with new peer's peerId and name
async def test_existing_peer_receives_peer_joined(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    await join(ws1, "r3", "Alice")
    task = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r3", "Bob")
    pj = await task

    assert pj["type"] == "peer-joined"
    assert pj["peerId"] == w2["peerId"]
    assert pj["name"] == "Bob"
    await ws1.close(); await ws2.close()


# 4. Third peer join: both existing peers get peer-joined
async def test_third_join_notifies_all_existing_peers(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    await join(ws1, "r4", "Alice")
    t1 = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r4", "Bob")
    await t1  # peer-joined(Bob) on ws1

    t1 = asyncio.create_task(recv(ws1))
    t2 = asyncio.create_task(recv(ws2))
    w3 = await join(ws3, "r4", "Carol")
    pj1 = await t1
    pj2 = await t2

    assert pj1["type"] == "peer-joined"
    assert pj1["peerId"] == w3["peerId"]
    assert pj2["type"] == "peer-joined"
    assert pj2["peerId"] == w3["peerId"]
    await ws1.close(); await ws2.close(); await ws3.close()


# 5. Third peer welcome lists both existing peers
async def test_third_join_welcome_lists_all_existing_peers(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    w1 = await join(ws1, "r5", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r5", "Bob")
    await t

    t1 = asyncio.create_task(recv(ws1))
    t2 = asyncio.create_task(recv(ws2))
    w3 = await join(ws3, "r5", "Carol")
    await t1; await t2

    peer_ids = {p["peerId"] for p in w3["peers"]}
    assert w1["peerId"] in peer_ids
    assert w2["peerId"] in peer_ids
    assert len(w3["peers"]) == 2
    await ws1.close(); await ws2.close(); await ws3.close()


# 6. Four peers can join — no room limit
async def test_four_peers_can_join(server):
    _, port = server
    clients = [await connect(port) for _ in range(4)]
    peer_ids = []

    for i, ws in enumerate(clients):
        # drain peer-joined messages before joining
        tasks = [asyncio.create_task(recv(c)) for c in clients[:i]]
        w = await join(ws, "r6", f"Peer{i}")
        peer_ids.append(w["peerId"])
        for t in tasks:
            await t

    assert len(set(peer_ids)) == 4   # all IDs unique
    for ws in clients:
        await ws.close()


# 7. Offer is routed to the peer specified by "to" field, stamped with "from"
async def test_offer_routed_by_peer_id(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    w1 = await join(ws1, "r7", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r7", "Bob")
    await t  # peer-joined

    pending = asyncio.create_task(recv(ws2))
    await send(ws1, {"type": "offer", "to": w2["peerId"], "sdp": {"type": "offer", "sdp": "fake"}})
    msg = await pending

    assert msg["type"] == "offer"
    assert msg["from"] == w1["peerId"]
    assert msg["sdp"]["sdp"] == "fake"
    await ws1.close(); await ws2.close()


# 8. Answer is routed to the peer specified by "to" field
async def test_answer_routed_by_peer_id(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    w1 = await join(ws1, "r8", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r8", "Bob")
    await t

    pending = asyncio.create_task(recv(ws1))
    await send(ws2, {"type": "answer", "to": w1["peerId"], "sdp": {"type": "answer", "sdp": "ans"}})
    msg = await pending

    assert msg["type"] == "answer"
    assert msg["from"] == w2["peerId"]
    assert msg["sdp"]["sdp"] == "ans"
    await ws1.close(); await ws2.close()


# 9. ICE candidate routed by "to" field
async def test_ice_candidate_routed_by_peer_id(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)

    w1 = await join(ws1, "r9", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r9", "Bob")
    await t

    pending = asyncio.create_task(recv(ws2))
    await send(ws1, {"type": "ice-candidate", "to": w2["peerId"], "candidate": {"candidate": "ice"}})
    msg = await pending

    assert msg["type"] == "ice-candidate"
    assert msg["from"] == w1["peerId"]
    assert msg["candidate"]["candidate"] == "ice"
    await ws1.close(); await ws2.close()


# 10. In a 3-peer room, ws2 routes offer only to ws3, ws1 gets nothing
async def test_offer_not_broadcast_to_all(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    w1 = await join(ws1, "r10", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r10", "Bob")
    await t
    t1 = asyncio.create_task(recv(ws1))
    t2 = asyncio.create_task(recv(ws2))
    w3 = await join(ws3, "r10", "Carol")
    await t1; await t2

    pending_ws3 = asyncio.create_task(recv(ws3))
    await send(ws2, {"type": "offer", "to": w3["peerId"], "sdp": {"type": "offer", "sdp": "x"}})
    msg = await pending_ws3
    assert msg["type"] == "offer"

    # ws1 should receive nothing
    nothing = None
    try:
        nothing = await asyncio.wait_for(recv(ws1), timeout=0.2)
    except asyncio.TimeoutError:
        pass
    assert nothing is None
    await ws1.close(); await ws2.close(); await ws3.close()


# 11. Disconnect notifies all remaining peers with peer-left + peerId
async def test_disconnect_notifies_all_remaining(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    w1 = await join(ws1, "r11", "Alice")
    t = asyncio.create_task(recv(ws1))
    w2 = await join(ws2, "r11", "Bob")
    await t
    t1 = asyncio.create_task(recv(ws1))
    t2 = asyncio.create_task(recv(ws2))
    w3 = await join(ws3, "r11", "Carol")
    await t1; await t2

    t1 = asyncio.create_task(recv(ws1))
    t2 = asyncio.create_task(recv(ws2))
    await ws3.close()
    pl1 = await t1
    pl2 = await t2

    assert pl1["type"] == "peer-left"
    assert pl1["peerId"] == w3["peerId"]
    assert pl1["name"] == "Carol"
    assert pl2["type"] == "peer-left"
    assert pl2["peerId"] == w3["peerId"]
    await ws1.close(); await ws2.close()


# 12. Each peer gets a unique peerId
async def test_peer_ids_are_unique(server):
    _, port = server
    clients = [await connect(port) for _ in range(4)]
    ids = []
    for i, ws in enumerate(clients):
        tasks = [asyncio.create_task(recv(c)) for c in clients[:i]]
        w = await join(ws, "r12", f"P{i}")
        ids.append(w["peerId"])
        for t in tasks:
            await t
    assert len(ids) == len(set(ids))
    for ws in clients:
        await ws.close()


# 13. list-rooms still works in multi-peer context
async def test_list_rooms_with_multiple_peers(server):
    _, port = server
    ws1 = await connect(port)
    ws2 = await connect(port)
    ws3 = await connect(port)

    await join(ws1, "multi-room", "Alice")
    t = asyncio.create_task(recv(ws1))
    await join(ws2, "multi-room", "Bob")
    await t

    pending = asyncio.create_task(recv(ws3))
    await send(ws3, {"type": "list-rooms"})
    msg = await pending

    assert msg["type"] == "rooms-list"
    room = next(r for r in msg["rooms"] if r["name"] == "multi-room")
    assert room["count"] == 2
    assert "Alice" in room["names"]
    assert "Bob" in room["names"]
    await ws1.close(); await ws2.close(); await ws3.close()

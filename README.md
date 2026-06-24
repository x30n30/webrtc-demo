# WebRTC Spatial Audio — Python

A hybrid WebRTC spatial audio demo: **Python signaling server** + **Python head-tracking** + **browser client** for HRTF audio.

```
[Python signaling server]  ←→  [Browser tab A]
                           ←→  [Browser tab B]

[Python head-tracking app] ──(bridge WS)──→ [Browser tab]
  pynput mouse / MediaPipe webcam
  pygame visualization
```

Python handles what it does best (MediaPipe face tracking, system mouse). The browser keeps the Web Audio `PannerNode` — the only viable HRTF engine.

---

## Requirements

- Python 3.11+
- Two browser tabs (any modern browser)
- A webcam (optional — mouse fallback works without one)

Install dependencies:

```bash
pip install websockets pytest pytest-asyncio
# For head tracking and visualization (P3/P4):
pip install pynput pygame mediapipe opencv-python
```

---

## Quick start

```bash
python -m server.http_server
```

Then open **http://localhost:8080** in **two browser tabs**.

- Enter the same room name in both tabs (or use the default `#default` hash).
- Click **Connect** in both tabs.
- Put on headphones and move the markers on the room map — or let the camera track your head.

To use a different port:

```bash
PORT=9000 python -m server.http_server
# or
python -m server.http_server 9000
```

---

## How it works

### Browser UI

| Control | What it does |
|---|---|
| **Connect / Disconnect** | Join the signaling room and establish WebRTC P2P |
| **Distance slider** | Move the remote source closer/farther |
| **Room map** | Drag **You** (blue) or **Peer** (orange) to change azimuth + distance; directional arrows show each person's head orientation |
| **Mouse viz** | Shows your mouse X position mapped to azimuth (always active) |
| **Camera viz** | Shows your head yaw from MediaPipe FaceMesh |
| **Remote viz** | Shows the peer's head yaw received over the data channel |
| **Room size slider** | Scales the room in metres |

### Room map arrows

Each participant dot on the room map has a coloured directional arrow showing which way they are facing. The **blue arrow** (You) updates from your local camera head tracking. The **orange arrow** (Peer) updates from the azimuth sent by your peer over the WebRTC data channel.

### Spatial audio

The browser applies HRTF panning via Web Audio `PannerNode`. Azimuth and distance come from:

1. Dragging markers on the room map → `setSourcePosition`
2. Camera head tracking → `setListenerOrientation` (rotates the listener, not the source)

---

## Project structure

```
server/
  signaling.py      WebSocket signaling server (join, offer, answer, ice-candidate)
  http_server.py    Combined HTTP static + WebSocket server (single port)
  bridge.py         Pushes azimuth from Python head tracker to browser over WS

spatial_audio/
  spatial_audio.py  Coordinate math: azimuth/distance → 3-D Cartesian vectors

head_tracking/
  head_tracker.py         pynput mouse → azimuth
  landmark_to_yaw.py      MediaPipe FaceMesh landmarks → head yaw (port of JS original)
  camera_head_tracker.py  MediaPipe + cv2 in a daemon thread

viz/
  spatial_viz.py    pygame top-down source/listener visualiser
  room_viz.py       pygame draggable room map with directional arrows

client/             Browser client (HTML + JS, served by http_server.py)
  index.html
  webrtc.js         RTCPeerConnection + signaling + data channel
  spatial-audio.js  Web Audio PannerNode wrapper
  spatial-viz.js    Canvas spatial visualiser
  room-viz.js       Canvas top-down room map
  head-tracker.js   Mouse → azimuth
  camera-head-tracker.js  MediaPipe FaceMesh wrapper
  landmark-to-yaw.js

tests/              51 pytest tests (no hardware required)
```

---

## Running the tests

```bash
pytest
```

All 51 tests pass with only `websockets`, `pytest`, and `pytest-asyncio` installed. The hardware-dependent modules (pynput, pygame, mediapipe, cv2) are injected via factory arguments and never imported during tests.

| Test file | Tests | What it covers |
|---|---|---|
| `test_signaling.py` | 8 | Real WebSocket connections, full message protocol |
| `test_spatial_audio.py` | 9 | Coordinate math (azimuth → Cartesian) |
| `test_head_tracker.py` | 6 | Mouse → azimuth, pynput mock |
| `test_spatial_viz.py` | 5 | Draw call order and source position |
| `test_room_viz.py` | 13 | Azimuth/distance math, drag, clamping, room size |
| `test_landmark_to_yaw.py` | 5 | FaceMesh landmark → yaw math |
| `test_camera_head_tracker.py` | 5 | MediaPipe pipeline, threading mock |

---

## Signaling protocol

All messages are JSON over WebSocket.

| Message | Direction | Fields |
|---|---|---|
| `join` | client → server | `room: string` |
| `peer-joined` | server → client 1 | — |
| `room-full` | server → client | — |
| `offer` | client → server → peer | `sdp` |
| `answer` | client → server → peer | `sdp` |
| `ice-candidate` | client → server → peer | `candidate` |
| `peer-left` | server → remaining client | — |

---

## Architecture notes

- **Per-server room state** — `start_server()` creates a fresh `rooms` dict per call; no module-level globals, so multiple server instances are fully isolated (important for parallel tests).
- **websockets 16.x** — `ws.state.name == "OPEN"` replaces the removed `ws.open`.
- **`process_request` hook** — HTTP GET requests are served as static files; WebSocket upgrade requests fall through to the normal handler, all on one port.
- **Threading bridge** — pynput fires in its own OS thread; `asyncio.run_coroutine_threadsafe` posts azimuths to the asyncio event loop safely.
- **`_tick()` is public** — `CameraHeadTracker._tick(frame)` can be called directly in tests, bypassing the daemon thread entirely.

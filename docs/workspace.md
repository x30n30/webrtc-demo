# Three-Monitor Workspace — Technical Documentation

> Branch: `three-monitor-workspace`
> Builds on: `multi-peer` (N-peer mesh signaling)
> Purpose: Experimental close-up head-tracking workspace for spatial audio conferencing across three monitors arranged in a semicircle around the user.

---

## 1. Concept

A common professional setup places three monitors side by side in a shallow arc: one directly in front and one to each side, angled roughly 30–60° inward. When a participant on a lateral monitor speaks, the audio should appear to come from that direction — and as the user turns their head toward that monitor, the perceived angle should shift naturally, as it would in real life.

This experiment extends the existing WebRTC spatial audio demo with:

- **N-peer mesh networking** — up to N simultaneous peers, each with their own RTCPeerConnection, data channel, and audio graph.
- **Monitor slot assignment** — the user manually assigns each remote peer to a Left, Center, or Right slot.
- **Per-slot azimuth control** — sliders let the user tune the exact angle of each lateral monitor (e.g., ±30° for a wide desk, ±60° for a more enclosed setup).
- **Close-up head tracking correction** — at 30–50 cm from the screen, the face fills more of the camera frame, causing naive landmark-based yaw estimation to over-read the head turn. An IOD-based calibration step corrects for this.

---

## 2. System Architecture

```
Browser A (user)                         Browser B / C / D (peers)
┌───────────────────────────────────┐    ┌──────────────────────────┐
│  WebRTCClient (N-peer mesh)       │◄──►│  WebRTCClient            │
│  ├─ RTCPeerConnection × N         │    │                          │
│  ├─ DataChannel × N (head angles) │    │  CameraHeadTracker       │
│  └─ MediaStream (cam + mic)       │    │  └─ FaceMesh → yaw angle │
│                                   │    │     → DataChannel msg    │
│  CameraHeadTracker                │    └──────────────────────────┘
│  └─ FaceMesh → YawEstimator       │
│     └─ calibrate() / estimate()   │
│                                   │
│  Three-Monitor Workspace UI       │
│  ├─ Slot: Left   [-90° … -10°]   │
│  ├─ Slot: Center [0°, fixed]      │
│  └─ Slot: Right  [10° … 90°]     │
│                                   │
│  SpatialAudio × N (per peer)      │
│  └─ PannerNode (HRTF) per peer   │
└───────────────────────────────────┘
          │
   WebSocket signaling
          │
    ┌─────────────┐
    │  signaling  │
    │  server.py  │
    │  (asyncio + │
    │  websockets)│
    └─────────────┘
```

---

## 3. Multi-Peer Signaling Protocol

The signaling server (`server/signaling.py`) was rewritten from a 2-peer model to an N-peer model. Key changes:

| Message | Direction | Payload |
|---|---|---|
| `join` | client → server | `{type, room, name}` |
| `welcome` | server → new client | `{type, peerId, peers:[{peerId,name}]}` |
| `peer-joined` | server → existing clients | `{type, peerId, name}` |
| `offer` / `answer` / `ice-candidate` | client → server → client | `{type, to, from, sdp/candidate}` |
| `peer-left` | server → remaining clients | `{type, peerId, name}` |

- Each client receives a UUID `peerId` on join.
- Signaling messages carry explicit `to` and `from` peer IDs; the server routes by `to` and stamps `from`.
- No room size limit.
- 13 Python integration tests (`tests/test_signaling_multipeer.py`).

---

## 4. N-Peer WebRTC Client (`client/webrtc.js`)

`WebRTCClient` manages a `Map<peerId, {pc, dc, name, remoteVideoEl}>`.

**Join flow (new peer as responder):**
1. `welcome` → store `myPeerId`, pre-create peer slots for each listed existing peer.
2. Each existing peer sends an `offer` → responder sets remote desc, creates answer, sends back.

**Join flow (existing peer as initiator):**
1. `peer-joined` → create `RTCPeerConnection` + `DataChannel`, create offer, send with `to: peerId`.

**Key callback:**

```js
client.onAudioTrack = (peerId, track) => { /* per-peer audio routing */ };
```

When `onAudioTrack` is set it bypasses the legacy shared `spatialAudio` option, giving the caller full control over each peer's audio graph.

---

## 5. Head-Yaw Estimation (`client/landmark-to-yaw.js`)

### 5.1 Raw yaw

MediaPipe FaceMesh provides 468 3D landmarks in normalised image coordinates (0–1). We use:

| Index | Point |
|---|---|
| 4 | Nose tip |
| 234 | Left face edge |
| 454 | Right face edge |

```
centerX   = (left.x + right.x) / 2
halfWidth = |right.x - left.x| / 2
normalized = (nose.x - centerX) / halfWidth   ∈ [−1, 1]
rawYaw     = normalized × 45°                 ∈ [−45°, 45°]
```

Positive yaw = turned right, negative = turned left.

### 5.2 Distance correction via Inter-Ocular Distance (IOD)

**Problem:** At 30–50 cm the face occupies a larger fraction of the frame. The same physical 20° head turn produces a larger pixel displacement, so `rawYaw` reads as larger than reality.

**Proxy:** The horizontal span between outer eye corners (landmarks 33 and 263) scales linearly with apparent face size, which in turn scales inversely with distance.

```
IOD = |landmarks[263].x − landmarks[33].x|
```

**Calibration:** the user sits at their normal working position and clicks **Calibrate Distance**. This stores `baselineIod`.

**Correction:**

```
scale          = baselineIod / currentIod
correctedYaw   = clamp(rawYaw × scale, −45°, 45°)
```

When the user is at the calibrated distance: `currentIod ≈ baselineIod` → scale = 1, no change.
Closer → `currentIod > baselineIod` → scale < 1 → yaw compressed.
Further → `currentIod < baselineIod` → scale > 1 → yaw amplified.

Implemented in `YawEstimator` class with `calibrate(landmarks)`, `estimate(landmarks)`, `reset()`.

### 5.3 Azimuth conversion

The raw/corrected yaw (±45°) is converted to the 0–360° azimuth convention used by the Web Audio API panner:

```
azimuth = ((yaw / 45) × 90 + 360) % 360
```

| Yaw | Azimuth | Audio direction |
|---|---|---|
| 0° | 0° | Front |
| +45° | 90° | Right |
| −45° | 270° | Left |

---

## 6. Spatial Audio (`client/spatial-audio.js`)

Uses the Web Audio API `PannerNode` with HRTF panning model.

**Source position** (in world space):
```js
x = distance × sin(azimuth_rad)
z = −distance × cos(azimuth_rad)
```

**Listener orientation** (updated on every head-tracking frame):
```js
forwardX = sin(azimuth_rad)
forwardZ = −cos(azimuth_rad)
```

In workspace mode, each peer has its own `SpatialAudio` instance (`peerAudio: Map<peerId, SpatialAudio>`). When the user's head angle updates, `setListenerOrientation` is called on every instance so all peer audio tracks respond to the same head movement.

---

## 7. Workspace UI (`client/index.html`)

The workspace panel is hidden until the user joins a room.

### Slot system

```
slotAngles  = { left: -45,  center: 0,  right: +45 }   // degrees, user-adjustable
slotAssign  = { left: '',   center: '', right: '' }     // peerId | ''
```

When a peer is assigned to a slot:
```js
audio.setSourcePosition(slotAngles[slot], currentDistance)
```

When the slot angle slider moves, the assigned peer's audio position is updated live.

### Angle ranges

| Slot | Range | Default |
|---|---|---|
| Left | −90° to −10° | −45° |
| Center | fixed 0° | 0° |
| Right | 10° to 90° | +45° |

The ranges model realistic monitor placement — tighter angles (±15°) for a flat triple-monitor array, wider angles (±60°–±75°) for a curved or physically separated setup.

### Calibration UI

- **Calibrate Distance** — calls `cameraTracker.calibrate()`, which snapshots the current IOD from the most recently detected face frame. Returns false (and shows an error) if no face is currently detected.
- **Reset** — calls `cameraTracker.resetCalibration()`, restoring uncorrected yaw output.
- The face-status indicator appends `(cal)` when distance calibration is active.

---

## 8. Testing

| Suite | File | Tests |
|---|---|---|
| landmark-to-yaw | `client/landmark-to-yaw.test.js` | 11 |
| camera-head-tracker | `client/camera-head-tracker.test.js` | 10 |
| webrtc client | `client/webrtc.test.js` | 27 |
| spatial audio | `client/spatial-audio.test.js` | 9 |
| spatial viz | `client/spatial-viz.test.js` | 8 |
| room viz | `client/room-viz.test.js` | 9 |
| head tracker | `client/head-tracker.test.js` | 11 |
| signaling (multi-peer) | `tests/test_signaling_multipeer.py` | 13 |

Run JS tests: `npx jest --no-coverage` (from `client/`)
Run Python tests: `pytest tests/` (from repo root)

---

## 9. Limitations and Future Work

| Issue | Notes |
|---|---|
| IOD calibration assumes frontal gaze | If the user is already looking at a lateral monitor during calibration, the IOD-to-distance mapping is skewed. Future: use depth from stereo landmarks or camera intrinsics. |
| Slot assignment is manual | A future version could auto-assign peers to slots based on their network latency or a room-joining order heuristic. |
| Single listener context | Each `SpatialAudio` instance creates its own `AudioContext`. Browser policy limits the number of simultaneous contexts. Three peers × one context each is fine; beyond ~6 may require a shared context with multiple panners. |
| Head tracking runs on main thread | MediaPipe WASM processes frames synchronously in the JS event loop. A Web Worker version would reduce jitter on low-end hardware. |
| No pitch / roll correction | Only yaw (left-right) is estimated. Pitch (up-down nodding) and roll (head tilt) are ignored. |
| IOD proxy breaks with glasses / hair | Occlusion of eye corner landmarks (33, 263) by thick-rimmed glasses or hair degrades IOD accuracy. |

---

## 10. Branch Relationship

```
main
 └─ multi-peer          ← N-peer signaling + mesh WebRTCClient + dynamic peer tiles
     └─ three-monitor-workspace  ← YawEstimator, workspace UI, per-peer audio
```

`main` and `multi-peer` are not affected by this branch.

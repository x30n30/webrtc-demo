# Dev Log — webrtc-py

## 2026-10-28

### Bug fixed ✓: mirrored webcam causing reversed audio channels
- **Symptom:** peer's audio came from the wrong side when head tracking was active.
- **Root cause:** MediaPipe processes the mirrored webcam frame, so all landmark x-coordinates are left/right flipped relative to the real world.
- **Fix:** negated the nose displacement in `client/landmark-to-yaw.js` line 22:
  ```js
  const normalized = -(nose.x - centerX) / halfWidth;
  ```
- Updated `landmark-to-yaw.test.js` to reflect corrected sign convention.

### Implemented ✓: ConvolverNode reverb for improved externalisation
- When the speaker position changes (azimuth update), the sound still feels "inside the head" (in-head localisation) rather than naturally outside.
- Added `ConvolverNode` with synthetic stereo room IR (decaying white noise, 0.8 s, τ=0.15 s) generated via `OfflineAudioContext` — no external files needed.
- Graph: `source → panner → [dryGain, convolver → wetGain] → destination`
- Default wet mix = 0.25; controllable at runtime via `setReverbMix(0..1)`.
- `SpatialAudio` constructor now accepts `{ reverbMix }` option.
- `attachTrack()` is now `async` (awaits IR build).
- 16 tests in `spatial-audio.test.js` covering graph wiring, gain values, clamping, and teardown.
- Still to explore: swap synthetic IR for a real room IR (.wav) for richer early reflections.

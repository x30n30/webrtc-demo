/**
 * Converts MediaPipe FaceMesh landmarks to head yaw in degrees.
 *
 * Key indices:
 *   4   — nose tip
 *   234 — left face edge
 *   454 — right face edge
 *   33  — left eye outer corner  (used for inter-ocular distance)
 *   263 — right eye outer corner (used for inter-ocular distance)
 *
 * Returns yaw in degrees, clamped to ±45°.
 * Positive = turned right, negative = turned left.
 */
function landmarkToYaw(landmarks) {
  const nose  = landmarks[4];
  const left  = landmarks[234];
  const right = landmarks[454];

  const centerX   = (left.x + right.x) / 2;
  const halfWidth = Math.abs(right.x - left.x) / 2;

  if (halfWidth < 0.001) return 0;

  const normalized = (nose.x - centerX) / halfWidth;
  const clamped    = Math.max(-1, Math.min(1, normalized));
  return clamped * 45;
}

/**
 * Measures the inter-ocular distance (IOD) — horizontal span between the
 * outer corners of both eyes (landmarks 33 and 263).
 *
 * IOD grows as the face moves closer to the camera, and shrinks as it moves
 * away. We use it as a distance proxy for close-up calibration.
 */
function measureIod(landmarks) {
  return Math.abs(landmarks[263].x - landmarks[33].x);
}

/**
 * YawEstimator wraps landmarkToYaw with optional close-up distance correction.
 *
 * Problem: at 30–50 cm from the screen the face fills more of the frame, so
 * the same physical head turn produces a larger pixel displacement. Without
 * correction the yaw reads as larger than it really is.
 *
 * Fix: record the IOD at the desired working distance (calibrate()), then
 * scale every subsequent yaw by baselineIod / currentIod. When the user is
 * at the calibrated distance the scale is 1.0. Closer → IOD larger → scale
 * < 1 → yaw compressed. Further → IOD smaller → scale > 1 → yaw amplified.
 */
class YawEstimator {
  constructor() {
    this._baselineIod = null;
  }

  /** The IOD recorded at calibration time, or null if not calibrated. */
  get baselineIod() {
    return this._baselineIod;
  }

  /**
   * Record the current inter-ocular distance as the reference distance.
   * Call this once while the user sits at their normal working position.
   */
  calibrate(landmarks) {
    this._baselineIod = measureIod(landmarks);
  }

  /** Clear calibration — estimate() returns raw yaw again. */
  reset() {
    this._baselineIod = null;
  }

  /**
   * Return yaw in degrees (±45°), corrected for working distance if calibrated.
   */
  estimate(landmarks) {
    const rawYaw = landmarkToYaw(landmarks);
    if (this._baselineIod === null) return rawYaw;

    const currentIod = measureIod(landmarks);
    if (currentIod < 0.001) return rawYaw;

    const scale = this._baselineIod / currentIod;
    return Math.max(-45, Math.min(45, rawYaw * scale));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { landmarkToYaw, YawEstimator };
}

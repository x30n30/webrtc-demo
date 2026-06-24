/**
 * Converts MediaPipe FaceMesh landmarks to head yaw in degrees.
 *
 * Key indices:
 *   4   — nose tip
 *   234 — left face edge
 *   454 — right face edge
 *
 * Returns yaw in degrees, clamped to ±45°.
 * Positive = turned right, negative = turned left.
 */
function landmarkToYaw(landmarks) {
  const nose  = landmarks[4];
  const left  = landmarks[234];
  const right = landmarks[454];

  const centerX    = (left.x + right.x) / 2;
  const halfWidth  = Math.abs(right.x - left.x) / 2;

  if (halfWidth < 0.001) return 0;

  const normalized = (nose.x - centerX) / halfWidth;
  const clamped    = Math.max(-1, Math.min(1, normalized));
  return clamped * 45;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { landmarkToYaw };
}

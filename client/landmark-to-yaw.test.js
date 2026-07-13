const { landmarkToYaw, YawEstimator } = require('./landmark-to-yaw');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLandmarks(noseX, leftX, rightX, eyeLeftX = 0.35, eyeRightX = 0.65) {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[4]   = { x: noseX,    y: 0.5, z: 0 }; // nose tip
  lm[234] = { x: leftX,    y: 0.5, z: 0 }; // left face edge
  lm[454] = { x: rightX,   y: 0.5, z: 0 }; // right face edge
  lm[33]  = { x: eyeLeftX, y: 0.5, z: 0 }; // left eye outer corner
  lm[263] = { x: eyeRightX,y: 0.5, z: 0 }; // right eye outer corner
  return lm;
}

// ── landmarkToYaw (unchanged) ─────────────────────────────────────────────

test('forward-facing landmarks return yaw ≈ 0°', () => {
  expect(landmarkToYaw(makeLandmarks(0.5, 0.3, 0.7))).toBeCloseTo(0, 5);
});

test('nose shifted right of centre returns positive yaw', () => {
  expect(landmarkToYaw(makeLandmarks(0.6, 0.3, 0.7))).toBeGreaterThan(0);
});

test('nose shifted left of centre returns negative yaw', () => {
  expect(landmarkToYaw(makeLandmarks(0.4, 0.3, 0.7))).toBeLessThan(0);
});

test('returns 0 when left and right edges are coincident (degenerate)', () => {
  expect(landmarkToYaw(makeLandmarks(0.5, 0.5, 0.5))).toBe(0);
});

test('yaw is clamped to ±45°', () => {
  expect(landmarkToYaw(makeLandmarks(0.95, 0.3, 0.7))).toBe(45);
  expect(landmarkToYaw(makeLandmarks(0.05, 0.3, 0.7))).toBe(-45);
});

// ── YawEstimator — close-up calibration ───────────────────────────────────

test('YawEstimator.estimate() without calibration matches landmarkToYaw', () => {
  const est = new YawEstimator();
  const lm  = makeLandmarks(0.6, 0.3, 0.7);
  expect(est.estimate(lm)).toBeCloseTo(landmarkToYaw(lm), 5);
});

test('calibrate() records the inter-ocular distance from landmarks', () => {
  const est = new YawEstimator();
  // eye landmarks at 0.35 and 0.65 → IOD = 0.30
  est.calibrate(makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65));
  expect(est.baselineIod).toBeCloseTo(0.30, 5);
});

test('after calibrating at normal range, close-up estimate compresses yaw', () => {
  const est = new YawEstimator();
  // calibrate at normal range: IOD = 0.30
  est.calibrate(makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65));  // IOD = 0.30

  // estimate at close range: IOD = 0.60
  const rawYaw  = landmarkToYaw(makeLandmarks(0.6, 0.3, 0.7, 0.2, 0.8));
  const corrYaw = est.estimate(makeLandmarks(0.6, 0.3, 0.7, 0.2, 0.8));

  // scale = 0.30 / 0.60 = 0.5 → yaw is halved
  expect(Math.abs(corrYaw)).toBeLessThan(Math.abs(rawYaw));
  expect(corrYaw).toBeCloseTo(rawYaw * (0.30 / 0.60), 3);
});

test('after calibrating at normal range, far-away estimate amplifies yaw', () => {
  const est = new YawEstimator();
  // calibrate at normal range: IOD = 0.30
  est.calibrate(makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65));  // IOD = 0.30

  // estimate at far range: IOD = 0.15
  const rawYaw  = landmarkToYaw(makeLandmarks(0.6, 0.3, 0.7, 0.425, 0.575));
  const corrYaw = est.estimate(makeLandmarks(0.6, 0.3, 0.7, 0.425, 0.575));

  // scale = 0.30 / 0.15 = 2.0 → yaw is doubled (clamped to ±45°)
  expect(Math.abs(corrYaw)).toBeGreaterThan(Math.abs(rawYaw));
  expect(Math.abs(corrYaw)).toBeLessThanOrEqual(45);
});

test('reset() clears calibration so estimate returns uncorrected yaw', () => {
  const est = new YawEstimator();
  est.calibrate(makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65));
  est.reset();

  expect(est.baselineIod).toBeNull();
  const lm = makeLandmarks(0.6, 0.3, 0.7, 0.35, 0.65);
  expect(est.estimate(lm)).toBeCloseTo(landmarkToYaw(lm), 5);
});

test('estimate() result is clamped to ±45° even after amplification', () => {
  const est = new YawEstimator();
  // calibrate very far: IOD = 0.05 → scale = 0.05/0.30 = 0.167 → 6x amplification
  est.calibrate(makeLandmarks(0.5, 0.3, 0.7, 0.475, 0.525));

  // yaw that would go way past 45° without clamping
  const corrYaw = est.estimate(makeLandmarks(0.6, 0.3, 0.7, 0.35, 0.65));
  expect(Math.abs(corrYaw)).toBeLessThanOrEqual(45);
});

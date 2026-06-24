const { landmarkToYaw } = require('./landmark-to-yaw');

// Build a minimal 468-landmark array with controlled values at key indices
function makeLandmarks(noseX, leftX, rightX) {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[4]   = { x: noseX, y: 0.5, z: 0 }; // nose tip
  lm[234] = { x: leftX, y: 0.5, z: 0 }; // left face edge
  lm[454] = { x: rightX, y: 0.5, z: 0 }; // right face edge
  return lm;
}

// Test 1
test('forward-facing landmarks return yaw ≈ 0°', () => {
  // nose centred between edges
  const lm = makeLandmarks(0.5, 0.3, 0.7);
  expect(landmarkToYaw(lm)).toBeCloseTo(0, 5);
});

// Test 2
test('nose shifted right of centre returns positive yaw', () => {
  // nose halfway between centre and right edge
  const lm = makeLandmarks(0.6, 0.3, 0.7);
  expect(landmarkToYaw(lm)).toBeGreaterThan(0);
});

// Test 3
test('nose shifted left of centre returns negative yaw', () => {
  const lm = makeLandmarks(0.4, 0.3, 0.7);
  expect(landmarkToYaw(lm)).toBeLessThan(0);
});

// Test 4
test('returns 0 when left and right edges are coincident (degenerate)', () => {
  const lm = makeLandmarks(0.5, 0.5, 0.5);
  expect(landmarkToYaw(lm)).toBe(0);
});

// Test 5
test('yaw is clamped to ±45°', () => {
  // nose far outside face width
  const lm = makeLandmarks(0.95, 0.3, 0.7);
  expect(landmarkToYaw(lm)).toBe(45);

  const lm2 = makeLandmarks(0.05, 0.3, 0.7);
  expect(landmarkToYaw(lm2)).toBe(-45);
});

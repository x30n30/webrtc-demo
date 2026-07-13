const { CameraHeadTracker } = require('./camera-head-tracker');

// ── Mocks ──────────────────────────────────────────────────────────────────

let faceMeshInstances = [];

class MockFaceMesh {
  constructor(config) {
    this._config = config;
    this._options = null;
    this._onResults = null;
    faceMeshInstances.push(this);
  }
  setOptions(opts) { this._options = opts; }
  onResults(fn) { this._onResults = fn; }
  async initialize() {}
  async send() {}
  // Test helper — simulates MediaPipe firing results
  _fireResults(results) {
    if (this._onResults) this._onResults(results);
  }
}

// Mock setInterval that never fires — keeps the loop inert during tests
const noopInterval = () => 0;
const noopClear = () => {};

function makeLandmarks(noseX, leftX, rightX, eyeLeftX = 0.35, eyeRightX = 0.65) {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[4]   = { x: noseX,     y: 0.5, z: 0 };
  lm[234] = { x: leftX,     y: 0.5, z: 0 };
  lm[454] = { x: rightX,    y: 0.5, z: 0 };
  lm[33]  = { x: eyeLeftX,  y: 0.5, z: 0 };
  lm[263] = { x: eyeRightX, y: 0.5, z: 0 };
  return lm;
}

const mockVideoEl = { readyState: 4 };

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  faceMeshInstances = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('start() creates FaceMesh with a locateFile function', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);

  const fm = faceMeshInstances[0];
  expect(fm).toBeDefined();
  expect(typeof fm._config.locateFile).toBe('function');
  expect(fm._config.locateFile('face_mesh.js')).toContain('face_mesh.js');
});

// Test 2
test('start() calls setOptions with correct tracking config', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);

  const opts = faceMeshInstances[0]._options;
  expect(opts.maxNumFaces).toBe(1);
  expect(opts.minDetectionConfidence).toBeGreaterThan(0);
  expect(opts.minTrackingConfidence).toBeGreaterThan(0);
});

// Test 3
test('onHeadAngle fires with correct azimuth when FaceMesh returns landmarks', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  const angles = [];
  tracker.onHeadAngle = (az) => angles.push(az);
  await tracker.start(mockVideoEl);

  // Forward-facing: yaw ≈ 0 → azimuth ≈ 0
  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.5, 0.3, 0.7)],
  });
  expect(angles[0]).toBeCloseTo(0, 1);

  // Turned fully right: yaw = 45 → azimuth = 90
  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.7, 0.3, 0.7)],
  });
  expect(angles[1]).toBeCloseTo(90, 1);
});

// Test 4
test('stop() halts the loop and clears the interval', async () => {
  let cleared = false;
  const mockClear = () => { cleared = true; };
  const mockInterval = (fn, ms) => 42;

  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: mockInterval, clearIntervalFn: mockClear });
  await tracker.start(mockVideoEl);
  tracker.stop();

  expect(cleared).toBe(true);
  expect(tracker._running).toBe(false);
});

// Test 5
test('onHeadAngle not called when multiFaceLandmarks is empty', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  const angles = [];
  tracker.onHeadAngle = (az) => angles.push(az);
  await tracker.start(mockVideoEl);

  faceMeshInstances[0]._fireResults({ multiFaceLandmarks: [] });
  faceMeshInstances[0]._fireResults({});

  expect(angles).toHaveLength(0);
});

// ── YawEstimator / distance calibration ───────────────────────────────────

// Test 6
test('isCalibrated is false before any calibration', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);
  expect(tracker.isCalibrated).toBe(false);
});

// Test 7
test('calibrate() returns false when no face has been detected yet', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);
  expect(tracker.calibrate()).toBe(false);
  expect(tracker.isCalibrated).toBe(false);
});

// Test 8
test('calibrate() returns true and sets isCalibrated after a face result', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);

  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65)],
  });

  expect(tracker.calibrate()).toBe(true);
  expect(tracker.isCalibrated).toBe(true);
});

// Test 9
test('resetCalibration() clears calibration', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  await tracker.start(mockVideoEl);

  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65)],
  });
  tracker.calibrate();
  tracker.resetCalibration();

  expect(tracker.isCalibrated).toBe(false);
});

// Test 10
test('calibrated at normal range then close-up yields compressed azimuth', async () => {
  const tracker = new CameraHeadTracker({ FaceMeshClass: MockFaceMesh, setIntervalFn: noopInterval, clearIntervalFn: noopClear });
  const angles = [];
  tracker.onHeadAngle = (az) => angles.push(az);
  await tracker.start(mockVideoEl);

  // Calibrate at normal range: IOD = 0.30
  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.5, 0.3, 0.7, 0.35, 0.65)],
  });
  tracker.calibrate();
  angles.length = 0;

  // Same head turn but close-up: IOD = 0.60  → scale = 0.30/0.60 = 0.5
  // raw yaw = 45° → corrected = 22.5° → azimuth = 45°
  faceMeshInstances[0]._fireResults({
    multiFaceLandmarks: [makeLandmarks(0.7, 0.3, 0.7, 0.2, 0.8)],
  });

  expect(angles[0]).toBeCloseTo(45, 1);  // not the raw 90° azimuth
});

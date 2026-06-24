const { HeadTracker } = require('./head-tracker');

// ── Mock container ─────────────────────────────────────────────────────────

function makeContainer(width = 400) {
  return {
    clientWidth: width,
    _listeners: {},
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
    },
    _fire(event, data) {
      (this._listeners[event] || []).forEach((fn) => fn(data));
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('start() attaches a mousemove listener to the container', () => {
  const tracker = new HeadTracker();
  const container = makeContainer();
  tracker.start(container);
  expect(container._listeners['mousemove']).toHaveLength(1);
  tracker.stop();
});

// Test 2
test('stop() removes the mousemove listener', () => {
  const tracker = new HeadTracker();
  const container = makeContainer();
  tracker.start(container);
  tracker.stop();
  expect(container._listeners['mousemove']).toHaveLength(0);
});

// Test 3
test('mouse at left edge fires azimuth 0°', () => {
  const tracker = new HeadTracker();
  const container = makeContainer(400);
  const angles = [];
  tracker.onHeadAngle = (a) => angles.push(a);
  tracker.start(container);
  container._fire('mousemove', { clientX: 0 });
  expect(angles[0]).toBeCloseTo(0, 1);
  tracker.stop();
});

// Test 4
test('mouse at right edge fires azimuth 360°', () => {
  const tracker = new HeadTracker();
  const container = makeContainer(400);
  const angles = [];
  tracker.onHeadAngle = (a) => angles.push(a);
  tracker.start(container);
  container._fire('mousemove', { clientX: 400 });
  expect(angles[0]).toBeCloseTo(360, 1);
  tracker.stop();
});

// Test 5
test('mouse at centre fires azimuth 180°', () => {
  const tracker = new HeadTracker();
  const container = makeContainer(400);
  const angles = [];
  tracker.onHeadAngle = (a) => angles.push(a);
  tracker.start(container);
  container._fire('mousemove', { clientX: 200 });
  expect(angles[0]).toBeCloseTo(180, 1);
  tracker.stop();
});

// Test 6
test('onHeadAngle fires on every mousemove event', () => {
  const tracker = new HeadTracker();
  const container = makeContainer(400);
  const angles = [];
  tracker.onHeadAngle = (a) => angles.push(a);
  tracker.start(container);
  container._fire('mousemove', { clientX: 100 });
  container._fire('mousemove', { clientX: 200 });
  container._fire('mousemove', { clientX: 300 });
  expect(angles).toHaveLength(3);
  tracker.stop();
});

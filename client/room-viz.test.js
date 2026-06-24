/**
 * RoomViz tests — top-down room with draggable participant markers.
 */

// ── Canvas mock ──────────────────────────────────────────────────────────────

class MockContext2D {
  constructor() { this._props = {}; }
  clearRect() {}
  beginPath() {}
  arc() {}
  fill() {}
  stroke() {}
  moveTo() {}
  lineTo() {}
  fillText() {}
  strokeRect() {}
  set fillStyle(v)   { this._props.fillStyle = v; }
  set strokeStyle(v) { this._props.strokeStyle = v; }
  set lineWidth(v)   { this._props.lineWidth = v; }
  set font(v)        { this._props.font = v; }
  set textAlign(v)   { this._props.textAlign = v; }
  set textBaseline(v){ this._props.textBaseline = v; }
}

function makeCanvas(width = 300, height = 300) {
  const ctx = new MockContext2D();
  const listeners = {};
  return {
    width, height,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener: (ev, fn) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
    },
    _fire: (ev, data) => (listeners[ev] || []).forEach(fn => fn(data)),
  };
}

// ── Module under test ──────────────────────────────────────────────────────

const { RoomViz } = require('./room-viz');

// ── Helpers ────────────────────────────────────────────────────────────────

let docListeners = {};

function fireDoc(ev, data) {
  (docListeners[ev] || []).forEach(fn => fn(data));
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  docListeners = {};
  global.document = {
    addEventListener:    (ev, fn) => { docListeners[ev] = docListeners[ev] || []; docListeners[ev].push(fn); },
    removeEventListener: (ev, fn) => { if (docListeners[ev]) docListeners[ev] = docListeners[ev].filter(f => f !== fn); },
  };
});

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('constructor places local marker at canvas center, remote above center', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);

  expect(rv._localPos.x).toBe(150);
  expect(rv._localPos.y).toBe(150);
  expect(rv._remotePos.x).toBe(150);
  expect(rv._remotePos.y).toBeLessThan(150);
});

// Test 2
test('_azimuth(): remote directly above local → 0°', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };
  expect(rv._azimuth()).toBeCloseTo(0, 5);
});

// Test 3
test('_azimuth(): remote to the right of local → 90°', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 250, y: 150 };
  expect(rv._azimuth()).toBeCloseTo(90, 5);
});

// Test 4
test('_azimuth(): remote directly below local → 180°', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y: 250 };
  expect(rv._azimuth()).toBeCloseTo(180, 5);
});

// Test 5
test('_azimuth(): remote to the left of local → 270°', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x:  50, y: 150 };
  expect(rv._azimuth()).toBeCloseTo(270, 5);
});

// Test 6
test('_distance(): 100px apart, 300px canvas, 10m room → ~3.33m', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas, { roomSizeMeters: 10 });
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 250, y: 150 };
  expect(rv._distance()).toBeCloseTo(10 * 100 / 300, 3);
});

// Test 7
test('dragging remote marker fires onPositionChange with correct azimuth', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  const changes = [];
  rv.onPositionChange = (az, dist) => changes.push({ az, dist });

  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };

  // grab remote marker, drag it to directly right of local
  canvas._fire('mousedown', { clientX: 150, clientY:  50 });
  fireDoc('mousemove',      { clientX: 250, clientY: 150 });

  expect(changes.length).toBeGreaterThan(0);
  expect(changes[0].az).toBeCloseTo(90, 0);
});

// Test 8
test('dragging local marker fires onPositionChange', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  const changes = [];
  rv.onPositionChange = (az, dist) => changes.push({ az, dist });

  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };

  canvas._fire('mousedown', { clientX: 150, clientY: 150 });
  fireDoc('mousemove',      { clientX: 100, clientY: 150 });

  expect(changes.length).toBeGreaterThan(0);
});

// Test 9
test('mousedown far from both markers does not start drag', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  const changes = [];
  rv.onPositionChange = (az, dist) => changes.push({ az, dist });

  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };

  canvas._fire('mousedown', { clientX: 10, clientY: 290 });
  fireDoc('mousemove',      { clientX: 20, clientY: 280 });

  expect(changes).toHaveLength(0);
});

// Test 10
test('dragging outside canvas bounds clamps marker position', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);

  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };

  canvas._fire('mousedown', { clientX: 150, clientY:  50 });
  fireDoc('mousemove',      { clientX: 500, clientY: -100 }); // far outside

  expect(rv._remotePos.x).toBeGreaterThanOrEqual(0);
  expect(rv._remotePos.x).toBeLessThanOrEqual(300);
  expect(rv._remotePos.y).toBeGreaterThanOrEqual(0);
  expect(rv._remotePos.y).toBeLessThanOrEqual(300);
});

// Test 12
test('setRoomSize(20) updates _roomSizeMeters', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas, { roomSizeMeters: 10 });
  rv.setRoomSize(20);
  expect(rv._roomSizeMeters).toBe(20);
});

// Test 13
test('setRoomSize fires onPositionChange with recalculated distance', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas, { roomSizeMeters: 10 });
  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 250, y: 150 }; // 100px apart → 10/300*100 ≈ 3.33m at 10m room

  const changes = [];
  rv.onPositionChange = (az, dist) => changes.push(dist);

  rv.setRoomSize(20); // same pixels, double room → distance should double
  expect(changes[0]).toBeCloseTo(20 * 100 / 300, 3);
});

// Test 11
test('mouseup ends drag — further mousemove does not fire onPositionChange', () => {
  const canvas = makeCanvas(300, 300);
  const rv = new RoomViz(canvas);
  const changes = [];
  rv.onPositionChange = (az, dist) => changes.push({ az, dist });

  rv._localPos  = { x: 150, y: 150 };
  rv._remotePos = { x: 150, y:  50 };

  canvas._fire('mousedown', { clientX: 150, clientY:  50 });
  fireDoc('mousemove',      { clientX: 200, clientY:  50 });
  fireDoc('mouseup',        {});
  const countAfterUp = changes.length;
  fireDoc('mousemove',      { clientX: 250, clientY:  50 });

  expect(changes.length).toBe(countAfterUp);
});

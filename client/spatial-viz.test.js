const { SpatialViz } = require('./spatial-viz');

// ── Mock canvas ────────────────────────────────────────────────────────────

function makeCanvas(width = 200, height = 200) {
  const calls = [];
  const ctx = {
    _calls: calls,
    clearRect:  (...a) => calls.push(['clearRect',  ...a]),
    beginPath:  ()     => calls.push(['beginPath']),
    arc:        (...a) => calls.push(['arc',        ...a]),
    moveTo:     (...a) => calls.push(['moveTo',     ...a]),
    lineTo:     (...a) => calls.push(['lineTo',     ...a]),
    fill:       ()     => calls.push(['fill']),
    stroke:     ()     => calls.push(['stroke']),
    fillText:   (...a) => calls.push(['fillText',   ...a]),
    fillStyle:   '',
    strokeStyle: '',
    lineWidth:   0,
    font:        '',
    textAlign:   '',
  };
  return { width, height, getContext: () => ctx, _ctx: ctx };
}

function arcCalls(canvas) {
  return canvas._ctx._calls.filter((c) => c[0] === 'arc');
}

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('update() clears the canvas before drawing', () => {
  const canvas = makeCanvas();
  const viz = new SpatialViz(canvas);
  viz.update(0, 1);
  const first = canvas._ctx._calls[0];
  expect(first[0]).toBe('clearRect');
  expect(first).toEqual(['clearRect', 0, 0, 200, 200]);
});

// Test 2
test('update() draws the listener head circle at canvas centre', () => {
  const canvas = makeCanvas(200, 200);
  const viz = new SpatialViz(canvas);
  viz.update(0, 1);
  const arcs = arcCalls(canvas);
  // First arc = head, at (100, 100)
  expect(arcs[0][1]).toBeCloseTo(100, 1); // x
  expect(arcs[0][2]).toBeCloseTo(100, 1); // y
});

// Test 3
test('update(90, 2) draws source to the right of centre', () => {
  const canvas = makeCanvas(200, 200);
  const viz = new SpatialViz(canvas);
  viz.update(90, 2);
  const arcs = arcCalls(canvas);
  // Second arc = source; azimuth 90° → source x > centre x
  expect(arcs[1][1]).toBeGreaterThan(100); // x
  expect(arcs[1][2]).toBeCloseTo(100, 0);  // y ≈ centre
});

// Test 4
test('update(0, 5) draws source above centre', () => {
  const canvas = makeCanvas(200, 200);
  const viz = new SpatialViz(canvas);
  viz.update(0, 5);
  const arcs = arcCalls(canvas);
  // Azimuth 0° = straight ahead = top of canvas (y decreases upward)
  expect(arcs[1][1]).toBeCloseTo(100, 0); // x ≈ centre
  expect(arcs[1][2]).toBeLessThan(100);   // y < centre
});

// Test 5
test('clear() clears the full canvas', () => {
  const canvas = makeCanvas(200, 200);
  const viz = new SpatialViz(canvas);
  viz.clear();
  expect(canvas._ctx._calls).toContainEqual(['clearRect', 0, 0, 200, 200]);
});

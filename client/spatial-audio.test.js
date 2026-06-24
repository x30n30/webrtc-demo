/**
 * Spatial audio tests — mocked Web Audio API.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

class MockAudioNode {
  constructor() {
    this._connectedTo = [];
    this._disconnected = false;
  }
  connect(node) { this._connectedTo.push(node); return node; }
  disconnect() { this._disconnected = true; }
}

class MockPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.panningModel = '';
    this.distanceModel = '';
    this.refDistance = 0;
    this.maxDistance = 0;
    this.rolloffFactor = 0;
    this.positionX = { value: 0 };
    this.positionY = { value: 0 };
    this.positionZ = { value: 0 };
  }
}

let audioContextInstances = [];

class MockAudioContext {
  constructor() {
    this.destination = new MockAudioNode();
    this.listener = {
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX:      { value: 0 },
      upY:      { value: 1 },
      upZ:      { value: 0 },
    };
    this._closed = false;
    this._sources = [];
    this._panners = [];
    audioContextInstances.push(this);
  }
  createMediaStreamSource(stream) {
    const node = new MockAudioNode();
    node._stream = stream;
    this._sources.push(node);
    return node;
  }
  createMediaElementSource(el) {
    const node = new MockAudioNode();
    node._element = el;
    this._sources.push(node);
    return node;
  }
  createPanner() {
    const node = new MockPannerNode();
    this._panners.push(node);
    return node;
  }
  async close() { this._closed = true; }
}

class MockMediaStreamTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = false;
  }
}

class MockMediaStream {
  constructor(tracks) { this._tracks = tracks || []; }
  getTracks() { return this._tracks; }
}

global.AudioContext = MockAudioContext;
global.MediaStream = MockMediaStream;

// ── Module under test ──────────────────────────────────────────────────────

const { SpatialAudio } = require('./spatial-audio');

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  audioContextInstances = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('attachTrack connects source → panner → destination', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));

  const ctx    = audioContextInstances[0];
  const source = ctx._sources[0];
  const panner = ctx._panners[0];

  expect(source._connectedTo).toContain(panner);
  expect(panner._connectedTo).toContain(ctx.destination);
});

// Test 2
test('setSourcePosition(90, 2) sets panner x=2, z≈0', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.setSourcePosition(90, 2);

  const panner = audioContextInstances[0]._panners[0];
  expect(panner.positionX.value).toBeCloseTo(2, 5);
  expect(panner.positionZ.value).toBeCloseTo(0, 5);
});

// Test 3
test('setSourcePosition(0, 5) sets panner x=0, z=-5', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.setSourcePosition(0, 5);

  const panner = audioContextInstances[0]._panners[0];
  expect(panner.positionX.value).toBeCloseTo(0, 5);
  expect(panner.positionZ.value).toBeCloseTo(-5, 5);
});

// Test 4
test('detach() disconnects nodes and closes AudioContext', async () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));

  await sa.detach();

  const ctx = audioContextInstances[0];
  expect(ctx._sources[0]._disconnected).toBe(true);
  expect(ctx._panners[0]._disconnected).toBe(true);
  expect(ctx._closed).toBe(true);
  expect(sa.isAttached).toBe(false);
});

// Test 5
test('attachTrack twice replaces previous graph', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.attachTrack(new MockMediaStreamTrack('audio'));

  expect(sa.isAttached).toBe(true);
  expect(audioContextInstances[0]._closed).toBe(true);
  expect(audioContextInstances[1]._closed).toBe(false);
});

// Test 6
test('isAttached reflects attachment state', () => {
  const sa = new SpatialAudio();
  expect(sa.isAttached).toBe(false);
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  expect(sa.isAttached).toBe(true);
});

// Test 7
test('setSourcePosition and setListenerOrientation before attachTrack do not throw', () => {
  const sa = new SpatialAudio();
  expect(() => sa.setSourcePosition(45, 3)).not.toThrow();
  expect(() => sa.setListenerOrientation(45)).not.toThrow();
});

// Test 8
test('setListenerOrientation(0) points listener forward: forwardX≈0, forwardZ≈-1', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.setListenerOrientation(0);

  const { listener } = audioContextInstances[0];
  expect(listener.forwardX.value).toBeCloseTo(0, 5);
  expect(listener.forwardZ.value).toBeCloseTo(-1, 5);
});

// Test 9
test('setListenerOrientation(90) points listener right: forwardX≈1, forwardZ≈0', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.setListenerOrientation(90);

  const { listener } = audioContextInstances[0];
  expect(listener.forwardX.value).toBeCloseTo(1, 5);
  expect(listener.forwardZ.value).toBeCloseTo(0, 5);
});

// Test 10
test('attachElement connects mediaElementSource → panner → destination', () => {
  const sa = new SpatialAudio();
  const videoEl = { tagName: 'VIDEO' };
  sa.attachElement(videoEl);

  const ctx    = audioContextInstances[0];
  const source = ctx._sources[0];
  const panner = ctx._panners[0];

  expect(source._element).toBe(videoEl);
  expect(source._connectedTo).toContain(panner);
  expect(panner._connectedTo).toContain(ctx.destination);
});

// Test 11
test('attachElement sets isAttached to true', () => {
  const sa = new SpatialAudio();
  expect(sa.isAttached).toBe(false);
  sa.attachElement({ tagName: 'VIDEO' });
  expect(sa.isAttached).toBe(true);
});

// Test 12
test('attachElement after attachTrack replaces graph', () => {
  const sa = new SpatialAudio();
  sa.attachTrack(new MockMediaStreamTrack('audio'));
  sa.attachElement({ tagName: 'VIDEO' });

  expect(sa.isAttached).toBe(true);
  expect(audioContextInstances[0]._closed).toBe(true);
  expect(audioContextInstances[1]._closed).toBe(false);
});

// Test 13
test('attachElement + setSourcePosition(90, 3) sets panner x≈3, z≈0', () => {
  const sa = new SpatialAudio();
  sa.attachElement({ tagName: 'VIDEO' });
  sa.setSourcePosition(90, 3);

  const panner = audioContextInstances[0]._panners[0];
  expect(panner.positionX.value).toBeCloseTo(3, 5);
  expect(panner.positionZ.value).toBeCloseTo(0, 5);
});

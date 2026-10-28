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
    this.panningModel  = '';
    this.distanceModel = '';
    this.refDistance   = 0;
    this.maxDistance   = 0;
    this.rolloffFactor = 0;
    this.positionX = { value: 0 };
    this.positionY = { value: 0 };
    this.positionZ = { value: 0 };
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = { value: 1 };
  }
}

class MockConvolverNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
  }
}

// Minimal AudioBuffer stub returned by OfflineAudioContext.startRendering()
class MockAudioBuffer {}

// OfflineAudioContext resolves immediately with a MockAudioBuffer.
class MockOfflineAudioContext {
  constructor(channels, length, sampleRate) {
    this._channels   = channels;
    this._length     = length;
    this._sampleRate = sampleRate;
    this._src        = null;
  }
  createBuffer(ch, len, sr) {
    const buf = { _ch: ch, _len: len, _sr: sr, _data: [] };
    for (let i = 0; i < ch; i++) buf._data.push(new Float32Array(len));
    buf.getChannelData = (c) => buf._data[c];
    return buf;
  }
  createBufferSource() {
    const src = { buffer: null, connect() {}, start() {} };
    this._src = src;
    return src;
  }
  get destination() { return {}; }
  startRendering() { return Promise.resolve(new MockAudioBuffer()); }
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
    this._closed     = false;
    this._sources    = [];
    this._panners    = [];
    this._gainNodes  = [];
    this._convolvers = [];
    this.sampleRate  = 44100;
    audioContextInstances.push(this);
  }
  createMediaStreamSource(stream) {
    const node = new MockAudioNode();
    node._stream = stream;
    this._sources.push(node);
    return node;
  }
  createPanner() {
    const node = new MockPannerNode();
    this._panners.push(node);
    return node;
  }
  createGain() {
    const node = new MockGainNode();
    this._gainNodes.push(node);
    return node;
  }
  createConvolver() {
    const node = new MockConvolverNode();
    this._convolvers.push(node);
    return node;
  }
  async close() { this._closed = true; }
}

class MockMediaStreamTrack {
  constructor(kind) { this.kind = kind; }
}
class MockMediaStream {
  constructor(tracks) { this._tracks = tracks || []; }
  getTracks() { return this._tracks; }
}

global.AudioContext          = MockAudioContext;
global.OfflineAudioContext   = MockOfflineAudioContext;
global.MediaStream           = MockMediaStream;

// ── Module under test ──────────────────────────────────────────────────────

const { SpatialAudio } = require('./spatial-audio');

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeAttached(opts) {
  const sa = new SpatialAudio(opts);
  await sa.attachTrack(new MockMediaStreamTrack('audio'));
  return sa;
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => { audioContextInstances = []; });

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('attachTrack wires source → panner → dryGain → destination', async () => {
  const sa  = await makeAttached();
  const ctx = audioContextInstances[0];

  const source   = ctx._sources[0];
  const panner   = ctx._panners[0];
  const dryGain  = ctx._gainNodes[0];

  expect(source._connectedTo).toContain(panner);
  expect(panner._connectedTo).toContain(dryGain);
  expect(dryGain._connectedTo).toContain(ctx.destination);
});

// Test 2
test('attachTrack wires panner → convolver → wetGain → destination', async () => {
  const sa  = await makeAttached();
  const ctx = audioContextInstances[0];

  const panner    = ctx._panners[0];
  const convolver = ctx._convolvers[0];
  const wetGain   = ctx._gainNodes[1];

  expect(panner._connectedTo).toContain(convolver);
  expect(convolver._connectedTo).toContain(wetGain);
  expect(wetGain._connectedTo).toContain(ctx.destination);
});

// Test 3
test('default reverbMix=0.25 sets dryGain=0.75, wetGain=0.25', async () => {
  const sa  = await makeAttached();
  const ctx = audioContextInstances[0];

  expect(ctx._gainNodes[0].gain.value).toBeCloseTo(0.75, 5); // dry
  expect(ctx._gainNodes[1].gain.value).toBeCloseTo(0.25, 5); // wet
});

// Test 4
test('custom reverbMix=0 results in dry-only gains', async () => {
  const sa  = await makeAttached({ reverbMix: 0 });
  const ctx = audioContextInstances[0];

  expect(ctx._gainNodes[0].gain.value).toBeCloseTo(1, 5);   // dry = 1
  expect(ctx._gainNodes[1].gain.value).toBeCloseTo(0, 5);   // wet = 0
});

// Test 5
test('custom reverbMix=1 results in full-wet gains', async () => {
  const sa  = await makeAttached({ reverbMix: 1 });
  const ctx = audioContextInstances[0];

  expect(ctx._gainNodes[0].gain.value).toBeCloseTo(0, 5);   // dry = 0
  expect(ctx._gainNodes[1].gain.value).toBeCloseTo(1, 5);   // wet = 1
});

// Test 6
test('setReverbMix() updates gain nodes in real time', async () => {
  const sa  = await makeAttached({ reverbMix: 0 });
  const ctx = audioContextInstances[0];

  sa.setReverbMix(0.6);

  expect(ctx._gainNodes[0].gain.value).toBeCloseTo(0.4, 5);
  expect(ctx._gainNodes[1].gain.value).toBeCloseTo(0.6, 5);
});

// Test 7
test('setReverbMix() clamps values outside [0,1]', async () => {
  const sa = await makeAttached();

  sa.setReverbMix(-0.5);
  expect(sa._reverbMix).toBe(0);

  sa.setReverbMix(1.5);
  expect(sa._reverbMix).toBe(1);
});

// Test 8
test('convolver receives an AudioBuffer from _buildRoomIR', async () => {
  const sa  = await makeAttached();
  const ctx = audioContextInstances[0];

  expect(ctx._convolvers[0].buffer).toBeInstanceOf(MockAudioBuffer);
});

// Test 9
test('setSourcePosition(90, 2) sets panner x≈2, z≈0', async () => {
  const sa = await makeAttached();
  sa.setSourcePosition(90, 2);

  const panner = audioContextInstances[0]._panners[0];
  expect(panner.positionX.value).toBeCloseTo(2, 5);
  expect(panner.positionZ.value).toBeCloseTo(0, 5);
});

// Test 10
test('setSourcePosition(0, 5) sets panner x≈0, z≈-5', async () => {
  const sa = await makeAttached();
  sa.setSourcePosition(0, 5);

  const panner = audioContextInstances[0]._panners[0];
  expect(panner.positionX.value).toBeCloseTo(0, 5);
  expect(panner.positionZ.value).toBeCloseTo(-5, 5);
});

// Test 11
test('detach() disconnects all nodes and closes AudioContext', async () => {
  const sa = await makeAttached();
  await sa.detach();

  const ctx = audioContextInstances[0];
  expect(ctx._sources[0]._disconnected).toBe(true);
  expect(ctx._panners[0]._disconnected).toBe(true);
  expect(ctx._convolvers[0]._disconnected).toBe(true);
  expect(ctx._gainNodes[0]._disconnected).toBe(true);
  expect(ctx._gainNodes[1]._disconnected).toBe(true);
  expect(ctx._closed).toBe(true);
  expect(sa.isAttached).toBe(false);
});

// Test 12
test('attachTrack twice replaces previous graph', async () => {
  const sa = new SpatialAudio();
  await sa.attachTrack(new MockMediaStreamTrack('audio'));
  await sa.attachTrack(new MockMediaStreamTrack('audio'));

  expect(sa.isAttached).toBe(true);
  expect(audioContextInstances[0]._closed).toBe(true);
  expect(audioContextInstances[1]._closed).toBe(false);
});

// Test 13
test('isAttached reflects attachment state', async () => {
  const sa = new SpatialAudio();
  expect(sa.isAttached).toBe(false);
  await sa.attachTrack(new MockMediaStreamTrack('audio'));
  expect(sa.isAttached).toBe(true);
});

// Test 13b
test('attachElement wires the same graph as attachTrack', async () => {
  global.MediaElementSource = class extends MockAudioNode {};

  // Patch MockAudioContext to support createMediaElementSource
  const origProto = MockAudioContext.prototype;
  origProto.createMediaElementSource = function(el) {
    const node = new MockAudioNode();
    node._element = el;
    this._sources.push(node);
    return node;
  };

  const sa = new SpatialAudio();
  const fakeEl = { nodeName: 'VIDEO' };
  await sa.attachElement(fakeEl);

  const ctx = audioContextInstances[0];
  expect(ctx._panners.length).toBe(1);
  expect(ctx._gainNodes.length).toBe(2);
  expect(ctx._convolvers.length).toBe(1);
  expect(sa.isAttached).toBe(true);

  delete origProto.createMediaElementSource;
});

// Test 14
test('setSourcePosition and setListenerOrientation before attachTrack do not throw', () => {
  const sa = new SpatialAudio();
  expect(() => sa.setSourcePosition(45, 3)).not.toThrow();
  expect(() => sa.setListenerOrientation(45)).not.toThrow();
});

// Test 15
test('setListenerOrientation(0) points listener forward: forwardX≈0, forwardZ≈-1', async () => {
  const sa = await makeAttached();
  sa.setListenerOrientation(0);

  const { listener } = audioContextInstances[0];
  expect(listener.forwardX.value).toBeCloseTo(0, 5);
  expect(listener.forwardZ.value).toBeCloseTo(-1, 5);
});

// Test 16
test('setListenerOrientation(90) points listener right: forwardX≈1, forwardZ≈0', async () => {
  const sa = await makeAttached();
  sa.setListenerOrientation(90);

  const { listener } = audioContextInstances[0];
  expect(listener.forwardX.value).toBeCloseTo(1, 5);
  expect(listener.forwardZ.value).toBeCloseTo(0, 5);
});

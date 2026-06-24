/**
 * Client-side WebRTC tests using mocked WebSocket and RTCPeerConnection.
 * Runs in Node (jest-environment-node) — browser globals are stubbed manually.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

class MockMediaStream {
  constructor() {
    this.tracks = [];
  }
  getTracks() { return this.tracks; }
  addTrack(t) { this.tracks.push(t); }
}

class MockMediaStreamTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
  }
  stop() {}
}

// Captures all WS instances created during a test
let wsInstances = [];

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this._listeners = {};
    wsInstances.push(this);
  }
  send(data) {
    if (!this._sent) this._sent = [];
    this._sent.push(JSON.parse(data));
  }
  close() { this.readyState = 3; }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  // Test helpers
  _open() {
    this.readyState = 1;
    (this._listeners['open'] || []).forEach((fn) => fn());
  }
  _receive(msg) {
    (this._listeners['message'] || []).forEach((fn) =>
      fn({ data: JSON.stringify(msg) })
    );
  }
  _close() {
    this.readyState = 3;
    (this._listeners['close'] || []).forEach((fn) => fn());
  }
}
MockWebSocket.OPEN = 1;

// MockDataChannel
class MockDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'open';
    this._listeners = {};
    this._sent = [];
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  send(data) { this._sent.push(data); }
  close() { this.readyState = 'closed'; }
  _fireMessage(data) {
    (this._listeners['message'] || []).forEach((fn) => fn({ data }));
  }
  _fireOpen() {
    this.readyState = 'open';
    (this._listeners['open'] || []).forEach((fn) => fn());
  }
}

// RTCPeerConnection mock
let pcInstances = [];

class MockRTCPeerConnection {
  constructor(config) {
    this._config = config || {};
    this._listeners = {};
    this._iceCandidates = [];
    this._dataChannels = [];
    this.localDescription = null;
    this.remoteDescription = null;
    pcInstances.push(this);
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }
  async setLocalDescription(desc) {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }
  async addIceCandidate(c) {
    this._iceCandidates.push(c);
  }
  addTrack() {}
  createDataChannel(label) {
    const dc = new MockDataChannel(label);
    this._dataChannels.push(dc);
    return dc;
  }
  close() {}
  // Test helpers
  _fireIceCandidate(candidate) {
    (this._listeners['icecandidate'] || []).forEach((fn) => fn({ candidate }));
  }
  _fireTrack(track, streams) {
    (this._listeners['track'] || []).forEach((fn) => fn({ track, streams }));
  }
  _fireDataChannel(channel) {
    (this._listeners['datachannel'] || []).forEach((fn) => fn({ channel }));
  }
}

// Inject globals before requiring the module
global.WebSocket = MockWebSocket;
global.RTCPeerConnection = MockRTCPeerConnection;
global.navigator = {
  mediaDevices: {
    getUserMedia: jest.fn(async () => {
      const stream = new MockMediaStream();
      stream.addTrack(new MockMediaStreamTrack('video'));
      stream.addTrack(new MockMediaStreamTrack('audio'));
      return stream;
    }),
  },
};

// ── Module under test ──────────────────────────────────────────────────────

const { WebRTCClient } = require('./webrtc');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeVideoEl() {
  return { srcObject: null, muted: false };
}

function makeClient(overrides = {}) {
  return new WebRTCClient({
    signalingUrl: 'ws://localhost:8080',
    room: 'test-room',
    localVideoEl: makeVideoEl(),
    remoteVideoEl: makeVideoEl(),
    ...overrides,
  });
}

// Flushes all pending microtasks/promises
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  wsInstances = [];
  pcInstances = [];
  jest.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1
test('start() sends a join message to the signaling server', async () => {
  const client = makeClient();
  const startPromise = client.start();

  // Simulate WS opening
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  expect(ws._sent).toContainEqual({ type: 'join', room: 'test-room' });
  client.disconnect();
});

// Test 2
test('on peer-joined, client creates and sends an SDP offer', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'offer', sdp: expect.objectContaining({ type: 'offer' }) })
  );
  client.disconnect();
});

// Test 3
test('on receiving offer, client creates and sends an SDP answer', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'offer', sdp: { type: 'offer', sdp: 'remote-offer' } });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'answer', sdp: expect.objectContaining({ type: 'answer' }) })
  );
  client.disconnect();
});

// Test 4
test('ice-candidate events from PeerConnection are forwarded to server', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  // Trigger peer-joined to create the PeerConnection
  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  pc._fireIceCandidate({ candidate: 'fake-ice-data' });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'ice-candidate', candidate: { candidate: 'fake-ice-data' } })
  );
  client.disconnect();
});

// Test 5
test('incoming ice-candidate messages are added to PeerConnection', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  ws._receive({ type: 'ice-candidate', candidate: { candidate: 'remote-ice' } });
  await flushPromises();

  expect(pc._iceCandidates).toContainEqual({ candidate: 'remote-ice' });
  client.disconnect();
});

// Test 6
test('on peer-left, onStatusChange("disconnected") is called', async () => {
  const client = makeClient();
  const statusChanges = [];
  client.onStatusChange = (s) => statusChanges.push(s);

  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-left' });
  await flushPromises();

  expect(statusChanges).toContain('disconnected');
  client.disconnect();
});

// Test 7
test('remote audio track is added with enabled = false', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  const audioTrack = new MockMediaStreamTrack('audio');
  const stream = new MockMediaStream();
  pc._fireTrack(audioTrack, [stream]);
  await flushPromises();

  expect(audioTrack.enabled).toBe(false);
  client.disconnect();
});

// Test 8
test('when spatialAudio provided, remote audio track is re-enabled and passed to attachTrack', async () => {
  const attachedTracks = [];
  const mockSpatialAudio = { attachTrack: (t) => attachedTracks.push(t) };

  const client = makeClient({ spatialAudio: mockSpatialAudio });
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  const audioTrack = new MockMediaStreamTrack('audio');
  const stream = new MockMediaStream();
  pc._fireTrack(audioTrack, [stream]);
  await flushPromises();

  expect(audioTrack.enabled).toBe(true);
  expect(attachedTracks).toContain(audioTrack);
  client.disconnect();
});

// Test 9
test('when spatialAudio provided, remoteVideoEl is muted', async () => {
  const mockSpatialAudio = { attachTrack: () => {} };
  const remoteVideoEl = makeVideoEl();

  const client = makeClient({ spatialAudio: mockSpatialAudio, remoteVideoEl });
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  const audioTrack = new MockMediaStreamTrack('audio');
  const stream = new MockMediaStream();
  pc._fireTrack(audioTrack, [stream]);
  await flushPromises();

  expect(remoteVideoEl.muted).toBe(true);
  client.disconnect();
});

// ── Data channel tests ─────────────────────────────────────────────────────

// Test 10
test('initiator creates a head-tracking data channel on peer-joined', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const pc = pcInstances[0];
  expect(pc._dataChannels).toContainEqual(
    expect.objectContaining({ label: 'head-tracking' })
  );
  client.disconnect();
});

// Test 11
test('sendData() sends JSON over the data channel', async () => {
  const client = makeClient();
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  client.sendData({ azimuth: 45 });

  const dc = pcInstances[0]._dataChannels[0];
  expect(dc._sent).toContainEqual(JSON.stringify({ azimuth: 45 }));
  client.disconnect();
});

// Test 12
test('incoming data channel messages trigger onDataMessage', async () => {
  const client = makeClient();
  const received = [];
  client.onDataMessage = (d) => received.push(d);

  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const dc = pcInstances[0]._dataChannels[0];
  dc._fireMessage(JSON.stringify({ azimuth: 90 }));

  expect(received).toContainEqual({ azimuth: 90 });
  client.disconnect();
});

// Test 13
test('responder receives data channel via datachannel event and wires onDataMessage', async () => {
  const client = makeClient();
  const received = [];
  client.onDataMessage = (d) => received.push(d);

  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  // Responder path: receives offer, sends answer
  ws._receive({ type: 'offer', sdp: { type: 'offer', sdp: 'remote-offer' } });
  await flushPromises();

  const pc = pcInstances[0];
  const dc = new MockDataChannel('head-tracking');
  pc._fireDataChannel(dc);
  dc._fireMessage(JSON.stringify({ azimuth: 180 }));

  expect(received).toContainEqual({ azimuth: 180 });
  client.disconnect();
});

// ── ICE / STUN tests ───────────────────────────────────────────────────────

// Test 14
test('RTCPeerConnection is created with the provided iceServers', async () => {
  const iceServers = [{ urls: 'stun:stun.example.com:19302' }];
  const client = makeClient({ iceServers });
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  expect(pcInstances[0]._config.iceServers).toEqual(iceServers);
  client.disconnect();
});

// Test 15
test('default ICE config includes at least one STUN server', async () => {
  const client = makeClient(); // no iceServers specified
  client.start();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  ws._receive({ type: 'peer-joined' });
  await flushPromises();

  const { iceServers } = pcInstances[0]._config;
  expect(iceServers.some((s) => s.urls.includes('stun:'))).toBe(true);
  client.disconnect();
});

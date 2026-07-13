/**
 * Client-side WebRTC tests — multi-peer edition.
 * Runs in Node (jest-environment-node) — browser globals are stubbed manually.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

class MockMediaStream {
  constructor() { this.tracks = []; }
  getTracks() { return this.tracks; }
  addTrack(t) { this.tracks.push(t); }
}

class MockMediaStreamTrack {
  constructor(kind) { this.kind = kind; this.enabled = true; }
  stop() {}
}

let wsInstances = [];

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this._listeners = {};
    this._sent = [];
    wsInstances.push(this);
  }
  send(data) { this._sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  _open()  { this.readyState = 1; (this._listeners['open']  || []).forEach(fn => fn()); }
  _receive(msg) { (this._listeners['message'] || []).forEach(fn => fn({ data: JSON.stringify(msg) })); }
  _close() { this.readyState = 3; (this._listeners['close'] || []).forEach(fn => fn()); }
}
MockWebSocket.OPEN = 1;

class MockDataChannel {
  constructor(label) {
    this.label = label; this.readyState = 'open';
    this._listeners = {}; this._sent = [];
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  send(data) { this._sent.push(data); }
  close() { this.readyState = 'closed'; }
  _fireMessage(data) { (this._listeners['message'] || []).forEach(fn => fn({ data })); }
}

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
  async createOffer()  { return { type: 'offer',  sdp: 'mock-offer-sdp' }; }
  async createAnswer() { return { type: 'answer', sdp: 'mock-answer-sdp' }; }
  async setLocalDescription(desc)  { this.localDescription  = desc; }
  async setRemoteDescription(desc) { this.remoteDescription = desc; }
  async addIceCandidate(c) { this._iceCandidates.push(c); }
  addTrack() {}
  createDataChannel(label) {
    const dc = new MockDataChannel(label);
    this._dataChannels.push(dc);
    return dc;
  }
  close() {}
  _fireIceCandidate(candidate) { (this._listeners['icecandidate'] || []).forEach(fn => fn({ candidate })); }
  _fireTrack(track, streams)   { (this._listeners['track']        || []).forEach(fn => fn({ track, streams })); }
  _fireDataChannel(channel)    { (this._listeners['datachannel']  || []).forEach(fn => fn({ channel })); }
}

global.WebSocket         = MockWebSocket;
global.RTCPeerConnection = MockRTCPeerConnection;
global.navigator = {
  mediaDevices: {
    getUserMedia: jest.fn(async () => {
      const s = new MockMediaStream();
      s.addTrack(new MockMediaStreamTrack('video'));
      s.addTrack(new MockMediaStreamTrack('audio'));
      return s;
    }),
  },
};

// ── Module under test ──────────────────────────────────────────────────────

const { WebRTCClient } = require('./webrtc');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeVideoEl() { return { srcObject: null, muted: false }; }

/**
 * Build a client with a default onPeerJoined that returns a fresh video element.
 * In multi-peer mode there is no single remoteVideoEl constructor arg.
 */
function makeClient(overrides = {}) {
  const client = new WebRTCClient({
    signalingUrl: 'ws://localhost:8080',
    room: 'test-room',
    localVideoEl: makeVideoEl(),
    ...overrides,
  });
  if (!client.onPeerJoined) {
    client.onPeerJoined = () => makeVideoEl();
  }
  return client;
}

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

/** Simulate opening WS + receiving welcome with our assigned peerId. */
async function openAndWelcome(client, myPeerId = 'me-001', existingPeers = []) {
  await flushPromises(); // let getUserMedia resolve so WS gets created
  const ws = wsInstances[wsInstances.length - 1];
  ws._open();
  await flushPromises();
  ws._receive({ type: 'welcome', peerId: myPeerId, peers: existingPeers });
  await flushPromises();
  return ws;
}

beforeEach(() => {
  wsInstances = [];
  pcInstances = [];
  jest.clearAllMocks();
});

// ── Signaling / connection tests ───────────────────────────────────────────

// Test 1
test('start() sends a join message to the signaling server', async () => {
  const client = makeClient();
  client.start();
  await flushPromises(); // let getUserMedia resolve
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  expect(ws._sent).toContainEqual({ type: 'join', room: 'test-room' });
  client.disconnect();
});

// Test 2
test('start() includes name in join message when provided', async () => {
  const client = makeClient({ name: 'Alice' });
  client.start();
  await flushPromises();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  expect(ws._sent).toContainEqual({ type: 'join', room: 'test-room', name: 'Alice' });
  client.disconnect();
});

// Test 3
test('start() omits name from join message when name is empty', async () => {
  const client = makeClient();
  client.start();
  await flushPromises();
  const ws = wsInstances[0];
  ws._open();
  await flushPromises();

  const joinMsg = ws._sent.find(m => m.type === 'join');
  expect(joinMsg).toBeDefined();
  expect(joinMsg.name).toBeUndefined();
  client.disconnect();
});

// Test 4
test('welcome stores our peerId', async () => {
  const client = makeClient();
  client.start();
  await openAndWelcome(client, 'peer-xyz');

  expect(client._myPeerId).toBe('peer-xyz');
  client.disconnect();
});

// Test 5
test('welcome with existing peers pre-creates peer entries', async () => {
  const peerJoinedCalls = [];
  const client = makeClient();
  client.onPeerJoined = (id, name) => { peerJoinedCalls.push({ id, name }); return makeVideoEl(); };
  client.start();
  await openAndWelcome(client, 'me', [
    { peerId: 'p1', name: 'Alice' },
    { peerId: 'p2', name: 'Bob' },
  ]);

  expect(peerJoinedCalls).toHaveLength(2);
  expect(client._peers.has('p1')).toBe(true);
  expect(client._peers.has('p2')).toBe(true);
  client.disconnect();
});

// ── Initiator path (existing peer gets peer-joined) ────────────────────────

// Test 6
test('on peer-joined, client creates and sends an SDP offer addressed to that peer', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'new-peer', name: 'Bob' });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'offer', to: 'new-peer',
      sdp: expect.objectContaining({ type: 'offer' }) })
  );
  client.disconnect();
});

// Test 7
test('on peer-joined, a head-tracking data channel is created', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'new-peer', name: 'Bob' });
  await flushPromises();

  const pc = pcInstances[0];
  expect(pc._dataChannels).toContainEqual(expect.objectContaining({ label: 'head-tracking' }));
  client.disconnect();
});

// Test 8
test('on peer-joined, onPeerJoined callback fires with peerId and name', async () => {
  const joined = [];
  const client = makeClient();
  client.onPeerJoined = (id, name) => { joined.push({ id, name }); return makeVideoEl(); };
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p99', name: 'Carol' });
  await flushPromises();

  expect(joined).toContainEqual({ id: 'p99', name: 'Carol' });
  client.disconnect();
});

// ── Responder path (new joiner receives offer) ─────────────────────────────

// Test 9
test('on receiving offer, client sends an answer addressed to the offering peer', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client, 'me', [{ peerId: 'existing', name: 'Alice' }]);

  ws._receive({ type: 'offer', from: 'existing', sdp: { type: 'offer', sdp: 'remote-offer' } });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'answer', to: 'existing',
      sdp: expect.objectContaining({ type: 'answer' }) })
  );
  client.disconnect();
});

// Test 10
test('RTCPeerConnection is created with the provided iceServers', async () => {
  const iceServers = [{ urls: 'stun:stun.example.com:19302' }];
  const client = makeClient({ iceServers });
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  expect(pcInstances[0]._config.iceServers).toEqual(iceServers);
  client.disconnect();
});

// Test 11
test('default ICE config includes at least one STUN server', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const { iceServers } = pcInstances[0]._config;
  expect(iceServers.some(s => s.urls.includes('stun:'))).toBe(true);
  client.disconnect();
});

// ── ICE candidate routing ──────────────────────────────────────────────────

// Test 12
test('local ICE candidates are forwarded to server with correct "to" peerId', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p-far', name: 'Dave' });
  await flushPromises();

  pcInstances[0]._fireIceCandidate({ candidate: 'ice-data' });
  await flushPromises();

  expect(ws._sent).toContainEqual(
    expect.objectContaining({ type: 'ice-candidate', to: 'p-far', candidate: { candidate: 'ice-data' } })
  );
  client.disconnect();
});

// Test 13
test('incoming ice-candidate is applied to the correct peer connection', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p-far', name: 'Dave' });
  await flushPromises();

  ws._receive({ type: 'ice-candidate', from: 'p-far', candidate: { candidate: 'remote-ice' } });
  await flushPromises();

  expect(pcInstances[0]._iceCandidates).toContainEqual({ candidate: 'remote-ice' });
  client.disconnect();
});

// ── Track handling ─────────────────────────────────────────────────────────

// Test 14
test('remote audio track is disabled when no spatialAudio provided', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const audioTrack = new MockMediaStreamTrack('audio');
  pcInstances[0]._fireTrack(audioTrack, [new MockMediaStream()]);
  await flushPromises();

  expect(audioTrack.enabled).toBe(false);
  client.disconnect();
});

// Test 15
test('when spatialAudio provided, remote audio track is re-enabled and passed to attachTrack', async () => {
  const attached = [];
  const mockSpatialAudio = { attachTrack: t => attached.push(t) };

  const client = makeClient({ spatialAudio: mockSpatialAudio });
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const audioTrack = new MockMediaStreamTrack('audio');
  pcInstances[0]._fireTrack(audioTrack, [new MockMediaStream()]);
  await flushPromises();

  expect(audioTrack.enabled).toBe(true);
  expect(attached).toContain(audioTrack);
  client.disconnect();
});

// Test 16
test('when spatialAudio provided, the peer remoteVideoEl is muted', async () => {
  const mockSpatialAudio = { attachTrack: () => {} };
  const peerVideoEl = makeVideoEl();
  const client = makeClient({ spatialAudio: mockSpatialAudio });
  client.onPeerJoined = () => peerVideoEl;
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const audioTrack = new MockMediaStreamTrack('audio');
  pcInstances[0]._fireTrack(audioTrack, [new MockMediaStream()]);
  await flushPromises();

  expect(peerVideoEl.muted).toBe(true);
  client.disconnect();
});

// Test 17
test('remote video track sets srcObject on peer remoteVideoEl', async () => {
  const peerVideoEl = makeVideoEl();
  const client = makeClient();
  client.onPeerJoined = () => peerVideoEl;
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const stream = new MockMediaStream();
  const videoTrack = new MockMediaStreamTrack('video');
  pcInstances[0]._fireTrack(videoTrack, [stream]);
  await flushPromises();

  expect(peerVideoEl.srcObject).toBe(stream);
  client.disconnect();
});

// ── Data channel tests ─────────────────────────────────────────────────────

// Test 18
test('sendData() broadcasts JSON to all open data channels', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  client.sendData({ azimuth: 45 });

  const dc = pcInstances[0]._dataChannels[0];
  expect(dc._sent).toContainEqual(JSON.stringify({ azimuth: 45 }));
  client.disconnect();
});

// Test 19
test('sendData() with peerId sends only to that peer', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'A' });
  await flushPromises();
  ws._receive({ type: 'peer-joined', peerId: 'p2', name: 'B' });
  await flushPromises();

  client.sendData({ azimuth: 30 }, 'p1');

  const dc1 = client._peers.get('p1').dc;
  const dc2 = client._peers.get('p2').dc;
  expect(dc1._sent).toContainEqual(JSON.stringify({ azimuth: 30 }));
  expect(dc2._sent).toHaveLength(0);
  client.disconnect();
});

// Test 20
test('initiator data channel messages trigger onDataMessage with peerId', async () => {
  const received = [];
  const client = makeClient();
  client.onDataMessage = (peerId, data) => received.push({ peerId, data });
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();

  const dc = pcInstances[0]._dataChannels[0];
  dc._fireMessage(JSON.stringify({ azimuth: 90 }));

  expect(received).toContainEqual({ peerId: 'p1', data: { azimuth: 90 } });
  client.disconnect();
});

// Test 21
test('responder data channel (via datachannel event) wires onDataMessage with peerId', async () => {
  const received = [];
  const client = makeClient();
  client.onDataMessage = (peerId, data) => received.push({ peerId, data });
  client.start();
  const ws = await openAndWelcome(client, 'me', [{ peerId: 'p1', name: 'X' }]);

  ws._receive({ type: 'offer', from: 'p1', sdp: { type: 'offer', sdp: 'remote-offer' } });
  await flushPromises();

  const pc = pcInstances[0];
  const dc = new MockDataChannel('head-tracking');
  pc._fireDataChannel(dc);
  dc._fireMessage(JSON.stringify({ azimuth: 180 }));

  expect(received).toContainEqual({ peerId: 'p1', data: { azimuth: 180 } });
  client.disconnect();
});

// ── Peer lifecycle & status ────────────────────────────────────────────────

// Test 22
test('status changes to "connected" after receiving answer', async () => {
  const statuses = [];
  const client = makeClient();
  client.onStatusChange = s => statuses.push(s);
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();
  ws._receive({ type: 'answer', from: 'p1', sdp: { type: 'answer', sdp: 'ans' } });
  await flushPromises();

  expect(statuses).toContain('connected');
  client.disconnect();
});

// Test 23
test('on peer-left, onPeerLeft fires with peerId and name', async () => {
  const leftEvents = [];
  const client = makeClient();
  client.onPeerLeft = (id, name) => leftEvents.push({ id, name });
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'Alice' });
  await flushPromises();
  ws._receive({ type: 'peer-left', peerId: 'p1', name: 'Alice' });
  await flushPromises();

  expect(leftEvents).toContainEqual({ id: 'p1', name: 'Alice' });
  client.disconnect();
});

// Test 24
test('on peer-left, peer is removed from _peers map', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();
  expect(client._peers.has('p1')).toBe(true);

  ws._receive({ type: 'peer-left', peerId: 'p1', name: 'X' });
  await flushPromises();
  expect(client._peers.has('p1')).toBe(false);
  client.disconnect();
});

// Test 25
test('status is "waiting" after last peer leaves (still in room)', async () => {
  const statuses = [];
  const client = makeClient();
  client.onStatusChange = s => statuses.push(s);
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  await flushPromises();
  ws._receive({ type: 'peer-left', peerId: 'p1', name: 'X' });
  await flushPromises();

  expect(statuses[statuses.length - 1]).toBe('waiting');
  client.disconnect();
});

// Test 26
test('disconnect() closes all peer connections and reports disconnected', async () => {
  const statuses = [];
  const client = makeClient();
  client.onStatusChange = s => statuses.push(s);
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'X' });
  ws._receive({ type: 'peer-joined', peerId: 'p2', name: 'Y' });
  await flushPromises();

  client.disconnect();

  expect(statuses).toContain('disconnected');
  expect(client._peers.size).toBe(0);
});

// Test 27
test('two peers joining creates two independent RTCPeerConnections', async () => {
  const client = makeClient();
  client.start();
  const ws = await openAndWelcome(client);

  ws._receive({ type: 'peer-joined', peerId: 'p1', name: 'A' });
  await flushPromises();
  ws._receive({ type: 'peer-joined', peerId: 'p2', name: 'B' });
  await flushPromises();

  expect(pcInstances).toHaveLength(2);
  expect(pcInstances[0]).not.toBe(pcInstances[1]);
  client.disconnect();
});

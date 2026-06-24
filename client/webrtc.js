const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN placeholder — fill in when you have a server:
  // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' },
];

class WebRTCClient {
  constructor({ signalingUrl, room, localVideoEl, remoteVideoEl, spatialAudio = null, iceServers = DEFAULT_ICE_SERVERS }) {
    this._signalingUrl = signalingUrl;
    this._room = room;
    this._localVideoEl = localVideoEl;
    this._remoteVideoEl = remoteVideoEl;
    this._spatialAudio = spatialAudio;
    this._iceServers   = iceServers;

    this._ws = null;
    this._pc = null;
    this._dc = null;
    this._localStream = null;

    // Callbacks — set by caller
    this.onStatusChange  = null;
    this.onIceStateChange = null;
    this.onError         = null;
    this.onDataMessage   = null;
  }

  async start() {
    this._status('connecting');
    await this._connectSignaling();
    await this._getLocalMedia();
  }

  sendData(data) {
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this._dc) {
      this._dc.close();
      this._dc = null;
    }
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    if (this._localStream) {
      this._localStream.getTracks().forEach((t) => t.stop());
      this._localStream = null;
    }
    this._status('disconnected');
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _connectSignaling() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._signalingUrl);
      this._ws = ws;

      ws.addEventListener('open', () => {
        this._send({ type: 'join', room: this._room });
        resolve();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this._handleSignal(msg);
      });

      ws.addEventListener('close', () => {
        // Only report disconnected if we weren't the ones closing
        if (this._pc) this._status('disconnected');
      });

      ws.addEventListener('error', (err) => {
        if (this.onError) this.onError(new Error('WebSocket error'));
        reject(err);
      });
    });
  }

  async _getLocalMedia() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (videoErr) {
      // Camera may be in use by another tab — fall back to audio only
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        if (this.onError) this.onError(new Error('Camera unavailable — audio only'));
      } catch (err) {
        if (this.onError) this.onError(err);
        throw err;
      }
    }
    this._localStream = stream;
    this._localVideoEl.srcObject = stream;
    this._localVideoEl.muted = true;
  }

  _createPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this._pc = pc;

    // ICE connection state changes
    pc.addEventListener('iceconnectionstatechange', () => {
      if (this.onIceStateChange) this.onIceStateChange(pc.iceConnectionState);
    });

    // Forward local ICE candidates to peer via signaling
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) {
        this._send({ type: 'ice-candidate', candidate });
      }
    });

    // Attach remote tracks
    pc.addEventListener('track', ({ track, streams }) => {
      if (track.kind === 'audio') {
        if (this._spatialAudio) {
          // Route through spatial audio pipeline; mute the HTML element to avoid doubling
          track.enabled = true;
          this._remoteVideoEl.muted = true;
          this._spatialAudio.attachTrack(track);
        } else {
          // No spatial pipeline yet — keep muted
          track.enabled = false;
        }
      }

      if (streams && streams[0]) {
        this._remoteVideoEl.srcObject = streams[0];
      }
    });

    // Responder receives data channel created by initiator
    pc.addEventListener('datachannel', ({ channel }) => {
      this._dc = channel;
      channel.addEventListener('message', ({ data }) => {
        if (this.onDataMessage) this.onDataMessage(JSON.parse(data));
      });
    });

    // Add local tracks to the connection
    if (this._localStream) {
      this._localStream.getTracks().forEach((track) => {
        this._pc.addTrack(track, this._localStream);
      });
    }

    return pc;
  }

  async _handleSignal(msg) {
    try {
      switch (msg.type) {
        case 'peer-joined':
          await this._startOffer();
          break;

        case 'offer':
          await this._handleOffer(msg.sdp);
          break;

        case 'answer':
          if (this._pc) {
            await this._pc.setRemoteDescription(msg.sdp);
            this._status('connected');
          }
          break;

        case 'ice-candidate':
          if (this._pc) {
            await this._pc.addIceCandidate(msg.candidate);
          }
          break;

        case 'peer-left':
          this._status('disconnected');
          break;

        case 'room-full':
          if (this.onError) this.onError(new Error('Room is full'));
          break;
      }
    } catch (err) {
      if (this.onError) this.onError(err);
    }
  }

  async _startOffer() {
    this._createPeerConnection();

    // Initiator owns the data channel
    this._dc = this._pc.createDataChannel('head-tracking');
    this._dc.addEventListener('message', ({ data }) => {
      if (this.onDataMessage) this.onDataMessage(JSON.parse(data));
    });

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    this._send({ type: 'offer', sdp: this._pc.localDescription });
  }

  async _handleOffer(sdp) {
    this._createPeerConnection();
    await this._pc.setRemoteDescription(sdp);
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    this._send({ type: 'answer', sdp: this._pc.localDescription });
    this._status('connected');
  }

  _send(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  _status(s) {
    if (this.onStatusChange) this.onStatusChange(s);
  }
}

// Export for Node (tests) and expose as global for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebRTCClient };
}

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN placeholder — fill in when you have a server:
  // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' },
];

class WebRTCClient {
  constructor({ signalingUrl, room, localVideoEl,
                spatialAudio = null, iceServers = DEFAULT_ICE_SERVERS, name = '' }) {
    this._signalingUrl = signalingUrl;
    this._room         = room;
    this._name         = name;
    this._localVideoEl = localVideoEl;
    this._spatialAudio = spatialAudio;
    this._iceServers   = iceServers;

    this._ws          = null;
    this._myPeerId    = null;
    this._localStream = null;

    // peerId → { pc, dc, name, remoteVideoEl }
    this._peers = new Map();

    // ── Callbacks set by caller ───────────────────────────────────────────
    // Called when a peer joins. Must return an HTMLVideoElement for that peer.
    this.onPeerJoined     = null;   // (peerId, name) → HTMLVideoElement
    // Called when a peer leaves.
    this.onPeerLeft       = null;   // (peerId, name)
    // Data-channel message from a specific peer.
    this.onDataMessage    = null;   // (peerId, data)
    // ICE state change for a specific peer connection.
    this.onIceStateChange = null;   // (peerId, iceState)
    // Overall room status: 'connecting' | 'waiting' | 'connected' | 'disconnected'
    this.onStatusChange   = null;   // (status)
    this.onError          = null;   // (Error)
  }

  async start() {
    this._status('connecting');
    await this._getLocalMedia();
    await this._connectSignaling();
  }

  /**
   * Send data to one peer (by peerId) or broadcast to all open data channels.
   */
  sendData(data, peerId = null) {
    const payload = JSON.stringify(data);
    if (peerId) {
      const peer = this._peers.get(peerId);
      if (peer?.dc?.readyState === 'open') peer.dc.send(payload);
    } else {
      for (const peer of this._peers.values()) {
        if (peer.dc?.readyState === 'open') peer.dc.send(payload);
      }
    }
  }

  disconnect() {
    for (const peer of this._peers.values()) {
      peer.dc?.close();
      peer.pc?.close();
    }
    this._peers.clear();

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
        const msg = { type: 'join', room: this._room };
        if (this._name) msg.name = this._name;
        this._send(msg);
        resolve();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this._handleSignal(msg);
      });

      ws.addEventListener('close', () => {
        if (this._peers.size > 0) this._status('disconnected');
      });

      ws.addEventListener('error', (err) => {
        if (this.onError) this.onError(new Error('WebSocket error'));
        reject(err);
      });
    });
  }

  async _getLocalMedia() {
    if (!navigator.mediaDevices) {
      if (this.onError) this.onError(new Error('Camera unavailable on plain HTTP — connecting without local video'));
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
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

  /**
   * Create an RTCPeerConnection for the given peerId.
   * The peer entry MUST already exist in this._peers before calling.
   */
  _createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });

    pc.addEventListener('iceconnectionstatechange', () => {
      if (this.onIceStateChange) this.onIceStateChange(peerId, pc.iceConnectionState);
    });

    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this._send({ type: 'ice-candidate', to: peerId, candidate });
    });

    pc.addEventListener('track', ({ track, streams }) => {
      const peer = this._peers.get(peerId);
      if (!peer) return;

      if (track.kind === 'audio') {
        if (this._spatialAudio) {
          track.enabled = true;
          if (peer.remoteVideoEl) peer.remoteVideoEl.muted = true;
          this._spatialAudio.attachTrack(track);
        } else {
          track.enabled = false;
        }
      }

      if (streams?.[0] && peer.remoteVideoEl) {
        peer.remoteVideoEl.srcObject = streams[0];
      }
    });

    pc.addEventListener('datachannel', ({ channel }) => {
      const peer = this._peers.get(peerId);
      if (peer) peer.dc = channel;
      channel.addEventListener('message', ({ data }) => {
        if (this.onDataMessage) this.onDataMessage(peerId, JSON.parse(data));
      });
    });

    if (this._localStream) {
      this._localStream.getTracks().forEach((track) => pc.addTrack(track, this._localStream));
    }

    return pc;
  }

  async _handleSignal(msg) {
    try {
      switch (msg.type) {

        // Server assigns our peerId and lists who is already in the room.
        // Pre-create peer slots — offers from existing peers will arrive shortly.
        case 'welcome': {
          this._myPeerId = msg.peerId;
          for (const { peerId, name } of (msg.peers || [])) {
            const remoteVideoEl = this.onPeerJoined ? this.onPeerJoined(peerId, name) : null;
            const pc = this._createPeerConnection(peerId);
            this._peers.set(peerId, { pc, dc: null, name, remoteVideoEl });
          }
          this._updateStatus();
          break;
        }

        // A new peer joined — we are an existing peer, so we initiate.
        case 'peer-joined': {
          const { peerId, name } = msg;
          const remoteVideoEl = this.onPeerJoined ? this.onPeerJoined(peerId, name || '') : null;
          const pc = this._createPeerConnection(peerId);
          const dc = pc.createDataChannel('head-tracking');
          dc.addEventListener('message', ({ data }) => {
            if (this.onDataMessage) this.onDataMessage(peerId, JSON.parse(data));
          });
          this._peers.set(peerId, { pc, dc, name: name || '', remoteVideoEl });

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this._send({ type: 'offer', to: peerId, sdp: pc.localDescription });
          break;
        }

        // Incoming offer from an existing peer (we are the new joiner / responder).
        case 'offer': {
          const fromId = msg.from;
          let peer = this._peers.get(fromId);
          if (!peer) {
            // Shouldn't happen after welcome pre-creates slots, but handle gracefully.
            const remoteVideoEl = this.onPeerJoined ? this.onPeerJoined(fromId, '') : null;
            const pc = this._createPeerConnection(fromId);
            peer = { pc, dc: null, name: '', remoteVideoEl };
            this._peers.set(fromId, peer);
          }
          await peer.pc.setRemoteDescription(msg.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this._send({ type: 'answer', to: fromId, sdp: peer.pc.localDescription });
          this._updateStatus();
          break;
        }

        case 'answer': {
          const peer = this._peers.get(msg.from);
          if (peer) {
            await peer.pc.setRemoteDescription(msg.sdp);
            this._updateStatus();
          }
          break;
        }

        case 'ice-candidate': {
          const peer = this._peers.get(msg.from);
          if (peer) await peer.pc.addIceCandidate(msg.candidate);
          break;
        }

        case 'peer-left': {
          const { peerId, name } = msg;
          const peer = this._peers.get(peerId);
          if (peer) {
            peer.dc?.close();
            peer.pc?.close();
            this._peers.delete(peerId);
          }
          if (this.onPeerLeft) this.onPeerLeft(peerId, name || '');
          this._updateStatus();
          break;
        }

        case 'room-cleared':
          this._status('disconnected');
          break;
      }
    } catch (err) {
      if (this.onError) this.onError(err);
    }
  }

  _updateStatus() {
    this._status(this._peers.size > 0 ? 'connected' : 'waiting');
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

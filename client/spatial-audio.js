class SpatialAudio {
  constructor() {
    this._ctx = null;
    this._source = null;
    this._panner = null;
  }

  get isAttached() {
    return this._ctx !== null;
  }

  attachTrack(track) {
    if (this._ctx) this._teardown();

    const ctx = new AudioContext();
    this._ctx = ctx;

    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    this._source = source;

    this._connectPanner(ctx, source);
  }

  attachElement(videoEl) {
    if (this._ctx) this._teardown();

    const ctx = new AudioContext();
    this._ctx = ctx;

    const source = ctx.createMediaElementSource(videoEl);
    this._source = source;

    this._connectPanner(ctx, source);
  }

  _connectPanner(ctx, source) {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    this._panner = panner;

    source.connect(panner);
    panner.connect(ctx.destination);
  }

  setSourcePosition(azimuth, distance) {
    if (!this._panner) return;

    const rad = (azimuth * Math.PI) / 180;
    this._panner.positionX.value = distance * Math.sin(rad);
    this._panner.positionY.value = 0;
    this._panner.positionZ.value = -distance * Math.cos(rad);
  }

  setListenerOrientation(azimuth) {
    if (!this._ctx) return;

    const rad = (azimuth * Math.PI) / 180;
    this._ctx.listener.forwardX.value = Math.sin(rad);
    this._ctx.listener.forwardY.value = 0;
    this._ctx.listener.forwardZ.value = -Math.cos(rad);
  }

  async detach() {
    if (!this._ctx) return;
    this._teardown();
  }

  _teardown() {
    if (this._source) {
      this._source.disconnect();
      this._source = null;
    }
    if (this._panner) {
      this._panner.disconnect();
      this._panner = null;
    }
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpatialAudio };
}

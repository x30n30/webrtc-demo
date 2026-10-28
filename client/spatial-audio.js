class SpatialAudio {
  /**
   * @param {object} opts
   * @param {number} [opts.reverbMix=0.25]  Initial wet/dry ratio (0 = dry, 1 = full reverb).
   */
  constructor({ reverbMix = 0.25 } = {}) {
    this._ctx       = null;
    this._source    = null;
    this._panner    = null;
    this._convolver = null;
    this._dryGain   = null;
    this._wetGain   = null;
    this._reverbMix = reverbMix;
  }

  get isAttached() {
    return this._ctx !== null;
  }

  /**
   * Attach a remote audio track and build the full signal graph:
   *
   *   source → panner ─┬─ dryGain ──────────────┬─► destination
   *                     └─ convolver → wetGain ──┘
   *
   * The convolver uses a synthetic room impulse response (decaying white
   * noise) so no external IR file is needed.
   */
  async attachTrack(track) {
    if (this._ctx) this._teardown();

    const ctx = new AudioContext();
    this._ctx = ctx;

    const stream = new MediaStream([track]);
    this._source = ctx.createMediaStreamSource(stream);

    await this._buildGraph(ctx, this._source);
  }

  /**
   * Attach a <video> or <audio> element as the audio source.
   * Use this when the remote stream is already bound to a media element
   * (e.g. via srcObject) and you want to spatialise it.
   *
   * NOTE: A MediaElementSource can only be created once per element.
   *
   * @param {HTMLMediaElement} videoEl
   */
  async attachElement(videoEl) {
    if (this._ctx) this._teardown();

    const ctx = new AudioContext();
    this._ctx = ctx;

    this._source = ctx.createMediaElementSource(videoEl);

    await this._buildGraph(ctx, this._source);
  }

  /**
   * Internal: wire source through panner + dry/wet reverb to destination.
   * Shared by attachTrack() and attachElement().
   *
   * @param {AudioContext} ctx
   * @param {AudioNode}    source
   */
  async _buildGraph(ctx, source) {
    // ── HRTF panner ─────────────────────────────────────────────────────────
    const panner = ctx.createPanner();
    panner.panningModel  = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance   = 1;
    panner.maxDistance   = 10000;
    panner.rolloffFactor = 1;
    this._panner = panner;

    // ── Dry path gain ────────────────────────────────────────────────────────
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - this._reverbMix;
    this._dryGain = dryGain;

    // ── Convolver (room reverb) ──────────────────────────────────────────────
    const convolver = ctx.createConvolver();
    convolver.buffer = await this._buildRoomIR(ctx);
    this._convolver = convolver;

    const wetGain = ctx.createGain();
    wetGain.gain.value = this._reverbMix;
    this._wetGain = wetGain;

    // ── Wire graph ───────────────────────────────────────────────────────────
    source.connect(panner);

    panner.connect(dryGain);
    dryGain.connect(ctx.destination);

    panner.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(ctx.destination);
  }

  /**
   * Set the speaker's position in world space.
   * @param {number} azimuth   Degrees clockwise from front (0 = ahead, 90 = right).
   * @param {number} distance  Distance from listener (metres, default 1).
   */
  setSourcePosition(azimuth, distance) {
    if (!this._panner) return;

    const rad = (azimuth * Math.PI) / 180;
    this._panner.positionX.value =  distance * Math.sin(rad);
    this._panner.positionY.value =  0;
    this._panner.positionZ.value = -distance * Math.cos(rad);
  }

  /**
   * Rotate the listener's forward vector to match head yaw.
   * @param {number} azimuth  Degrees clockwise from front.
   */
  setListenerOrientation(azimuth) {
    if (!this._ctx) return;

    const rad = (azimuth * Math.PI) / 180;
    this._ctx.listener.forwardX.value =  Math.sin(rad);
    this._ctx.listener.forwardY.value =  0;
    this._ctx.listener.forwardZ.value = -Math.cos(rad);
  }

  /**
   * Blend between dry (0) and reverb (1) in real time.
   * @param {number} mix  Value in [0, 1].
   */
  setReverbMix(mix) {
    this._reverbMix = Math.max(0, Math.min(1, mix));
    if (this._dryGain) this._dryGain.gain.value = 1 - this._reverbMix;
    if (this._wetGain) this._wetGain.gain.value  = this._reverbMix;
  }

  async detach() {
    if (!this._ctx) return;
    this._teardown();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Build a synthetic stereo room impulse response by rendering decaying
   * white noise through an OfflineAudioContext.
   *
   * Characteristics (tuned for a small meeting room feel):
   *   - Duration  : 0.8 s
   *   - Decay     : exponential, time constant ≈ 0.15 s
   *   - Channels  : 2 (stereo, slightly decorrelated L/R for width)
   *
   * @param {AudioContext} ctx  Live context (used only for sample rate).
   * @returns {Promise<AudioBuffer>}
   */
  async _buildRoomIR(ctx) {
    const sampleRate  = ctx.sampleRate;
    const duration    = 0.8;          // seconds
    const decay       = 0.15;         // exponential time constant (s)
    const numSamples  = Math.floor(sampleRate * duration);
    const numChannels = 2;

    const offline = new OfflineAudioContext(numChannels, numSamples, sampleRate);

    // Fill each channel with exponentially decaying white noise.
    // L and R are independent draws so the reverb tail has stereo width.
    const irBuffer = offline.createBuffer(numChannels, numSamples, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t / decay);
      }
    }

    // Play the IR buffer through the offline context so normalisation
    // and any future offline processing can be applied here if needed.
    const src = offline.createBufferSource();
    src.buffer = irBuffer;
    src.connect(offline.destination);
    src.start(0);

    return offline.startRendering();
  }

  _teardown() {
    if (this._source)    { this._source.disconnect();    this._source    = null; }
    if (this._panner)    { this._panner.disconnect();    this._panner    = null; }
    if (this._convolver) { this._convolver.disconnect(); this._convolver = null; }
    if (this._dryGain)   { this._dryGain.disconnect();   this._dryGain   = null; }
    if (this._wetGain)   { this._wetGain.disconnect();   this._wetGain   = null; }
    if (this._ctx)       { this._ctx.close();            this._ctx       = null; }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpatialAudio };
}

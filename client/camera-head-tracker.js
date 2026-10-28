const _landmarkToYaw = typeof require !== 'undefined'
  ? require('./landmark-to-yaw').landmarkToYaw
  : landmarkToYaw; // browser global

const _YawEstimator = typeof require !== 'undefined'
  ? require('./landmark-to-yaw').YawEstimator
  : YawEstimator; // browser global

function yawToAzimuth(yaw) {
  // yaw 0° (forward)  → azimuth   0° (sound ahead)
  // yaw +45° (right)  → azimuth  90° (sound to right)
  // yaw -45° (left)   → azimuth 270° (sound to left)
  return ((yaw / 45) * 90 + 360) % 360;
}

class CameraHeadTracker {
  constructor({
    FaceMeshClass,
    setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearIntervalFn = (id) => clearInterval(id),
  } = {}) {
    this._FaceMeshClass    = FaceMeshClass || (typeof FaceMesh !== 'undefined' ? FaceMesh : null);
    this._setInterval      = setIntervalFn;
    this._clearInterval    = clearIntervalFn;
    this._faceMesh         = null;
    this._videoEl          = null;
    this._intervalId       = null;
    this._running          = false;
    this._processing       = false;
    this._lastLandmarks    = null;
    this._estimator        = new _YawEstimator();
    this.onHeadAngle       = null;
  }

  async start(videoEl) {
    this._videoEl = videoEl;
    this._running = true;
    this._processing = false;

    this._faceMesh = new this._FaceMeshClass({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
    });

    this._faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this._faceMesh.onResults((results) => {
      if (!results.multiFaceLandmarks || !results.multiFaceLandmarks[0]) return;
      this._lastLandmarks = results.multiFaceLandmarks[0];
      const yaw     = this._estimator.estimate(this._lastLandmarks);
      const azimuth = yawToAzimuth(yaw);
      if (this.onHeadAngle) this.onHeadAngle(azimuth);
    });

    // Wait for WASM + model files to fully load before sending frames
    await this._faceMesh.initialize();
    this._intervalId = this._setInterval(() => this._tick(), 33);
  }

  /** Snapshot the current IOD as the reference distance. Returns true on success. */
  calibrate() {
    if (!this._lastLandmarks) return false;
    this._estimator.calibrate(this._lastLandmarks);
    return true;
  }

  /** Clear distance calibration — tracker returns uncorrected yaw again. */
  resetCalibration() {
    this._estimator.reset();
  }

  /** True after a successful calibrate() call, until resetCalibration(). */
  get isCalibrated() {
    return this._estimator.baselineIod !== null;
  }

  stop() {
    this._running = false;
    if (this._intervalId !== null) {
      this._clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  async _tick() {
    if (!this._running || this._processing) return;
    if (this._videoEl && this._videoEl.readyState >= 2 && this._faceMesh) {
      this._processing = true;
      try {
        await this._faceMesh.send({ image: this._videoEl });
      } finally {
        this._processing = false;
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CameraHeadTracker };
}

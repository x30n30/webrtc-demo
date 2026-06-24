class HeadTracker {
  constructor() {
    this._el = null;
    this._handler = null;
    this.onHeadAngle = null;
  }

  // el should have clientWidth (e.g. document.documentElement, or a mock in tests)
  start(el) {
    this._el = el;
    this._handler = (e) => {
      const width = el.clientWidth || 1;
      const x = Math.max(0, Math.min(e.clientX, width));
      const azimuth = (x / width) * 360;
      if (this.onHeadAngle) this.onHeadAngle(azimuth);
    };
    el.addEventListener('mousemove', this._handler);
  }

  stop() {
    if (this._el && this._handler) {
      this._el.removeEventListener('mousemove', this._handler);
      this._el = null;
      this._handler = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeadTracker };
}

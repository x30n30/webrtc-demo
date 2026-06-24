class SpatialViz {
  constructor(canvasEl) {
    this._canvas = canvasEl;
    this._ctx = canvasEl.getContext('2d');
  }

  update(azimuth, distance) {
    const { width, height } = this._canvas;
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = 10;
    const scale = (Math.min(width, height) / 2 * 0.75) / maxDist;
    const ctx = this._ctx;

    ctx.clearRect(0, 0, width, height);

    // Source position
    const rad = (azimuth * Math.PI) / 180;
    const sx = cx + scale * distance * Math.sin(rad);
    const sy = cy - scale * distance * Math.cos(rad);

    // Arrow: head → source (line + arrowhead)
    const angle = Math.atan2(sy - cy, sx - cx);
    const headLen = 10;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - headLen * Math.cos(angle - Math.PI / 6), sy - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - headLen * Math.cos(angle + Math.PI / 6), sy - headLen * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Listener head
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#4a9';
    ctx.fill();

    // Source dot
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#e74';
    ctx.fill();

    // Label
    ctx.fillStyle = '#ccc';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(azimuth)}°  ${distance.toFixed(1)} m`, cx, height - 8);
  }

  clear() {
    const { width, height } = this._canvas;
    this._ctx.clearRect(0, 0, width, height);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpatialViz };
}

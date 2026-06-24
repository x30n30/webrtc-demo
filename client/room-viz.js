const LOCAL_COLOR  = '#4af';
const REMOTE_COLOR = '#f84';
const MARKER_RADIUS = 14;
const HIT_RADIUS    = 20;

class RoomViz {
  constructor(canvasEl, { roomSizeMeters = 10 } = {}) {
    this._canvas          = canvasEl;
    this._ctx             = canvasEl.getContext('2d');
    this._roomSizeMeters  = roomSizeMeters;

    const cx = canvasEl.width  / 2;
    const cy = canvasEl.height / 2;
    this._localPos  = { x: cx, y: cy };
    this._remotePos = { x: cx, y: cy - canvasEl.height * 0.25 };

    this._dragging = null; // 'local' | 'remote' | null

    this._localAzimuth  = null; // degrees, null = unknown
    this._remoteAzimuth = null;

    this.onPositionChange = null;

    this._bindEvents();
    this._draw();
  }

  // ── Public ──────────────────────────────────────────────────────────────

  // Expose colors so the host page can match video borders
  static get LOCAL_COLOR()  { return LOCAL_COLOR; }
  static get REMOTE_COLOR() { return REMOTE_COLOR; }

  setRoomSize(meters) {
    this._roomSizeMeters = meters;
    this._draw();
    if (this.onPositionChange) this.onPositionChange(this._azimuth(), this._distance());
  }

  setLocalAzimuth(az)  { this._localAzimuth  = az; this._draw(); }
  setRemoteAzimuth(az) { this._remoteAzimuth = az; this._draw(); }

  // ── Position math ────────────────────────────────────────────────────────

  _azimuth() {
    const dx =  this._remotePos.x - this._localPos.x;
    const dy = -(this._remotePos.y - this._localPos.y); // invert Y: canvas down = world back
    const rad = Math.atan2(dx, dy);
    return ((rad * 180 / Math.PI) + 360) % 360;
  }

  _distance() {
    const dx = this._remotePos.x - this._localPos.x;
    const dy = this._remotePos.y - this._localPos.y;
    const px = Math.sqrt(dx * dx + dy * dy);
    return px * (this._roomSizeMeters / this._canvas.width);
  }

  // ── Drag ────────────────────────────────────────────────────────────────

  _hitTest({ x, y }) {
    const d = (p) => Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
    if (d(this._remotePos) <= HIT_RADIUS) return 'remote';
    if (d(this._localPos)  <= HIT_RADIUS) return 'local';
    return null;
  }

  _bindEvents() {
    const canvas = this._canvas;

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      this._dragging = this._hitTest({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    });

    const onMove = (e) => {
      if (!this._dragging) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width,  e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      if (this._dragging === 'remote') {
        this._remotePos = { x, y };
      } else {
        this._localPos = { x, y };
      }
      this._draw();
      if (this.onPositionChange) this.onPositionChange(this._azimuth(), this._distance());
    };

    const onUp = () => { this._dragging = null; };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  _draw() {
    const { _canvas: c, _ctx: ctx } = this;
    ctx.clearRect(0, 0, c.width, c.height);

    // Room border
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0, 0, c.width, c.height);

    // Connector line + arrowhead pointing local → remote
    const lx = this._localPos.x,  ly = this._localPos.y;
    const rx = this._remotePos.x, ry = this._remotePos.y;
    const angle   = Math.atan2(ry - ly, rx - lx);
    const headLen = 12;
    // Arrow tip sits on the remote circle's edge
    const tx = rx - MARKER_RADIUS * Math.cos(angle);
    const ty = ry - MARKER_RADIUS * Math.sin(angle);

    ctx.beginPath();
    ctx.strokeStyle = '#555';
    ctx.lineWidth   = 1;
    ctx.moveTo(lx, ly);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = '#888';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    this._drawMarker(this._localPos,  LOCAL_COLOR,  'You');
    this._drawMarker(this._remotePos, REMOTE_COLOR, 'Peer');

    if (this._localAzimuth  !== null) this._drawDirectionArrow(this._localPos,  this._localAzimuth,  LOCAL_COLOR);
    if (this._remoteAzimuth !== null) this._drawDirectionArrow(this._remotePos, this._remoteAzimuth, REMOTE_COLOR);
  }

  _drawDirectionArrow({ x, y }, azimuth, color) {
    const ctx     = this._ctx;
    const rad     = (azimuth * Math.PI) / 180;
    const dx      = Math.sin(rad);
    const dy      = -Math.cos(rad);           // canvas Y is inverted
    const arrowLen = MARKER_RADIUS + 20;      // starts at circle edge
    const headLen  = 8;

    const tipX = x + dx * arrowLen;
    const tipY = y + dy * arrowLen;
    const baseX = x + dx * MARKER_RADIUS;
    const baseY = y + dy * MARKER_RADIUS;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6), tipY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6), tipY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  _drawMarker({ x, y }, color, label) {
    const ctx = this._ctx;
    ctx.beginPath();
    ctx.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.font        = 'bold 10px monospace';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle   = '#fff';
    ctx.fillText(label, x, y);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RoomViz };
}

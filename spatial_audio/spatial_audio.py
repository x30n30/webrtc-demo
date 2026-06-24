"""
Spatial audio coordinate math — pure Python port of spatial-audio.js.

No audio hardware is used here.  The class stores the computed 3-D
position and listener-orientation vectors so callers (and tests) can
read them back directly.  A real application would forward these values
to the browser over the bridge WebSocket so the browser's PannerNode
and AudioListener can use them.
"""

import math


class SpatialAudio:
    def __init__(self):
        self._is_attached = False
        # Source position (set by set_source_position)
        self.position_x = 0.0
        self.position_y = 0.0
        self.position_z = 0.0
        # Listener forward vector (set by set_listener_orientation)
        self.forward_x = 0.0
        self.forward_y = 0.0
        self.forward_z = -1.0  # default: facing forward (-Z)

    # ── Lifecycle ────────────────────────────────────────────────────────────

    @property
    def is_attached(self):
        return self._is_attached

    def attach(self):
        """Simulate attaching an audio track (replaces any existing attachment)."""
        if self._is_attached:
            self._reset_state()
        self._is_attached = True

    def detach(self):
        """Release the attachment and reset all state."""
        if not self._is_attached:
            return
        self._is_attached = False
        self._reset_state()

    # ── Coordinate math ──────────────────────────────────────────────────────

    def set_source_position(self, azimuth: float, distance: float):
        """
        Convert (azimuth°, distance) to Cartesian (x, y, z).

        azimuth=0   → source straight ahead  (z = -distance, x = 0)
        azimuth=90  → source to the right    (x = +distance, z ≈ 0)
        """
        if not self._is_attached:
            return
        rad = (azimuth * math.pi) / 180.0
        self.position_x = distance * math.sin(rad)
        self.position_y = 0.0
        self.position_z = -distance * math.cos(rad)

    def set_listener_orientation(self, azimuth: float):
        """
        Set the listener's forward vector from a yaw azimuth in degrees.

        azimuth=0   → forward (0, 0, -1)
        azimuth=90  → right   (1, 0,  0)
        """
        if not self._is_attached:
            return
        rad = (azimuth * math.pi) / 180.0
        self.forward_x = math.sin(rad)
        self.forward_y = 0.0
        self.forward_z = -math.cos(rad)

    # ── Internal ─────────────────────────────────────────────────────────────

    def _reset_state(self):
        self.position_x = 0.0
        self.position_y = 0.0
        self.position_z = 0.0
        self.forward_x = 0.0
        self.forward_y = 0.0
        self.forward_z = -1.0

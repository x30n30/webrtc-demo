"""
Top-down room visualiser — Python/pygame port of room-viz.js.

Two draggable markers (local=you, remote=peer) sit inside a room
rectangle.  Dragging either marker recomputes azimuth/distance and
fires on_position_change.

Mouse events are delivered via explicit handle_* methods (called from
the pygame event loop or from tests) rather than DOM listeners.
pygame.draw is injectable so tests can run headlessly.
"""

import math


LOCAL_COLOR  = (68, 170, 255)   # '#4af'
REMOTE_COLOR = (255, 136, 68)   # '#f84'
MARKER_RADIUS = 14
HIT_RADIUS    = 20


class RoomViz:
    LOCAL_COLOR  = LOCAL_COLOR
    REMOTE_COLOR = REMOTE_COLOR

    def __init__(self, surface, room_size_meters: float = 10, pygame_draw=None, pygame_font=None):
        self._surface          = surface
        self._room_size_meters = room_size_meters
        self._draw             = pygame_draw
        self._font             = pygame_font

        width, height = surface.get_size()
        cx, cy = width / 2, height / 2
        self._local_pos  = [cx, cy]
        self._remote_pos = [cx, cy - height * 0.25]

        self._dragging = None  # 'local' | 'remote' | None
        self.on_position_change = None  # callable(azimuth, distance) | None

        self._draw_scene()

    # ── Lazy imports ─────────────────────────────────────────────────────────

    @property
    def _pg_draw(self):
        if self._draw is None:
            import pygame
            self._draw = pygame.draw
        return self._draw

    # ── Public API ───────────────────────────────────────────────────────────

    def set_room_size(self, meters: float):
        self._room_size_meters = meters
        self._draw_scene()
        if self.on_position_change:
            self.on_position_change(self._azimuth(), self._distance())

    def handle_mouse_down(self, x: float, y: float):
        self._dragging = self._hit_test(x, y)

    def handle_mouse_move(self, x: float, y: float):
        if not self._dragging:
            return
        width, height = self._surface.get_size()
        cx = max(0.0, min(float(width), float(x)))
        cy = max(0.0, min(float(height), float(y)))
        if self._dragging == "remote":
            self._remote_pos = [cx, cy]
        else:
            self._local_pos = [cx, cy]
        self._draw_scene()
        if self.on_position_change:
            self.on_position_change(self._azimuth(), self._distance())

    def handle_mouse_up(self):
        self._dragging = None

    # ── Position math ────────────────────────────────────────────────────────

    def _azimuth(self) -> float:
        dx =  self._remote_pos[0] - self._local_pos[0]
        dy = -(self._remote_pos[1] - self._local_pos[1])  # invert Y: canvas-down = world-back
        rad = math.atan2(dx, dy)
        return ((rad * 180.0 / math.pi) + 360.0) % 360.0

    def _distance(self) -> float:
        dx = self._remote_pos[0] - self._local_pos[0]
        dy = self._remote_pos[1] - self._local_pos[1]
        px = math.sqrt(dx * dx + dy * dy)
        width, _ = self._surface.get_size()
        return px * (self._room_size_meters / width)

    # ── Hit-test ─────────────────────────────────────────────────────────────

    def _hit_test(self, x, y):
        def d(p):
            return math.sqrt((x - p[0]) ** 2 + (y - p[1]) ** 2)
        if d(self._remote_pos) <= HIT_RADIUS:
            return "remote"
        if d(self._local_pos) <= HIT_RADIUS:
            return "local"
        return None

    # ── Drawing ──────────────────────────────────────────────────────────────

    def _draw_scene(self):
        width, height = self._surface.get_size()
        self._surface.fill((0, 0, 0))

        # Room border
        self._pg_draw.rect(
            self._surface, (51, 51, 51),
            (0, 0, width, height), 1
        )

        # Connector line
        lx, ly = self._local_pos
        rx, ry = self._remote_pos
        self._pg_draw.line(
            self._surface, (85, 85, 85),
            (int(lx), int(ly)), (int(rx), int(ry)), 1
        )

        # Markers
        self._draw_marker(self._local_pos,  LOCAL_COLOR,  "You")
        self._draw_marker(self._remote_pos, REMOTE_COLOR, "Peer")

    def _draw_marker(self, pos, color, label):
        x, y = int(pos[0]), int(pos[1])
        self._pg_draw.circle(self._surface, color, (x, y), MARKER_RADIUS)
        # Text rendering requires pygame.font; skip gracefully if not injected
        if self._font is not None:
            font = self._font.SysFont("monospace", 10, bold=True)
            surf = font.render(label, True, (255, 255, 255))
            self._surface.blit(surf, (x - surf.get_width() // 2, y - surf.get_height() // 2))

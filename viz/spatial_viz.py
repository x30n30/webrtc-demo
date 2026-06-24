"""
Spatial audio visualiser — Python/pygame port of spatial-viz.js.

Draws a top-down view: listener head at centre, source dot at the
computed (azimuth, distance) position.

pygame.draw and pygame.font are injectable so tests can run without a
display by passing mock objects.
"""

import math


class SpatialViz:
    def __init__(self, surface, pygame_draw=None, pygame_font=None):
        """
        surface      : pygame.Surface (or MockSurface in tests).
        pygame_draw  : pygame.draw module (or mock).
        pygame_font  : pygame.font module (or mock).
        """
        self._surface = surface
        self._draw = pygame_draw
        self._font = pygame_font

    # ── Lazy import helpers ──────────────────────────────────────────────────

    @property
    def _pg_draw(self):
        if self._draw is None:
            import pygame
            self._draw = pygame.draw
        return self._draw

    @property
    def _pg_font(self):
        if self._font is None:
            import pygame
            self._font = pygame.font
        return self._font

    # ── Public API ───────────────────────────────────────────────────────────

    def update(self, azimuth: float, distance: float):
        width, height = self._surface.get_size()
        cx, cy = width / 2, height / 2
        max_dist = 10
        scale = (min(width, height) / 2 * 0.75) / max_dist

        # Clear
        self._surface.fill((0, 0, 0))

        # Source position
        rad = (azimuth * math.pi) / 180.0
        sx = cx + scale * distance * math.sin(rad)
        sy = cy - scale * distance * math.cos(rad)

        # Line: head → source
        self._pg_draw.line(
            self._surface, (85, 85, 85), (cx, cy), (sx, sy), 1
        )

        # Listener head circle
        self._pg_draw.circle(
            self._surface, (68, 170, 153), (int(cx), int(cy)), 12
        )

        # Source dot
        self._pg_draw.circle(
            self._surface, (238, 119, 68), (int(sx), int(sy)), 8
        )

        # Label
        font = self._pg_font.SysFont("monospace", 11)
        label = font.render(
            f"{round(azimuth)}\u00b0  {distance:.1f} m", True, (204, 204, 204)
        )
        self._surface.blit(label, (cx - label.get_width() / 2, height - 8))

    def clear(self):
        self._surface.fill((0, 0, 0))

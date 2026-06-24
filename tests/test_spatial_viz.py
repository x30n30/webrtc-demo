"""
SpatialViz tests — port of spatial-viz.test.js (5 tests).

pygame.draw and pygame.font are replaced by lightweight mocks that
record draw calls, so no display is required.
"""

import pytest

from viz.spatial_viz import SpatialViz


# ── Mocks ─────────────────────────────────────────────────────────────────────

class MockSurface:
    def __init__(self, width=200, height=200):
        self._width  = width
        self._height = height
        self.calls   = []

    def get_size(self):
        return (self._width, self._height)

    def fill(self, color):
        self.calls.append(("fill", color))

    def blit(self, surf, pos):
        self.calls.append(("blit", pos))


class MockLabel:
    def get_width(self):
        return 60

    def get_height(self):
        return 12


class MockFont:
    def SysFont(self, name, size, bold=False):
        return self

    def render(self, text, antialias, color):
        return MockLabel()


class MockDraw:
    def __init__(self, surface):
        self._surface = surface

    def line(self, surf, color, start, end, width=1):
        surf.calls.append(("line", start, end))

    def circle(self, surf, color, pos, radius):
        surf.calls.append(("circle", pos, radius))

    def rect(self, surf, color, rect, width=0):
        surf.calls.append(("rect", rect))


def make_viz(w=200, h=200):
    surface = MockSurface(w, h)
    draw    = MockDraw(surface)
    font    = MockFont()
    viz     = SpatialViz(surface, pygame_draw=draw, pygame_font=font)
    return viz, surface


def circle_calls(surface):
    return [c for c in surface.calls if c[0] == "circle"]


# ── Tests ─────────────────────────────────────────────────────────────────────

# Test 1
def test_update_clears_canvas_first():
    viz, surface = make_viz()
    viz.update(0, 1)
    assert surface.calls[0] == ("fill", (0, 0, 0))


# Test 2
def test_update_draws_listener_head_at_centre():
    viz, surface = make_viz(200, 200)
    viz.update(0, 1)
    circles = circle_calls(surface)
    # First circle = listener head
    head_pos = circles[0][1]
    assert head_pos[0] == pytest.approx(100, abs=1)
    assert head_pos[1] == pytest.approx(100, abs=1)


# Test 3
def test_update_90_draws_source_right_of_centre():
    viz, surface = make_viz(200, 200)
    viz.update(90, 2)
    circles = circle_calls(surface)
    # Second circle = source dot; azimuth 90° → source x > centre x
    source_pos = circles[1][1]
    assert source_pos[0] > 100
    assert source_pos[1] == pytest.approx(100, abs=1)


# Test 4
def test_update_0_draws_source_above_centre():
    viz, surface = make_viz(200, 200)
    viz.update(0, 5)
    circles = circle_calls(surface)
    # Azimuth 0° = straight ahead → y < centre (upward in canvas coords)
    source_pos = circles[1][1]
    assert source_pos[0] == pytest.approx(100, abs=1)
    assert source_pos[1] < 100


# Test 5
def test_clear_fills_surface():
    viz, surface = make_viz(200, 200)
    viz.clear()
    assert ("fill", (0, 0, 0)) in surface.calls

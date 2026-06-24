"""
RoomViz tests — port of room-viz.test.js (13 tests).

pygame.draw is replaced by a mock so no display is required.
Mouse events are delivered via handle_mouse_down/move/up methods.
"""

import math
import pytest

from viz.room_viz import RoomViz


# ── Mocks ─────────────────────────────────────────────────────────────────────

class MockSurface:
    def __init__(self, width=300, height=300):
        self._width  = width
        self._height = height
        self.calls   = []

    def get_size(self):
        return (self._width, self._height)

    def fill(self, color):
        self.calls.append(("fill", color))

    def blit(self, surf, pos):
        self.calls.append(("blit", pos))


class MockDraw:
    def circle(self, surf, color, pos, radius):
        surf.calls.append(("circle", pos, radius))

    def line(self, surf, color, start, end, width=1):
        surf.calls.append(("line", start, end))

    def rect(self, surf, color, rect, width=0):
        surf.calls.append(("rect", rect))


def make_rv(w=300, h=300, room_size=10):
    surface = MockSurface(w, h)
    draw    = MockDraw()
    rv      = RoomViz(surface, room_size_meters=room_size, pygame_draw=draw)
    return rv, surface


# ── Tests ─────────────────────────────────────────────────────────────────────

# Test 1
def test_constructor_places_local_at_centre_remote_above():
    rv, _ = make_rv(300, 300)
    assert rv._local_pos[0] == pytest.approx(150)
    assert rv._local_pos[1] == pytest.approx(150)
    assert rv._remote_pos[0] == pytest.approx(150)
    assert rv._remote_pos[1] < 150


# Test 2
def test_azimuth_remote_directly_above_is_0():
    rv, _ = make_rv()
    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]
    assert rv._azimuth() == pytest.approx(0.0, abs=1e-5)


# Test 3
def test_azimuth_remote_right_is_90():
    rv, _ = make_rv()
    rv._local_pos  = [150, 150]
    rv._remote_pos = [250, 150]
    assert rv._azimuth() == pytest.approx(90.0, abs=1e-5)


# Test 4
def test_azimuth_remote_below_is_180():
    rv, _ = make_rv()
    rv._local_pos  = [150, 150]
    rv._remote_pos = [150, 250]
    assert rv._azimuth() == pytest.approx(180.0, abs=1e-5)


# Test 5
def test_azimuth_remote_left_is_270():
    rv, _ = make_rv()
    rv._local_pos  = [150, 150]
    rv._remote_pos = [ 50, 150]
    assert rv._azimuth() == pytest.approx(270.0, abs=1e-5)


# Test 6
def test_distance_100px_apart_300px_canvas_10m_room():
    rv, _ = make_rv(300, 300, room_size=10)
    rv._local_pos  = [150, 150]
    rv._remote_pos = [250, 150]
    assert rv._distance() == pytest.approx(10 * 100 / 300, abs=1e-3)


# Test 7
def test_dragging_remote_fires_on_position_change_with_correct_azimuth():
    rv, _ = make_rv()
    changes = []
    rv.on_position_change = lambda az, dist: changes.append({"az": az, "dist": dist})

    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]

    rv.handle_mouse_down(150, 50)   # grab remote marker
    rv.handle_mouse_move(250, 150)  # drag to directly right of local

    assert len(changes) > 0
    assert changes[0]["az"] == pytest.approx(90.0, abs=0.5)


# Test 8
def test_dragging_local_fires_on_position_change():
    rv, _ = make_rv()
    changes = []
    rv.on_position_change = lambda az, dist: changes.append((az, dist))

    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]

    rv.handle_mouse_down(150, 150)  # grab local marker
    rv.handle_mouse_move(100, 150)

    assert len(changes) > 0


# Test 9
def test_mousedown_far_from_both_markers_does_not_start_drag():
    rv, _ = make_rv()
    changes = []
    rv.on_position_change = lambda az, dist: changes.append((az, dist))

    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]

    rv.handle_mouse_down(10, 290)   # far from both
    rv.handle_mouse_move(20, 280)

    assert len(changes) == 0


# Test 10
def test_dragging_outside_bounds_clamps_marker_position():
    rv, _ = make_rv(300, 300)
    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]

    rv.handle_mouse_down(150, 50)
    rv.handle_mouse_move(500, -100)  # far outside

    assert rv._remote_pos[0] >= 0
    assert rv._remote_pos[0] <= 300
    assert rv._remote_pos[1] >= 0
    assert rv._remote_pos[1] <= 300


# Test 11
def test_mouseup_ends_drag_further_move_does_not_fire():
    rv, _ = make_rv()
    changes = []
    rv.on_position_change = lambda az, dist: changes.append((az, dist))

    rv._local_pos  = [150, 150]
    rv._remote_pos = [150,  50]

    rv.handle_mouse_down(150, 50)
    rv.handle_mouse_move(200, 50)
    rv.handle_mouse_up()
    count_after_up = len(changes)
    rv.handle_mouse_move(250, 50)

    assert len(changes) == count_after_up


# Test 12
def test_set_room_size_updates_attribute():
    rv, _ = make_rv(300, 300, room_size=10)
    rv.set_room_size(20)
    assert rv._room_size_meters == 20


# Test 13
def test_set_room_size_fires_on_position_change_with_recalculated_distance():
    rv, _ = make_rv(300, 300, room_size=10)
    rv._local_pos  = [150, 150]
    rv._remote_pos = [250, 150]  # 100px apart

    changes = []
    rv.on_position_change = lambda az, dist: changes.append(dist)
    rv.set_room_size(20)  # same pixels, double room

    assert changes[0] == pytest.approx(20 * 100 / 300, abs=1e-3)

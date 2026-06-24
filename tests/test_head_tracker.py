"""
HeadTracker tests — port of head-tracker.test.js (6 tests).

pynput.mouse.Listener is replaced by MockListener so no real mouse
hardware is required.
"""

import pytest

from head_tracking.head_tracker import HeadTracker


# ── Mock Listener ─────────────────────────────────────────────────────────────

class MockListener:
    """Minimal stand-in for pynput.mouse.Listener."""

    def __init__(self, on_move=None, **kwargs):
        self._on_move   = on_move
        self.started    = False
        self.stopped    = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    # Test helper — simulate the OS delivering a mouse-move event
    def fire_move(self, x, y):
        if self._on_move:
            self._on_move(x, y)


def make_tracker(width=400):
    instances = []

    class CapturingListener(MockListener):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            instances.append(self)

    tracker = HeadTracker(listener_class=CapturingListener, screen_width=width)
    return tracker, instances


# ── Tests ─────────────────────────────────────────────────────────────────────

# Test 1
def test_start_creates_and_starts_listener():
    tracker, instances = make_tracker()
    tracker.start()
    assert len(instances) == 1
    assert instances[0].started is True
    tracker.stop()


# Test 2
def test_stop_stops_listener():
    tracker, instances = make_tracker()
    tracker.start()
    tracker.stop()
    assert instances[0].stopped is True
    assert tracker._listener is None


# Test 3
def test_mouse_at_left_edge_fires_azimuth_0():
    tracker, instances = make_tracker(width=400)
    angles = []
    tracker.on_head_angle = angles.append
    tracker.start()
    instances[0].fire_move(0, 200)
    assert angles[0] == pytest.approx(0.0, abs=0.1)
    tracker.stop()


# Test 4
def test_mouse_at_right_edge_fires_azimuth_360():
    tracker, instances = make_tracker(width=400)
    angles = []
    tracker.on_head_angle = angles.append
    tracker.start()
    instances[0].fire_move(400, 200)
    assert angles[0] == pytest.approx(360.0, abs=0.1)
    tracker.stop()


# Test 5
def test_mouse_at_centre_fires_azimuth_180():
    tracker, instances = make_tracker(width=400)
    angles = []
    tracker.on_head_angle = angles.append
    tracker.start()
    instances[0].fire_move(200, 200)
    assert angles[0] == pytest.approx(180.0, abs=0.1)
    tracker.stop()


# Test 6
def test_on_head_angle_fires_on_every_move():
    tracker, instances = make_tracker(width=400)
    angles = []
    tracker.on_head_angle = angles.append
    tracker.start()
    instances[0].fire_move(100, 0)
    instances[0].fire_move(200, 0)
    instances[0].fire_move(300, 0)
    assert len(angles) == 3
    tracker.stop()

"""
CameraHeadTracker tests — port of camera-head-tracker.test.js (5 tests).

FaceMesh and VideoCapture are fully mocked.  A noop thread factory
suppresses the background thread so tests remain synchronous.
"""

import pytest

from head_tracking.camera_head_tracker import CameraHeadTracker


# ── Mocks ─────────────────────────────────────────────────────────────────────

face_mesh_instances: list = []


class MockFaceMesh:
    def __init__(self, **kwargs):
        self.kwargs  = kwargs
        self._result = None
        face_mesh_instances.append(self)

    def process(self, frame):
        return self._result


class MockLandmark:
    def __init__(self, x, y=0.5, z=0.0):
        self.x = x
        self.y = y
        self.z = z


class MockFaceData:
    def __init__(self, landmarks):
        self.landmark = landmarks


class MockResult:
    def __init__(self, landmarks=None):
        if landmarks is not None:
            self.multi_face_landmarks = [MockFaceData(landmarks)]
        else:
            self.multi_face_landmarks = []


class MockCapture:
    def __init__(self, device):
        self.device = device

    def read(self):
        return False, None

    def release(self):
        pass


class NoopThread:
    """Thread factory that records args but never starts a thread."""
    def __init__(self, target=None, args=(), daemon=False, **kwargs):
        self.target = target
        self.args   = args

    def start(self):
        pass  # deliberately no-op


def make_tracker():
    tracker = CameraHeadTracker(
        face_mesh_class=MockFaceMesh,
        video_capture_class=MockCapture,
        thread_factory=NoopThread,
    )
    return tracker


def make_landmarks(nose_x, left_x, right_x):
    lm = [MockLandmark(0.5)] * 468
    lm = list(lm)
    lm[4]   = MockLandmark(nose_x)
    lm[234] = MockLandmark(left_x)
    lm[454] = MockLandmark(right_x)
    return lm


@pytest.fixture(autouse=True)
def reset_instances():
    global face_mesh_instances
    face_mesh_instances = []
    yield
    face_mesh_instances = []


# ── Tests ─────────────────────────────────────────────────────────────────────

# Test 1
def test_start_creates_face_mesh():
    tracker = make_tracker()
    tracker.start()
    assert len(face_mesh_instances) == 1


# Test 2
def test_start_sets_correct_tracking_config():
    tracker = make_tracker()
    tracker.start()
    opts = face_mesh_instances[0].kwargs
    assert opts["max_num_faces"] == 1
    assert opts["min_detection_confidence"] > 0
    assert opts["min_tracking_confidence"] > 0


# Test 3
def test_on_head_angle_fires_with_correct_azimuth():
    tracker = make_tracker()
    angles  = []
    tracker.on_head_angle = angles.append
    tracker.start()

    fm = face_mesh_instances[0]

    # Forward-facing: yaw ≈ 0 → azimuth ≈ 0
    fm._result = MockResult(make_landmarks(0.5, 0.3, 0.7))
    tracker._tick(None)
    assert angles[0] == pytest.approx(0.0, abs=0.1)

    # Turned fully right: yaw = 45 → azimuth = 90
    fm._result = MockResult(make_landmarks(0.7, 0.3, 0.7))
    tracker._tick(None)
    assert angles[1] == pytest.approx(90.0, abs=0.1)


# Test 4
def test_stop_sets_running_false():
    tracker = make_tracker()
    tracker.start()
    tracker.stop()
    assert tracker._running is False


# Test 5
def test_on_head_angle_not_called_when_no_landmarks():
    tracker = make_tracker()
    angles  = []
    tracker.on_head_angle = angles.append
    tracker.start()

    fm = face_mesh_instances[0]

    fm._result = MockResult(landmarks=None)  # empty multi_face_landmarks
    tracker._tick(None)

    fm._result = None  # process() returns None
    tracker._tick(None)

    assert len(angles) == 0

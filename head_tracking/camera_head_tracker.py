"""
MediaPipe webcam head tracker — Python port of camera-head-tracker.js.

Architecture
------------
A daemon thread runs cv2.VideoCapture.read() in a loop.  Each frame is
passed to face_mesh.process(); if landmarks are found, landmark_to_yaw()
converts them to an azimuth which fires on_head_angle.

The _processing flag prevents concurrent frame submissions (same guard
as the JS version's this._processing).

face_mesh_class and video_capture_class are injectable for tests.
thread_factory is injectable so tests can suppress the background thread.
"""

import math
import threading

from head_tracking.landmark_to_yaw import landmark_to_yaw


def _yaw_to_azimuth(yaw: float) -> float:
    # yaw  0° (forward) → azimuth   0° (sound ahead)
    # yaw +45° (right)  → azimuth  90° (sound to right)
    # yaw -45° (left)   → azimuth 270° (sound to left)
    return ((yaw / 45.0) * 90.0 + 360.0) % 360.0


class CameraHeadTracker:
    def __init__(
        self,
        face_mesh_class=None,
        video_capture_class=None,
        thread_factory=None,
    ):
        """
        face_mesh_class    : mediapipe FaceMesh class (or mock).
        video_capture_class: cv2.VideoCapture class (or mock).
        thread_factory     : callable(**kwargs) → thread-like object with .start().
                             Defaults to threading.Thread.  Pass a no-op factory in
                             tests that don't need the background thread.
        """
        self._face_mesh_class     = face_mesh_class
        self._video_capture_class = video_capture_class
        self._thread_factory      = thread_factory or threading.Thread
        self._face_mesh           = None
        self._running             = False
        self._processing          = False
        self.on_head_angle        = None  # callable(azimuth) | None

    # ── Public API ───────────────────────────────────────────────────────────

    def start(self, device: int = 0):
        """Create FaceMesh, then launch the capture loop in a daemon thread."""
        if self._face_mesh_class is None:
            import mediapipe as mp
            self._face_mesh_class = mp.solutions.face_mesh.FaceMesh
        if self._video_capture_class is None:
            import cv2
            self._video_capture_class = cv2.VideoCapture

        self._face_mesh = self._face_mesh_class(
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._running    = True
        self._processing = False

        t = self._thread_factory(
            target=self._run, args=(device,), daemon=True
        )
        t.start()

    def stop(self):
        self._running = False

    # ── Frame processing (called by background thread; also called directly
    #    by tests via _tick) ─────────────────────────────────────────────────

    def _tick(self, frame):
        """Process one frame.  No-ops if already processing."""
        if self._processing:
            return
        self._processing = True
        try:
            results = self._face_mesh.process(frame)
            if results and results.multi_face_landmarks:
                raw_lms = results.multi_face_landmarks[0].landmark
                lms = [{"x": lm.x, "y": lm.y, "z": lm.z} for lm in raw_lms]
                yaw     = landmark_to_yaw(lms)
                azimuth = _yaw_to_azimuth(yaw)
                if self.on_head_angle:
                    self.on_head_angle(azimuth)
        finally:
            self._processing = False

    # ── Background thread ────────────────────────────────────────────────────

    def _run(self, device: int):
        cap = self._video_capture_class(device)
        try:
            while self._running:
                ret, frame = cap.read()
                if ret:
                    self._tick(frame)
        finally:
            cap.release()

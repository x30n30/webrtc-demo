"""
MediaPipe FaceMesh landmark → head yaw — direct port of landmark-to-yaw.js.

Key indices:
    4   — nose tip
    234 — left face edge
    454 — right face edge

Returns yaw in degrees, clamped to ±45°.
Positive = turned right, negative = turned left.

Landmarks must be a sequence of objects with an `.x` attribute
OR plain dicts with key 'x'.
"""


def _x(landmark) -> float:
    try:
        return landmark.x
    except AttributeError:
        return landmark["x"]


def landmark_to_yaw(landmarks) -> float:
    nose  = landmarks[4]
    left  = landmarks[234]
    right = landmarks[454]

    center_x   = (_x(left) + _x(right)) / 2.0
    half_width = abs(_x(right) - _x(left)) / 2.0

    if half_width < 0.001:
        return 0.0

    normalized = (_x(nose) - center_x) / half_width
    clamped    = max(-1.0, min(1.0, normalized))
    return clamped * 45.0

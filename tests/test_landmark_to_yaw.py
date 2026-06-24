"""
landmark_to_yaw tests — direct port of landmark-to-yaw.test.js (5 tests).
"""

import pytest

from head_tracking.landmark_to_yaw import landmark_to_yaw


def make_landmarks(nose_x, left_x, right_x):
    lm = [{"x": 0.5, "y": 0.5, "z": 0.0}] * 468
    lm = list(lm)  # make mutable copy
    lm[4]   = {"x": nose_x,  "y": 0.5, "z": 0.0}  # nose tip
    lm[234] = {"x": left_x,  "y": 0.5, "z": 0.0}  # left face edge
    lm[454] = {"x": right_x, "y": 0.5, "z": 0.0}  # right face edge
    return lm


# Test 1
def test_forward_facing_returns_yaw_0():
    lm = make_landmarks(0.5, 0.3, 0.7)
    assert landmark_to_yaw(lm) == pytest.approx(0.0, abs=1e-5)


# Test 2
def test_nose_right_of_centre_returns_positive_yaw():
    lm = make_landmarks(0.6, 0.3, 0.7)
    assert landmark_to_yaw(lm) > 0


# Test 3
def test_nose_left_of_centre_returns_negative_yaw():
    lm = make_landmarks(0.4, 0.3, 0.7)
    assert landmark_to_yaw(lm) < 0


# Test 4
def test_degenerate_coincident_edges_returns_0():
    lm = make_landmarks(0.5, 0.5, 0.5)
    assert landmark_to_yaw(lm) == 0.0


# Test 5
def test_yaw_is_clamped_to_plus_minus_45():
    lm_right = make_landmarks(0.95, 0.3, 0.7)
    assert landmark_to_yaw(lm_right) == pytest.approx(45.0)

    lm_left = make_landmarks(0.05, 0.3, 0.7)
    assert landmark_to_yaw(lm_left) == pytest.approx(-45.0)

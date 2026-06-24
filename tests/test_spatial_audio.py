"""
Spatial audio coordinate math tests — port of spatial-audio.test.js (9 tests).

Pure unit tests: no mocking needed.  All assertions use pytest.approx.
"""

import math
import pytest

from spatial_audio.spatial_audio import SpatialAudio


# Test 1
def test_attach_sets_is_attached():
    sa = SpatialAudio()
    sa.attach()
    assert sa.is_attached is True


# Test 2
def test_set_source_position_90_2_gives_x2_z0():
    sa = SpatialAudio()
    sa.attach()
    sa.set_source_position(90, 2)
    assert sa.position_x == pytest.approx(2.0, abs=1e-5)
    assert sa.position_z == pytest.approx(0.0, abs=1e-5)


# Test 3
def test_set_source_position_0_5_gives_x0_z_neg5():
    sa = SpatialAudio()
    sa.attach()
    sa.set_source_position(0, 5)
    assert sa.position_x == pytest.approx(0.0, abs=1e-5)
    assert sa.position_z == pytest.approx(-5.0, abs=1e-5)


# Test 4
def test_detach_resets_state_and_is_attached_false():
    sa = SpatialAudio()
    sa.attach()
    sa.set_source_position(90, 2)
    sa.detach()
    assert sa.is_attached is False
    assert sa.position_x == pytest.approx(0.0)
    assert sa.position_z == pytest.approx(0.0)


# Test 5
def test_attach_twice_replaces_and_stays_attached():
    sa = SpatialAudio()
    sa.attach()
    sa.set_source_position(90, 2)
    sa.attach()  # replaces
    assert sa.is_attached is True
    # state was reset on second attach
    assert sa.position_x == pytest.approx(0.0)


# Test 6
def test_is_attached_reflects_state():
    sa = SpatialAudio()
    assert sa.is_attached is False
    sa.attach()
    assert sa.is_attached is True


# Test 7
def test_set_source_position_and_orientation_before_attach_do_not_raise():
    sa = SpatialAudio()
    sa.set_source_position(45, 3)
    sa.set_listener_orientation(45)


# Test 8
def test_set_listener_orientation_0_points_forward():
    sa = SpatialAudio()
    sa.attach()
    sa.set_listener_orientation(0)
    assert sa.forward_x == pytest.approx(0.0, abs=1e-5)
    assert sa.forward_z == pytest.approx(-1.0, abs=1e-5)


# Test 9
def test_set_listener_orientation_90_points_right():
    sa = SpatialAudio()
    sa.attach()
    sa.set_listener_orientation(90)
    assert sa.forward_x == pytest.approx(1.0, abs=1e-5)
    assert sa.forward_z == pytest.approx(0.0, abs=1e-5)

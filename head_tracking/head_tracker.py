"""
Mouse-driven head proxy — Python port of head-tracker.js.

Maps the absolute screen X position to an azimuth in [0, 360).
pynput.mouse.Listener is injected so tests can substitute a mock.
"""


class HeadTracker:
    def __init__(self, listener_class=None, screen_width: int = 1920):
        """
        listener_class : pynput.mouse.Listener (or a compatible mock).
                         Imported lazily so the module loads without pynput
                         installed (tests always inject a mock).
        screen_width   : total screen pixel width used to normalise X → azimuth.
        """
        self._listener_class = listener_class
        self._screen_width = screen_width
        self._listener = None
        self.on_head_angle = None  # callable(azimuth: float) | None

    # ── Public API ───────────────────────────────────────────────────────────

    def start(self):
        """Begin listening for mouse-move events."""
        if self._listener_class is None:
            from pynput import mouse
            self._listener_class = mouse.Listener

        def _on_move(x, y):
            width = self._screen_width or 1
            clamped = max(0, min(x, width))
            azimuth = (clamped / width) * 360.0
            if self.on_head_angle:
                self.on_head_angle(azimuth)

        self._listener = self._listener_class(on_move=_on_move)
        self._listener.start()

    def stop(self):
        """Stop listening and release resources."""
        if self._listener is not None:
            self._listener.stop()
            self._listener = None

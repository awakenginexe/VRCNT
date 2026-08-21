"""Coordinate the VRChat chatbox typing indicator with speech processing."""

from time import monotonic
from typing import Callable, Optional


class TypingCoordinator:
    """Keep typing active while voice activity or processing is in progress.

    Voice activity is released only after a short quiet grace period so normal
    pauses between words do not make the VRChat indicator flicker. Processing
    keeps the indicator active after capture goes quiet until the output path
    explicitly completes.
    """

    def __init__(
        self,
        on_start: Callable[[], None],
        on_stop: Callable[[], None],
        release_after: float = 0.4,
    ) -> None:
        if not callable(on_start) or not callable(on_stop):
            raise TypeError("typing callbacks must be callable")
        self._on_start = on_start
        self._on_stop = on_stop
        self._release_after = max(0.0, float(release_after))
        self._voice_active = False
        self._processing_count = 0
        self._indicator_active = False
        self._quiet_since: Optional[float] = None

    @property
    def active(self) -> bool:
        return self._indicator_active

    def _reconcile(self) -> None:
        should_be_active = self._voice_active or self._processing_count > 0
        if should_be_active and not self._indicator_active:
            self._on_start()
            self._indicator_active = True
        elif not should_be_active and self._indicator_active:
            self._on_stop()
            self._indicator_active = False

    def update_voice_activity(
        self,
        speaking: bool,
        *,
        at: Optional[float] = None,
    ) -> None:
        now = monotonic() if at is None else float(at)
        if speaking:
            self._voice_active = True
            self._quiet_since = None
            self._reconcile()
            return

        if not self._voice_active:
            return
        if self._quiet_since is None:
            self._quiet_since = now
            return
        if now - self._quiet_since < self._release_after:
            return
        self._voice_active = False
        self._quiet_since = None
        self._reconcile()

    def begin_processing(self) -> None:
        self._processing_count += 1
        self._reconcile()

    def end_processing(self) -> None:
        if self._processing_count > 0:
            self._processing_count -= 1
        self._reconcile()

    def reset(self) -> None:
        self._voice_active = False
        self._processing_count = 0
        self._quiet_since = None
        self._reconcile()

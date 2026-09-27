"""Bounded round-robin dispatch for shared local translation inference."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import logging
from threading import Condition, Thread, current_thread
from typing import Callable

from .pipeline_types import PipelineSource

logger = logging.getLogger(__name__)


@dataclass
class _Pending:
    owner: object
    item: object
    callback: Callable[[], None]


class LocalTranslationQueue:
    def __init__(self, max_pending_per_source: int = 4) -> None:
        self._limit = max_pending_per_source
        self._condition = Condition()
        self._pending = {source: deque() for source in PipelineSource}
        self._sources = tuple(PipelineSource)
        self._next_source = 0
        self._active_owner: object | None = None
        self._closed = False
        self.worker_thread = Thread(target=self._run, name="local-translation", daemon=True)
        self.worker_thread.start()

    def offer(self, source: PipelineSource, owner: object, item: object, callback: Callable[[], None]) -> bool:
        with self._condition:
            pending = self._pending[source]
            if self._closed or len(pending) >= self._limit:
                return False
            pending.append(_Pending(owner, item, callback))
            self._condition.notify_all()
            return True

    def pending_count(self, source: PipelineSource) -> int:
        with self._condition:
            return len(self._pending[source])

    def cancel_owner(self, owner: object) -> list[object]:
        removed = []
        with self._condition:
            for source in self._sources:
                retained = deque()
                while self._pending[source]:
                    pending = self._pending[source].popleft()
                    if pending.owner is owner:
                        removed.append(pending.item)
                    else:
                        retained.append(pending)
                self._pending[source] = retained
            self._condition.notify_all()
        return removed

    def wait_owner_idle(self, owner: object) -> None:
        with self._condition:
            self._condition.wait_for(lambda: self._active_owner is not owner and all(
                pending.owner is not owner
                for source in self._sources for pending in self._pending[source]
            ))

    def close(self) -> None:
        with self._condition:
            self._closed = True
            for pending in self._pending.values():
                pending.clear()
            self._condition.notify_all()
        if self.worker_thread is not current_thread():
            self.worker_thread.join()

    def _run(self) -> None:
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._closed or any(self._pending.values()))
                if self._closed:
                    self._condition.notify_all()
                    return
                for offset in range(len(self._sources)):
                    index = (self._next_source + offset) % len(self._sources)
                    source = self._sources[index]
                    if self._pending[source]:
                        pending = self._pending[source].popleft()
                        self._next_source = (index + 1) % len(self._sources)
                        self._active_owner = pending.owner
                        break
            try:
                pending.callback()
            except Exception:
                logger.exception("Local translation callback failed")
            finally:
                with self._condition:
                    self._active_owner = None
                    self._condition.notify_all()


_shared_queue: LocalTranslationQueue | None = None
_shared_condition = Condition()


def shared_local_translation_queue() -> LocalTranslationQueue:
    global _shared_queue
    with _shared_condition:
        if _shared_queue is None:
            _shared_queue = LocalTranslationQueue()
        return _shared_queue

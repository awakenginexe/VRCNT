"""Ordered, cancellable delivery for VRChat Chatbox messages."""

from collections import deque
from dataclasses import dataclass
from threading import Condition, Thread, current_thread
from typing import Callable, Optional


@dataclass(frozen=True)
class _QueuedChatboxMessage:
    message: str
    generation: Optional[int]
    notification: bool


class ChatboxDispatcher:
    """Send Chatbox messages FIFO without imposing an artificial delay."""

    def __init__(
        self,
        send: Callable[[str], None],
        *,
        send_with_metadata: Optional[Callable[[str, bool], None]] = None,
    ) -> None:
        self._send = send
        self._send_with_metadata = send_with_metadata
        self._condition = Condition()
        self._queue: deque[_QueuedChatboxMessage] = deque()
        self._invalidated_generations: set[int] = set()
        self._closed = False
        self._worker = Thread(
            target=self._run,
            name="vrcnt-chatbox-dispatcher",
            daemon=True,
        )
        self._worker.start()

    def enqueue(
        self,
        message: str,
        generation: Optional[int] = None,
        *,
        notification: bool = True,
    ) -> bool:
        if not isinstance(message, str) or not message:
            return False
        with self._condition:
            if self._closed or (
                generation is not None
                and generation in self._invalidated_generations
            ):
                return False
            self._queue.append(
                _QueuedChatboxMessage(
                    message=message,
                    generation=generation,
                    notification=notification is True,
                )
            )
            self._condition.notify()
            return True

    def invalidate_generation(self, generation: int) -> None:
        with self._condition:
            self._invalidated_generations.add(generation)
            self._queue = deque(
                item
                for item in self._queue
                if item.generation != generation
            )
            self._condition.notify_all()

    def clear(self) -> None:
        with self._condition:
            self._queue.clear()
            self._condition.notify_all()

    def close(self) -> None:
        with self._condition:
            if self._closed:
                return
            self._closed = True
            self._queue.clear()
            self._condition.notify_all()
        if self._worker is not current_thread():
            self._worker.join(timeout=2.0)

    def _run(self) -> None:
        while True:
            with self._condition:
                while not self._queue and not self._closed:
                    self._condition.wait()
                if self._closed:
                    return
                item = self._queue.popleft()

            try:
                if self._send_with_metadata is not None:
                    self._send_with_metadata(item.message, item.notification)
                else:
                    self._send(item.message)
            except Exception:
                # OSC delivery must not terminate the worker or the backend.
                try:
                    from utils import errorLogging

                    errorLogging()
                except Exception:
                    pass

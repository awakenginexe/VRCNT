"""Shared PortAudio runtime primitives.

The bundled pyaudiowpatch build is not stable when multiple ``PyAudio``
contexts are created while capture streams are active.  Keep one process-wide
context and serialize short PortAudio API operations such as enumeration,
stream creation, reads, and close calls.
"""

from contextlib import contextmanager
from threading import RLock
from typing import Any, Iterator, Optional


audio_api_lock = RLock()
_shared_pyaudio: Optional[Any] = None
_shared_module: Optional[Any] = None


def get_shared_pyaudio(pyaudio_module: Any) -> Optional[Any]:
    """Return the process-wide PyAudio context for ``pyaudio_module``."""
    global _shared_module, _shared_pyaudio

    if pyaudio_module is None:
        return None

    with audio_api_lock:
        if _shared_pyaudio is not None and _shared_module is not pyaudio_module:
            try:
                _shared_pyaudio.terminate()
            except Exception:
                pass
            _shared_pyaudio = None
            _shared_module = None

        if _shared_pyaudio is None:
            _shared_pyaudio = pyaudio_module.PyAudio()
            _shared_module = pyaudio_module

        return _shared_pyaudio


@contextmanager
def shared_pyaudio_context(pyaudio_module: Any) -> Iterator[Optional[Any]]:
    """Serialize a short operation against the shared PyAudio context."""
    with audio_api_lock:
        yield get_shared_pyaudio(pyaudio_module)


def reset_shared_pyaudio() -> None:
    """Terminate and forget the shared context, primarily for tests."""
    global _shared_module, _shared_pyaudio

    with audio_api_lock:
        if _shared_pyaudio is not None:
            try:
                _shared_pyaudio.terminate()
            except Exception:
                pass
        _shared_pyaudio = None
        _shared_module = None

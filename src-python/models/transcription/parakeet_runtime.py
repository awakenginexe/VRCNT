"""Shared ownership of one Parakeet native model across audio sources."""

import os
from threading import Condition
from typing import Any, Callable, Optional


class ParakeetRuntimeLease:
    def __init__(self, manager: "ParakeetRuntimeManager", key: tuple) -> None:
        self._manager = manager
        self._key = key
        self._closed = False

    def transcribe(self, audio: Any, sample_rate: int = 16000) -> str:
        return self._manager._transcribe(self, audio, sample_rate)

    def close(self) -> None:
        self._manager._release(self)


class ParakeetRuntimeManager:
    def __init__(self, factory: Callable[..., Any]) -> None:
        self._factory = factory
        self._condition = Condition()
        self._model: Optional[Any] = None
        self._key: Optional[tuple] = None
        self._leases: set[ParakeetRuntimeLease] = set()
        self._active_inference = False
        self._retiring = False
        self._shutdown = False

    @property
    def active_model(self) -> Optional[Any]:
        with self._condition:
            return self._model

    def acquire(
        self, root: str, weight_type: str, device: str, device_index: int
    ) -> ParakeetRuntimeLease:
        key = (os.path.abspath(root), weight_type, device, device_index)
        with self._condition:
            if self._shutdown:
                raise RuntimeError("Parakeet runtime is shut down")
            if self._retiring:
                raise RuntimeError("Parakeet runtime is still retiring")
            if self._model is not None and self._key != key:
                raise RuntimeError("Parakeet model is still in use by another source")
            if self._model is None:
                self._model = self._factory(root, weight_type, device, device_index)
                self._key = key
            lease = ParakeetRuntimeLease(self, key)
            self._leases.add(lease)
            return lease

    def _transcribe(
        self, lease: ParakeetRuntimeLease, audio: Any, sample_rate: int
    ) -> str:
        with self._condition:
            while True:
                if self._shutdown or lease._closed or lease not in self._leases:
                    raise RuntimeError("Parakeet runtime lease is closed")
                if self._model is None or self._key != lease._key:
                    raise RuntimeError("Parakeet runtime lease is stale")
                if not self._active_inference:
                    self._active_inference = True
                    model = self._model
                    break
                self._condition.wait()
        try:
            return model.transcribe(audio, sample_rate=sample_rate)
        finally:
            with self._condition:
                self._active_inference = False
                if self._retiring and not self._leases:
                    self._model = None
                    self._key = None
                    self._retiring = False
                self._condition.notify_all()

    def _release(self, lease: ParakeetRuntimeLease) -> None:
        with self._condition:
            if lease._closed:
                return
            lease._closed = True
            self._leases.discard(lease)
            if not self._leases:
                if self._active_inference:
                    self._retiring = True
                else:
                    self._model = None
                    self._key = None
            self._condition.notify_all()

    def shutdown(self) -> None:
        with self._condition:
            self._shutdown = True
            for lease in self._leases:
                lease._closed = True
            self._leases.clear()
            if self._active_inference:
                self._retiring = True
            else:
                self._model = None
                self._key = None
            self._condition.notify_all()


def _load_model(root: str, weight_type: str, device: str, device_index: int) -> Any:
    from .transcription_parakeet import getParakeetModel

    return getParakeetModel(root, weight_type, device, device_index)


PARAKEET_RUNTIME_MANAGER = ParakeetRuntimeManager(factory=_load_model)


def acquireParakeetModel(
    root: str, weight_type: str, device: str = "cuda", device_index: int = 0
) -> ParakeetRuntimeLease:
    return PARAKEET_RUNTIME_MANAGER.acquire(root, weight_type, device, device_index)

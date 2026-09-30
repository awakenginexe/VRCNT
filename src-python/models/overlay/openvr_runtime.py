from contextlib import contextmanager
from threading import RLock

import openvr


class OpenVRRuntime:
    """Keep the process-wide OpenVR connection alive until its last user leaves."""

    def __init__(self):
        self.lock = RLock()
        self._owners = set()
        self._system = None

    def acquire(self, owner):
        with self.lock:
            if not self._owners:
                try:
                    self._system = openvr.init(openvr.VRApplication_Overlay)
                except Exception:
                    # init() can fail after the native connection is established.
                    openvr.shutdown()
                    self._system = None
                    raise
            self._owners.add(owner)
            return self._system

    def release(self, owner):
        with self.lock:
            if owner not in self._owners:
                return
            self._owners.remove(owner)
            if not self._owners:
                try:
                    openvr.shutdown()
                finally:
                    self._system = None

    @contextmanager
    def session(self):
        owner = object()
        with self.lock:
            system = self.acquire(owner)
            try:
                yield system
            finally:
                self.release(owner)


runtime = OpenVRRuntime()

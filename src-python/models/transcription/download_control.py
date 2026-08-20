"""Shared cooperative cancellation and exact-target cleanup helpers."""

import os
import shutil
from threading import Event
from typing import Optional


class DownloadCancelled(Exception):
    """Raised when a cooperative model download cancellation is requested."""


def raise_if_download_cancelled(cancel_event: Optional[Event]) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise DownloadCancelled()


def remove_incomplete_download(path: str, is_complete: bool) -> None:
    """Remove only the exact selected incomplete file or directory."""

    if is_complete:
        return

    target = os.fspath(path)
    if os.path.isdir(target) and not os.path.islink(target):
        shutil.rmtree(target)
    elif os.path.lexists(target):
        os.remove(target)

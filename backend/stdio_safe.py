"""Keep Windows consoles from aborting the chat stream on emoji logs."""
from __future__ import annotations

import builtins
import io
import sys

_patched = False
_orig_print = builtins.print


def _wrap_stream(stream):
    if stream is None:
        return stream
    try:
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
            return stream
    except Exception:
        pass
    buf = getattr(stream, "buffer", None)
    if buf is None:
        return stream
    try:
        return io.TextIOWrapper(buf, encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        return stream


def _safe_print(*args, **kwargs):
    try:
        _orig_print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args)
        kwargs = dict(kwargs)
        kwargs.pop("file", None)
        _orig_print(text.encode("ascii", "replace").decode("ascii"), **kwargs)


def install() -> None:
    global _patched
    if _patched:
        return
    _patched = True
    try:
        sys.stdout = _wrap_stream(sys.stdout)
        sys.stderr = _wrap_stream(sys.stderr)
    except Exception:
        pass
    builtins.print = _safe_print


install()

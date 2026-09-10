"""Ensure only one local sidecar owns the executor port across app restarts."""
from __future__ import annotations

import atexit
import os
import re
import signal
import socket
import subprocess
import time
from pathlib import Path


def sidecar_pid_path() -> Path:
    base = Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "com.nolain.nolainquery" / "sidecar.pid"


def _cmdline(pid: int) -> str:
    try:
        return Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode()
    except OSError:
        return ""


def is_sidecar_process(pid: int) -> bool:
    cmd = _cmdline(pid)
    if not cmd:
        return False
    return "python-sidecar" in cmd or ("uvicorn" in cmd and "main" in cmd)


def terminate_pid(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return

    for _ in range(30):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def find_listener_pid(port: int) -> int | None:
    try:
        result = subprocess.run(
            ["ss", "-lptn", f"sport = :{port}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=2,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"pid=(\d+)", result.stdout)
    return int(match.group(1)) if match else None


def port_is_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.2):
            return True
    except OSError:
        return False


def reclaim_sidecar_port(host: str, port: int) -> None:
    """Stop a previous sidecar so this process can bind the executor port."""
    pid_path = sidecar_pid_path()
    if pid_path.exists():
        try:
            recorded = int(pid_path.read_text().strip())
        except ValueError:
            recorded = None
        if recorded and is_sidecar_process(recorded):
            terminate_pid(recorded)

    if port_is_open(host, port):
        listener = find_listener_pid(port)
        if listener and is_sidecar_process(listener):
            terminate_pid(listener)


def register_sidecar_pid() -> None:
    pid_path = sidecar_pid_path()
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(os.getpid()), encoding="utf-8")

    @atexit.register
    def _cleanup_pid_file() -> None:
        try:
            pid_path.unlink(missing_ok=True)
        except OSError:
            pass

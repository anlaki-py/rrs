#!/usr/bin/env python3
"""Low-latency WebSocket PTY server for Linux/Replit."""

from __future__ import annotations

import asyncio
import errno
import fcntl
import json
import os
import pty
import secrets
import signal
import struct
import termios
from http import HTTPStatus
from typing import Any

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "7860"))
TOKEN = os.environ.get("WSPTY_TOKEN")

READ_SIZE = 64 * 1024
PTY_QUEUE_SIZE = 128
MAX_MESSAGE_SIZE = 1024 * 1024


HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WebSocket PTY</title>

  <style>
    body {
      font: 14px monospace;
      max-width: 720px;
      margin: 40px auto;
      padding: 0 20px;
      background: #0d1117;
      color: #c9d1d9;
    }

    pre {
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      background: #161b22;
    }
  </style>
</head>

<body>
  <h1>WebSocket PTY</h1>
  <p>Connect using the wspty client:</p>
  <pre>python wspty wss://HOST</pre>
</body>
</html>
"""


def set_winsize(fd: int, rows: int, cols: int) -> None:
    """Set PTY terminal dimensions."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def valid_dimension(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= 4096
    )


def launch_shell() -> tuple[int, int]:
    """Create a PTY and launch Bash with normal config and a visible prompt."""
    pid, master_fd = pty.fork()

    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"

        # Load Replit's normal ~/.bashrc so aliases, environment changes,
        # completion, and colored commands remain available.
        #
        # Replit's own PS1 contains only invisible OSC-133 markers intended
        # for its browser terminal. This in-memory rcfile replaces only PS1
        # after ~/.bashrc finishes loading.
        rc_read, rc_write = os.pipe()

        rc_script = r"""
if [[ -f ~/.bashrc ]]; then
    source ~/.bashrc
fi

PS1='\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
"""

        os.write(rc_write, rc_script.encode("utf-8"))
        os.close(rc_write)

        # Bash opens the rcfile through /proc/self/fd after exec.
        os.set_inheritable(rc_read, True)

        os.execvp(
            "bash",
            [
                "bash",
                "--rcfile",
                f"/proc/self/fd/{rc_read}",
                "-i",
            ],
        )

        # Reached only if execvp fails.
        os._exit(127)

    os.set_blocking(master_fd, False)
    set_winsize(master_fd, 24, 80)

    return pid, master_fd


async def wait_until_writable(
    loop: asyncio.AbstractEventLoop,
    fd: int,
) -> None:
    """Wait until a nonblocking file descriptor accepts more data."""
    ready = loop.create_future()

    def on_writable() -> None:
        if not ready.done():
            ready.set_result(None)

    loop.add_writer(fd, on_writable)

    try:
        await ready
    finally:
        loop.remove_writer(fd)


async def write_all_nonblocking(
    loop: asyncio.AbstractEventLoop,
    fd: int,
    data: bytes,
) -> None:
    """Write all bytes to the PTY without blocking the event loop."""
    view = memoryview(data)

    while view:
        try:
            written = os.write(fd, view)

        except InterruptedError:
            continue

        except BlockingIOError:
            await wait_until_writable(loop, fd)
            continue

        if written <= 0:
            raise OSError("PTY write returned zero bytes")

        view = view[written:]


async def reap_child(pid: int) -> None:
    """Terminate and reap the shell after a disconnect."""
    try:
        waited_pid, _ = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return

    if waited_pid == pid:
        return

    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        return

    for _ in range(20):
        await asyncio.sleep(0.05)

        try:
            waited_pid, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return

        if waited_pid == pid:
            return

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return

    try:
        await asyncio.to_thread(os.waitpid, pid, 0)
    except ChildProcessError:
        pass


async def shell(websocket: Any) -> None:
    pid, master_fd = launch_shell()
    loop = asyncio.get_running_loop()

    output_queue: asyncio.Queue[bytes | None] = asyncio.Queue(
        maxsize=PTY_QUEUE_SIZE
    )

    reader_registered = False
    pty_finished = False
    eof_queued = False

    def pause_pty_reader() -> None:
        nonlocal reader_registered

        if reader_registered:
            loop.remove_reader(master_fd)
            reader_registered = False

    def queue_eof_if_possible() -> None:
        nonlocal eof_queued

        if (
            pty_finished
            and not eof_queued
            and not output_queue.full()
        ):
            output_queue.put_nowait(None)
            eof_queued = True

    def mark_pty_finished() -> None:
        nonlocal pty_finished

        pty_finished = True
        pause_pty_reader()
        queue_eof_if_possible()

    def on_pty_readable() -> None:
        if output_queue.full():
            pause_pty_reader()
            return

        try:
            data = os.read(master_fd, READ_SIZE)

        except BlockingIOError:
            return

        except OSError as exc:
            # Linux PTY masters normally return EIO when the slave closes.
            if exc.errno in (errno.EIO, errno.EBADF):
                mark_pty_finished()
                return

            raise

        if not data:
            mark_pty_finished()
            return

        output_queue.put_nowait(data)

        if output_queue.full():
            pause_pty_reader()

    def resume_pty_reader() -> None:
        nonlocal reader_registered

        if (
            pty_finished
            or reader_registered
            or output_queue.full()
        ):
            return

        loop.add_reader(master_fd, on_pty_readable)
        reader_registered = True

    async def send_pty_output() -> None:
        while True:
            data = await output_queue.get()

            # A queue slot is now available, so PTY reading may resume.
            resume_pty_reader()
            queue_eof_if_possible()

            try:
                if data is None:
                    return

                await websocket.send(data)

            finally:
                output_queue.task_done()

    async def receive_client_input() -> None:
        async for message in websocket:
            if isinstance(message, str):
                try:
                    command = json.loads(message)
                except json.JSONDecodeError:
                    command = None

                if isinstance(command, dict):
                    rows = command.get("rows")
                    cols = command.get("cols")

                    if valid_dimension(rows) and valid_dimension(cols):
                        set_winsize(master_fd, rows, cols)

                        try:
                            os.kill(pid, signal.SIGWINCH)
                        except ProcessLookupError:
                            return

                        continue

                # Compatibility with text-only WebSocket clients.
                payload = (
                    message.encode(
                        "utf-8",
                        errors="replace",
                    )
                    + b"\n"
                )

            else:
                # Binary frames contain raw terminal keystrokes.
                payload = message

            try:
                await write_all_nonblocking(
                    loop,
                    master_fd,
                    payload,
                )

            except OSError as exc:
                if exc.errno in (
                    errno.EIO,
                    errno.EBADF,
                    errno.EPIPE,
                ):
                    return

                raise

    resume_pty_reader()

    sender_task = asyncio.create_task(
        send_pty_output(),
        name=f"pty-send-{pid}",
    )

    receiver_task = asyncio.create_task(
        receive_client_input(),
        name=f"pty-receive-{pid}",
    )

    try:
        done, pending = await asyncio.wait(
            {
                sender_task,
                receiver_task,
            },
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

        await asyncio.gather(
            *pending,
            return_exceptions=True,
        )

        for task in done:
            try:
                task.result()
            except ConnectionClosed:
                pass

    finally:
        pause_pty_reader()
        loop.remove_writer(master_fd)

        try:
            os.close(master_fd)
        except OSError:
            pass

        await reap_child(pid)


def process_request(
    connection: Any,
    request: Any,
) -> Any:
    """Handle ordinary HTTP requests and optional bearer authentication."""
    is_websocket = (
        request.headers.get("Upgrade", "").lower()
        == "websocket"
    )

    if not is_websocket:
        if request.path == "/healthz":
            return connection.respond(
                HTTPStatus.OK,
                "OK\n",
            )

        return connection.respond(
            HTTPStatus.OK,
            HTML_PAGE,
        )

    if TOKEN:
        supplied = request.headers.get(
            "Authorization",
            "",
        )

        expected = f"Bearer {TOKEN}"

        if not secrets.compare_digest(
            supplied,
            expected,
        ):
            return connection.respond(
                HTTPStatus.UNAUTHORIZED,
                "Unauthorized\n",
            )

    return None


async def main() -> None:
    if not TOKEN:
        print(
            "WARNING: WSPTY_TOKEN is not set; "
            "anyone with the URL can open a shell.",
            flush=True,
        )

    async with serve(
        shell,
        HOST,
        PORT,
        process_request=process_request,
        compression=None,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=5,
        max_size=MAX_MESSAGE_SIZE,
        max_queue=16,
        write_limit=32 * 1024,
        server_header=None,
    ) as server:
        print(
            f"WebSocket PTY listening on {HOST}:{PORT}",
            flush=True,
        )

        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
#!/usr/bin/env python3
"""WebSocket PTY client for Termux.

TLS certificate verification is always disabled for wss:// connections.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import ssl
import sys
import termios
import tty
from typing import Any

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

READ_SIZE = 64 * 1024
OUTBOUND_QUEUE_SIZE = 128
MAX_MESSAGE_SIZE = 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Connect this terminal to a remote PTY over WebSocket."
    )
    parser.add_argument("url", help="ws:// or wss:// server URL")
    parser.add_argument(
        "--token",
        default=os.environ.get("WSPTY_TOKEN"),
        help="Bearer token; defaults to WSPTY_TOKEN",
    )
    return parser.parse_args()


def normalize_url(url: str) -> str:
    if url.startswith(("ws://", "wss://")):
        return url

    return f"wss://{url}"


def make_insecure_ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)

    while view:
        try:
            written = os.write(fd, view)
        except InterruptedError:
            continue

        if written <= 0:
            raise OSError("terminal write returned zero bytes")

        view = view[written:]


async def run_client(args: argparse.Namespace) -> None:
    url = normalize_url(args.url)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    if not os.isatty(stdin_fd):
        raise SystemExit("wspty requires an interactive terminal")

    headers = None

    if args.token:
        headers = {
            "Authorization": f"Bearer {args.token}",
        }

    connect_options: dict[str, Any] = {
        "additional_headers": headers,
        "compression": None,
        "open_timeout": 15,
        "ping_interval": 20,
        "ping_timeout": 20,
        "close_timeout": 5,
        "max_size": MAX_MESSAGE_SIZE,
        "max_queue": 16,
        "write_limit": 32 * 1024,
    }

    # Always bypass TLS certificate verification for wss://.
    if url.startswith("wss://"):
        connect_options["ssl"] = make_insecure_ssl_context()

    async with connect(url, **connect_options) as websocket:
        loop = asyncio.get_running_loop()
        old_terminal_settings = termios.tcgetattr(stdin_fd)

        outbound: asyncio.Queue[tuple[str, object]] = asyncio.Queue(
            maxsize=OUTBOUND_QUEUE_SIZE
        )

        stdin_registered = False
        stdin_finished = False

        desired_size: tuple[int, int] | None = None
        last_sent_size: tuple[int, int] | None = None

        resize_queued = False
        eof_queued = False

        def pause_stdin() -> None:
            nonlocal stdin_registered

            if stdin_registered:
                loop.remove_reader(stdin_fd)
                stdin_registered = False

        def queue_resize() -> None:
            nonlocal resize_queued

            if (
                resize_queued
                or desired_size is None
                or desired_size == last_sent_size
                or outbound.full()
            ):
                return

            outbound.put_nowait(("resize", None))
            resize_queued = True

        def queue_eof() -> None:
            nonlocal eof_queued

            if stdin_finished and not eof_queued and not outbound.full():
                outbound.put_nowait(("eof", None))
                eof_queued = True

        def refresh_terminal_size() -> None:
            nonlocal desired_size

            try:
                columns, rows = os.get_terminal_size(stdin_fd)
            except OSError:
                return

            desired_size = (rows, columns)
            queue_resize()

        def on_stdin_ready() -> None:
            nonlocal stdin_finished

            if outbound.full():
                pause_stdin()
                return

            try:
                data = os.read(stdin_fd, READ_SIZE)
            except BlockingIOError:
                return
            except OSError:
                data = b""

            if not data:
                stdin_finished = True
                pause_stdin()
                queue_eof()
                return

            outbound.put_nowait(("data", data))

            if outbound.full():
                pause_stdin()

        def resume_stdin() -> None:
            nonlocal stdin_registered

            if stdin_finished or stdin_registered or outbound.full():
                return

            loop.add_reader(stdin_fd, on_stdin_ready)
            stdin_registered = True

        async def sender() -> None:
            nonlocal resize_queued, last_sent_size

            while True:
                kind, payload = await outbound.get()

                resume_stdin()
                queue_resize()
                queue_eof()

                try:
                    if kind == "data":
                        assert isinstance(payload, bytes)
                        await websocket.send(payload)

                    elif kind == "resize":
                        resize_queued = False
                        current_size = desired_size

                        if (
                            current_size is not None
                            and current_size != last_sent_size
                        ):
                            rows, columns = current_size

                            await websocket.send(
                                json.dumps(
                                    {
                                        "rows": rows,
                                        "cols": columns,
                                    },
                                    separators=(",", ":"),
                                )
                            )

                            last_sent_size = current_size

                        queue_resize()

                    elif kind == "eof":
                        return

                finally:
                    outbound.task_done()

        async def receiver() -> None:
            async for message in websocket:
                if isinstance(message, str):
                    continue

                write_all(stdout_fd, message)

        tty.setraw(stdin_fd)

        try:
            resume_stdin()
            loop.add_signal_handler(signal.SIGWINCH, refresh_terminal_size)

            refresh_terminal_size()

            sender_task = asyncio.create_task(sender())
            receiver_task = asyncio.create_task(receiver())

            done, pending = await asyncio.wait(
                {sender_task, receiver_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

            await asyncio.gather(*pending, return_exceptions=True)

            for task in done:
                try:
                    task.result()
                except ConnectionClosed:
                    pass

        finally:
            pause_stdin()
            loop.remove_signal_handler(signal.SIGWINCH)

            termios.tcsetattr(
                stdin_fd,
                termios.TCSADRAIN,
                old_terminal_settings,
            )

            write_all(stdout_fd, b"\r\n")


async def main() -> None:
    args = parse_args()

    try:
        await run_client(args)
    except ConnectionClosed as exc:
        if exc.code not in (1000, 1001):
            print(f"wspty: connection closed: {exc}", file=sys.stderr)
    except (OSError, TimeoutError) as exc:
        raise SystemExit(f"wspty: {exc}") from exc


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
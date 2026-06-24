"""
Combined HTTP static file server + WebSocket signaling server.

Serves the browser client from webrtc-m1/client/ on HTTP,
and handles WebSocket upgrades for signaling — all on one port.

Usage:  python -m server.http_server [port]   (default 8080)
"""

import asyncio
import json
import mimetypes
import os
import pathlib
import sys
from http import HTTPStatus

import websockets
import websockets.exceptions
from websockets.datastructures import Headers
from websockets.http11 import Response, Request
from server.signaling import make_handler

# Resolve client directory relative to this file
_REPO_ROOT = pathlib.Path(__file__).parent.parent
CLIENT_DIR = (_REPO_ROOT / "client").resolve()

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


def _serve_file(url_path: str) -> Response:
    if url_path in ("", "/"):
        url_path = "/index.html"

    # Safety: prevent path traversal
    try:
        file_path = (CLIENT_DIR / url_path.lstrip("/")).resolve()
        file_path.relative_to(CLIENT_DIR)
    except ValueError:
        return Response(403, "Forbidden", Headers([("Content-Length", "0")]), b"")

    if not file_path.exists() or not file_path.is_file():
        body = b"Not found"
        return Response(404, "Not Found", Headers([("Content-Length", str(len(body)))]), body)

    body = file_path.read_bytes()
    mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    headers = Headers([
        ("Content-Type", mime),
        ("Content-Length", str(len(body))),
    ])
    return Response(200, "OK", headers, body)


async def _process_request(connection, request: Request):
    # WebSocket upgrade — let websockets handle it
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None
    return _serve_file(request.path.split("?")[0])


async def start_server(port: int):
    _rooms, handler = make_handler()

    server = await websockets.serve(
        handler,
        "",
        port,
        process_request=_process_request,
    )
    return server


def _get_other_peer(ws, room_id, rooms):
    if room_id is None:
        return None
    peers = rooms.get(room_id)
    if not peers:
        return None
    for p in peers:
        if p is not ws:
            return p
    return None


async def _send(ws, msg):
    try:
        await ws.send(json.dumps(msg))
    except websockets.exceptions.ConnectionClosed:
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))

    async def main():
        if not CLIENT_DIR.exists():
            print(f"ERROR: client directory not found: {CLIENT_DIR}")
            sys.exit(1)
        server = await start_server(port)
        print(f"Serving  http://localhost:{port}")
        print(f"Open http://localhost:{port} in two browser tabs")
        print("Ctrl+C to stop")
        await server.wait_closed()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

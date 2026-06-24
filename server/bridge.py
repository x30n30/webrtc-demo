"""
Azimuth bridge — pushes head-tracking azimuth to connected browser clients
over a dedicated WebSocket endpoint.

Usage:
    bridge = Bridge()
    asyncio.run(bridge.serve(port=9090))

    # From pynput thread:
    bridge.push_azimuth(azimuth)
"""

import asyncio
import json
import websockets
import websockets.exceptions


class Bridge:
    def __init__(self):
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def _handler(self, ws):
        self._clients.add(ws)
        try:
            await ws.wait_closed()
        finally:
            self._clients.discard(ws)

    def push_azimuth(self, azimuth: float):
        """Thread-safe: called from pynput listener thread."""
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(
            self._broadcast({"type": "azimuth", "value": azimuth}),
            self._loop,
        )

    async def _broadcast(self, msg: dict):
        data = json.dumps(msg)
        dead: set = set()
        for ws in list(self._clients):
            try:
                await ws.send(data)
            except websockets.exceptions.ConnectionClosed:
                dead.add(ws)
        self._clients -= dead

    async def serve(self, port: int = 9090):
        self._loop = asyncio.get_running_loop()
        server = await websockets.serve(self._handler, "localhost", port)
        print(f"Bridge listening on ws://localhost:{port}")
        await server.wait_closed()

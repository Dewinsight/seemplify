#!/usr/bin/env python3
"""
Docker entrypoint wrapper for the UBA FastLane dashboard.

Reads DASH_HOST and DASH_PORT from environment variables so the container
can bind to 0.0.0.0
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, "/app")

from fast_lane.dash_view import create_app

HOST = os.environ.get("DASH_HOST", "0.0.0.0")
PORT = int(os.environ.get("DASH_PORT", "8050"))
DEBUG = os.environ.get("DASH_DEBUG", "false").lower() == "true"

print("\n" + "=" * 65)
print("  UBA FastLane Intelligence")
print("=" * 65)
print(f"\n  ✓  Starting server on {HOST}:{PORT}")
print(f"  ✓  Debug mode: {DEBUG}")
print(f"\n  Open your browser at:  http://localhost:{PORT}")
print("\n  To stop: Ctrl+C  |  docker stop <container>")
print("=" * 65 + "\n")

app = create_app()
app.run(host=HOST, port=PORT, debug=DEBUG)

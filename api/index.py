"""Vercel ASGI entrypoint for the authoritative FastAPI backend."""

from pathlib import Path
import sys


BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
backend_path = str(BACKEND_DIR)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from main import app  # noqa: E402,F401

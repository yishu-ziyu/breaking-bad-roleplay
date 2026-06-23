#!/usr/bin/env python3
"""Entry point: read PORT from env, start uvicorn."""
import os
import sys

port = int(os.environ.get("PORT", "8080"))

# Ensure backend/ is on the path so 'main:app' can be imported
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import uvicorn
from backend.main import app

uvicorn.run(app, host="0.0.0.0", port=port)

import sys
from pathlib import Path

# Ensure 'app' package is discoverable when run as a Vercel serverless function
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app

# Export the FastAPI instance for Vercel
app = app

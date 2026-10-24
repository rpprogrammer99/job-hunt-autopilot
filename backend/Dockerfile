# Cloud Run-ready container for the Job Hunt Autopilot backend.
# Build from the repo root:  docker build -f backend/Dockerfile -t jha-backend .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY sample-data ./sample-data

# Tell the app where bundled sample data lives inside the image.
ENV SAMPLE_DATA_DIR=/srv/sample-data

EXPOSE 8080

# Cloud Run provides $PORT (default 8080).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

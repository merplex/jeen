FROM python:3.12-slim

# Install system dependencies for Azure Speech SDK
RUN apt-get update && apt-get install -y --no-install-recommends \
    uuid-dev \
    libssl-dev \
    libasound2-dev \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null || true \
    && pip install --no-cache-dir opencv-python-headless==4.10.0.84

COPY . .

EXPOSE 8080

CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}

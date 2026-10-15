FROM python:3.12-slim

# ffmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# fresh yt-dlp (Shorts support improves with newer builds)
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --upgrade yt-dlp

COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["python3", "backend.py"]

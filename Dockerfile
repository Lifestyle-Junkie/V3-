FROM python:3.12-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install yt-dlp
RUN pip install --no-cache-dir yt-dlp

COPY . .
ENV PYTHONUNBUFFERED=1
CMD ["python3", "backend.py"]

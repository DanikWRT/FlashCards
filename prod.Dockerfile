FROM python:3-alpine

# FlashCards shared-sets backend (stdlib-only) in a thin container.
# dist is mounted read-only at /app/dist at runtime (so deploys are just a file copy, no rebuild).
# DB is mounted via FC_DB_PATH to a writable volume.

WORKDIR /app
RUN mkdir -p /app/backend
COPY backend/app.py /app/backend/app.py

EXPOSE 5199
ENV FC_DB_PATH=/data/fc.db

CMD ["python3", "/app/backend/app.py"]

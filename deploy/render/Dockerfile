FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=10000
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY backend/main.py ./
COPY backend/certs/ ./certs/
COPY --from=frontend /build/dist/ /app/site/
COPY deploy/render/ /app/deploy/
RUN addgroup --system flowlist && adduser --system --ingroup flowlist flowlist
USER flowlist
EXPOSE 10000
CMD ["sh", "/app/deploy/start.sh"]

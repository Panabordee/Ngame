FROM python:3.14-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /build

COPY backend/pyproject.toml ./pyproject.toml
COPY backend/src ./src
RUN python -m pip wheel --wheel-dir /wheels .

FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN groupadd --system ngame && useradd --system --gid ngame --home-dir /app ngame
COPY --from=builder /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/* && rm -rf /wheels

COPY backend/alembic.ini ./alembic.ini
COPY backend/migrations ./migrations

USER ngame
EXPOSE 8000
CMD ["uvicorn", "ngame_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

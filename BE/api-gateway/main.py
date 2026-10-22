import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from business.gateway_service import GatewayService
from data.clients.site_client import SiteClient
from presentation.admin_auth import configure_admin_auth
from presentation.auth_router import router as auth_router
from presentation.gateway_router import router

AUDIO_DIR = Path(os.getenv("AUDIO_DIR", "/shared/audio"))
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(float(os.getenv("SITE_SERVICE_TIMEOUT", "90")))
    )
    app.state.gateway_service = GatewayService(
        SiteClient(
            http_client,
            os.getenv("SITE_SERVICE_URL", "http://localhost:8000"),
        )
    )
    app.state.http_client = http_client
    try:
        yield
    finally:
        await http_client.aclose()


app = FastAPI(title="DiTichQ1 API Gateway", lifespan=lifespan)
configure_admin_auth(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(router)
app.include_router(auth_router)
app.mount(
    "/api/audio/files",
    StaticFiles(directory=str(AUDIO_DIR)),
    name="audio-files",
)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "api-gateway"}

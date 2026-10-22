import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from business.site_service import SiteService
from business.listener_service import ListenerService
from data.activity_repository import ActivityRepository
from data.listener_repository import ListenerRepository
from data.site_repository import SiteRepository
from integrations.translation_client import TranslationClient
from presentation.listener_router import listener_router
from presentation.site_router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_client = AsyncIOMotorClient(
        os.getenv("MONGO_URL", "mongodb://localhost:27017"),
        serverSelectionTimeoutMS=5000,
    )
    database = mongo_client[os.getenv("SITE_DATABASE", "district1_sites")]
    site_collection = database.get_collection("sites")
    listener_collection = database.get_collection("listener_sessions")
    activity_collection = database.get_collection("site_activity")
    await site_collection.create_index("code", unique=True)
    await site_collection.create_index([("location", "2dsphere")])
    await listener_collection.create_index("session_id", unique=True)
    await listener_collection.create_index("last_seen", expireAfterSeconds=60)
    await activity_collection.create_index([("created_at", -1)])

    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(float(os.getenv("TRANSLATION_SERVICE_TIMEOUT", "90")))
    )
    app.state.site_service = SiteService(
        SiteRepository(site_collection),
        TranslationClient(
            http_client,
            os.getenv(
                "TRANSLATION_SERVICE_URL",
                "http://localhost:8001",
            ),
        ),
        ActivityRepository(activity_collection),
    )
    app.state.listener_service = ListenerService(
        ListenerRepository(listener_collection)
    )
    app.state.mongo_client = mongo_client
    app.state.http_client = http_client
    try:
        yield
    finally:
        await http_client.aclose()
        mongo_client.close()


app = FastAPI(title="DiTichQ1 Site Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(router)
app.include_router(listener_router)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "site-service"}

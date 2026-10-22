import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient

from business.audio_service import AudioService
from business.tts_engine import TTSService
from data.translation_repository import TranslationRepository
from presentation.audio_router import router

AUDIO_DIR = Path(
    os.getenv(
        "AUDIO_DIR",
        str(Path(__file__).parent / "static" / "audio"),
    )
)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_client = AsyncIOMotorClient(
        os.getenv("MONGO_URL", "mongodb://localhost:27017"),
        serverSelectionTimeoutMS=5000,
    )
    database = mongo_client[
        os.getenv("TRANSLATION_DATABASE", "district1_translations")
    ]
    translation_collection = database.get_collection("translations")
    await translation_collection.create_index(
        [("site_code", 1), ("language", 1)],
        unique=True,
    )
    tts_service = TTSService(cache_dir=str(AUDIO_DIR))
    app.state.audio_service = AudioService(
        TranslationRepository(translation_collection),
        tts_service,
        AUDIO_DIR,
        translation_timeout=float(os.getenv("TRANSLATION_TIMEOUT", "60")),
    )
    app.state.mongo_client = mongo_client
    app.state.tts_service = tts_service
    try:
        yield
    finally:
        mongo_client.close()


app = FastAPI(title="DiTichQ1 Translation & Audio Service", lifespan=lifespan)
app.include_router(router)
app.mount(
    "/static/audio",
    StaticFiles(directory=str(AUDIO_DIR)),
    name="audio",
)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "translation-service"}

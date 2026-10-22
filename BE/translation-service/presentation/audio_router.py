import asyncio
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, StringConstraints

from business.audio_service import AudioProcessingError, AudioService
from business.tts_engine import TTSService

router = APIRouter(prefix="/internal/audio", tags=["Translation and audio"])
SiteCode = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=2, max_length=80),
]


class AudioRequest(BaseModel):
    source_description: str = Field(min_length=10, max_length=20000)
    lang: str = Field(pattern=r"^(vi|en|ja|zh-CN)$")


def get_audio_service(request: Request) -> AudioService:
    return request.app.state.audio_service


def get_tts_service(request: Request) -> TTSService:
    return request.app.state.tts_service


@router.post("/{site_code}")
async def get_site_audio(
    site_code: SiteCode,
    audio_request: AudioRequest,
    request: Request,
):
    try:
        result = await get_audio_service(request).get_audio(
            site_code,
            audio_request.source_description,
            audio_request.lang,
        )
        result["audio_url"] = f"/api/audio/files/{result['audio_filename']}"
        return result
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Translation provider timed out.",
        ) from exc
    except AudioProcessingError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Audio generation provider returned invalid output.",
        ) from exc


@router.get("/packs/{lang}")
async def get_audio_pack_manifest(lang: str, request: Request):
    if lang not in {"vi", "en", "ja", "zh-CN"}:
        raise HTTPException(status_code=400, detail="Unsupported language.")
    return get_tts_service(request).get_pack_manifest(lang)

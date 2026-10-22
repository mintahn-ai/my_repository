from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, StringConstraints

from business.site_service import SiteService
from integrations.translation_client import TranslationServiceUnavailable

router = APIRouter(prefix="/internal/sites", tags=["Sites"])
SiteCode = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=2, max_length=80),
]


class SiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    code: SiteCode
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = Field(min_length=2, max_length=300)
    category: str = Field(default="Di tích lịch sử", min_length=2, max_length=100)
    description: str = Field(min_length=10, max_length=20000)
    is_active: bool = True


class SiteUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = Field(min_length=2, max_length=300)
    category: str = Field(default="Di tích lịch sử", min_length=2, max_length=100)
    description: str = Field(min_length=10, max_length=20000)
    is_active: bool = True


class LocationSync(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    lang: str = Field(default="vi", pattern=r"^(vi|en|ja|zh-CN)$")
    radius_m: float = Field(default=30, gt=0, le=1000)


def get_site_service(request: Request) -> SiteService:
    return request.app.state.site_service


@router.get("/")
async def get_sites(
    request: Request,
    lang: str = Query("vi", pattern=r"^(vi|en|ja|zh-CN)$"),
    include_audio: bool = False,
):
    try:
        return await get_site_service(request).get_sites(lang, include_audio)
    except TranslationServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation service is unavailable.",
        ) from exc


@router.get("/admin")
async def get_admin_sites(request: Request):
    return await get_site_service(request).get_admin_sites()


@router.get("/activity")
async def get_recent_activity(request: Request):
    return await get_site_service(request).get_recent_activity()


@router.get("/nearby")
async def get_nearby_sites(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_m: float = Query(500, gt=0, le=5000),
    lang: str = Query("vi", pattern=r"^(vi|en|ja|zh-CN)$"),
    include_audio: bool = False,
):
    try:
        return await get_site_service(request).get_nearby_sites(
            lat,
            lng,
            radius_m,
            lang,
            include_audio,
        )
    except TranslationServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation service is unavailable.",
        ) from exc


@router.get("/{site_code}/narration")
async def get_site_narration(
    site_code: SiteCode,
    request: Request,
    lang: str = Query("vi", pattern=r"^(vi|en|ja|zh-CN)$"),
):
    try:
        site = await get_site_service(request).get_site_narration(
            site_code,
            lang,
        )
    except TranslationServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation service is unavailable.",
        ) from exc
    if site is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site was not found.",
        )
    return site


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_site(site: SiteCreate, request: Request):
    try:
        return await get_site_service(request).create_site(site.model_dump())
    except DuplicateKeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A site with this code already exists.",
        ) from exc


@router.put("/{site_code}")
async def update_site(site_code: SiteCode, site: SiteUpdate, request: Request):
    updated = await get_site_service(request).update_site(
        site_code,
        site.model_dump(),
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site was not found.",
        )
    return updated


@router.delete("/{site_code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(site_code: SiteCode, request: Request):
    deleted = await get_site_service(request).delete_site(site_code)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site was not found.",
        )


@router.post("/sync-location")
async def sync_location(location: LocationSync, request: Request):
    try:
        return await get_site_service(request).sync_location(
            location.lat,
            location.lng,
            location.lang,
            location.radius_m,
        )
    except TranslationServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation service is unavailable.",
        ) from exc

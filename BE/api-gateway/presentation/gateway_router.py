from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Request, status
from pydantic import BaseModel, Field, StringConstraints

from business.gateway_service import GatewayService
from presentation.admin_auth import require_admin_api

router = APIRouter(prefix="/api/sites", tags=["Sites"])
Language = Annotated[str, Query(pattern=r"^(vi|en|ja|zh-CN)$")]


def get_gateway_service(request: Request) -> GatewayService:
    return request.app.state.gateway_service


class LocationSync(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    lang: str = Field(default="vi", pattern=r"^(vi|en|ja|zh-CN)$")
    radius_m: float = Field(default=30, gt=0, le=1000)


class ListenerSession(BaseModel):
    session_id: UUID
    site_code: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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


@router.get("/")
async def get_sites(
    request: Request,
    lang: Language = "vi",
    include_audio: bool = False,
):
    return await get_gateway_service(request).get_sites(lang, include_audio)


@router.get("/admin")
async def get_admin_sites(
    request: Request,
    _: None = Depends(require_admin_api),
):
    return await get_gateway_service(request).get_admin_sites()


@router.get("/activity")
async def get_recent_activity(
    request: Request,
    _: None = Depends(require_admin_api),
):
    return await get_gateway_service(request).get_recent_activity()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_site(
    site: SiteCreate,
    request: Request,
    _: None = Depends(require_admin_api),
):
    return await get_gateway_service(request).create_site(site.model_dump())


@router.put("/{site_code}")
async def update_site(
    site_code: SiteCode,
    site: SiteUpdate,
    request: Request,
    _: None = Depends(require_admin_api),
):
    return await get_gateway_service(request).update_site(
        site_code,
        site.model_dump(),
    )


@router.delete("/{site_code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_code: SiteCode,
    request: Request,
    _: None = Depends(require_admin_api),
):
    await get_gateway_service(request).delete_site(site_code)


@router.get("/nearby")
async def get_nearby_sites(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_m: float = Query(500, gt=0, le=5000),
    lang: Language = "vi",
    include_audio: bool = False,
):
    return await get_gateway_service(request).get_nearby_sites(
        lat,
        lng,
        radius_m,
        lang,
        include_audio,
    )


@router.get("/{site_code}/narration")
async def get_site_narration(
    site_code: str,
    request: Request,
    lang: Language = "vi",
):
    return await get_gateway_service(request).get_site_narration(site_code, lang)


@router.post("/sync-location")
async def sync_location(
    request: Request,
    location: LocationSync = Body(),
):
    return await get_gateway_service(request).sync_location(
        location.lat,
        location.lng,
        location.lang,
        location.radius_m,
    )


@router.get("/listeners/active", tags=["Listeners"])
async def get_active_listeners(
    request: Request,
    _: None = Depends(require_admin_api),
):
    return await get_gateway_service(request).get_active_listeners()


@router.post("/listeners/heartbeat", tags=["Listeners"])
async def heartbeat_listener(session: ListenerSession, request: Request):
    return await get_gateway_service(request).heartbeat_listener(
        str(session.session_id),
        session.site_code,
    )


@router.post("/listeners/leave", tags=["Listeners"])
async def leave_listener(
    request: Request,
    session_id: UUID = Query(),
):
    return await get_gateway_service(request).leave_listener(str(session_id))

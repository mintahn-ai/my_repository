from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field, StringConstraints

from business.listener_service import ListenerService

listener_router = APIRouter(prefix="/internal/listeners", tags=["Listeners"])
SiteCode = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=2, max_length=80),
]


class ListenerSession(BaseModel):
    session_id: UUID
    site_code: SiteCode


def get_listener_service(request: Request) -> ListenerService:
    return request.app.state.listener_service


@listener_router.get("/active")
async def get_active_listeners(request: Request):
    return await get_listener_service(request).get_active()


@listener_router.post("/heartbeat")
async def heartbeat_listener(session: ListenerSession, request: Request):
    return await get_listener_service(request).heartbeat(
        str(session.session_id),
        session.site_code,
    )


@listener_router.post("/leave")
async def leave_listener(
    request: Request,
    session_id: UUID = Query(),
):
    return await get_listener_service(request).leave(str(session_id))

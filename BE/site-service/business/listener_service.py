from data.listener_repository import ListenerRepository


class ListenerService:
    def __init__(self, repository: ListenerRepository):
        self.repository = repository

    async def heartbeat(self, session_id: str, site_code: str) -> dict:
        await self.repository.heartbeat(session_id, site_code)
        return {"active": True, "session_id": session_id}

    async def leave(self, session_id: str) -> dict:
        await self.repository.leave(session_id)
        return {"active": False, "session_id": session_id}

    async def get_active(self) -> dict:
        return await self.repository.get_active()

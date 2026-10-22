from data.clients.site_client import SiteClient


class GatewayService:
    def __init__(self, site_client: SiteClient):
        self.site_client = site_client

    async def get_sites(
        self,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict]:
        return await self.site_client.get_sites(lang, include_audio)

    async def get_admin_sites(self) -> list[dict]:
        return await self.site_client.get_admin_sites()

    async def get_recent_activity(self) -> list[dict]:
        return await self.site_client.get_recent_activity()

    async def create_site(self, site_data: dict) -> dict:
        return await self.site_client.create_site(site_data)

    async def update_site(self, site_code: str, site_data: dict) -> dict:
        return await self.site_client.update_site(site_code, site_data)

    async def delete_site(self, site_code: str) -> None:
        await self.site_client.delete_site(site_code)

    async def get_nearby_sites(
        self,
        lat: float,
        lng: float,
        radius_m: float,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict]:
        return await self.site_client.get_nearby_sites(
            lat,
            lng,
            radius_m,
            lang,
            include_audio,
        )

    async def get_site_narration(self, site_code: str, lang: str) -> dict:
        return await self.site_client.get_site_narration(site_code, lang)

    async def sync_location(
        self,
        lat: float,
        lng: float,
        lang: str,
        radius_m: float,
    ) -> dict:
        return await self.site_client.sync_location(
            lat,
            lng,
            lang,
            radius_m,
        )

    async def get_active_listeners(self) -> dict:
        return await self.site_client.get_active_listeners()

    async def heartbeat_listener(self, session_id: str, site_code: str) -> dict:
        return await self.site_client.heartbeat_listener(session_id, site_code)

    async def leave_listener(self, session_id: str) -> dict:
        return await self.site_client.leave_listener(session_id)

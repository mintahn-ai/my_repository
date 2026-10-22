import asyncio
from typing import Any

from data.site_repository import SiteRepository
from data.activity_repository import ActivityRepository
from integrations.translation_client import TranslationClient


class SiteService:
    def __init__(
        self,
        repository: SiteRepository,
        translation_client: TranslationClient,
        activity_repository: ActivityRepository,
    ):
        self.repository = repository
        self.translation_client = translation_client
        self.activity_repository = activity_repository
        self._translation_semaphore = asyncio.Semaphore(4)

    async def get_sites(
        self,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict[str, Any]]:
        sites = await self.repository.get_all()
        if not include_audio:
            return sites
        return await self._add_translations(sites, lang)

    async def get_admin_sites(self) -> list[dict[str, Any]]:
        return await self.repository.get_all(include_inactive=True)

    async def get_recent_activity(self) -> list[dict[str, Any]]:
        return await self.activity_repository.get_recent()

    async def get_nearby_sites(
        self,
        lat: float,
        lng: float,
        radius_m: float,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict[str, Any]]:
        sites = await self.repository.find_nearby(lng, lat, radius_m)
        if not include_audio:
            return sites
        return await self._add_translations(sites, lang)

    async def get_site_narration(self, site_code: str, lang: str) -> dict[str, Any] | None:
        site = await self.repository.get_by_code(site_code)
        if site is None:
            return None
        return (await self._add_translations([site], lang))[0]

    async def sync_location(
        self,
        lat: float,
        lng: float,
        lang: str,
        radius_m: float,
    ) -> dict[str, Any]:
        nearby = await self.repository.find_nearby(lng, lat, radius_m)
        if not nearby:
            return {"in_zone": False, "trigger": False}

        site = (await self._add_translations([nearby[0]], lang))[0]
        return {
            "in_zone": True,
            "trigger": True,
            "site_name": site["name"],
            "site": site,
            "audio": {
                "trigger_audio": True,
                "url": site["audio_url"],
                "text": site["translation"]["description"],
            },
        }

    async def create_site(self, site_data: dict[str, Any]) -> dict[str, Any]:
        site_data["location"] = self._location(site_data["lat"], site_data["lng"])
        created = await self.repository.create(site_data)
        await self.activity_repository.record(
            "created",
            created["code"],
            created["name"],
        )
        return created

    async def update_site(
        self,
        code: str,
        site_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        site_data["location"] = self._location(site_data["lat"], site_data["lng"])
        updated = await self.repository.update(code, site_data)
        if updated is not None:
            await self.activity_repository.record(
                "updated",
                code,
                updated["name"],
            )
        return updated

    async def delete_site(self, code: str) -> bool:
        site = await self.repository.get_by_code(code, include_inactive=True)
        deleted = await self.repository.delete(code)
        if deleted:
            await self.activity_repository.record(
                "deleted",
                code,
                site["name"] if site else code,
            )
        return deleted

    @staticmethod
    def _location(lat: float, lng: float) -> dict[str, Any]:
        return {
            "type": "Point",
            "coordinates": [lng, lat],
        }

    async def _add_translations(
        self,
        sites: list[dict[str, Any]],
        lang: str,
    ) -> list[dict[str, Any]]:
        async def add_translation(site: dict[str, Any]) -> dict[str, Any]:
            async with self._translation_semaphore:
                translation = await self.translation_client.get_audio(
                    site_code=site["code"],
                    source_description=site["description"],
                    lang=lang,
                )
            site["translation"] = translation
            site["audio_url"] = (
                f"/api/audio/files/{translation['audio_filename']}"
            )
            return site

        return await asyncio.gather(*(add_translation(site) for site in sites))

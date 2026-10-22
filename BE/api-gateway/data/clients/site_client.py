import httpx
from fastapi import HTTPException


class SiteClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str):
        self.client = client
        self.base_url = base_url.rstrip("/")

    async def get_sites(
        self,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict]:
        return await self._request(
            "GET",
            "/internal/sites/",
            params={"lang": lang, "include_audio": include_audio},
        )

    async def get_admin_sites(self) -> list[dict]:
        return await self._request("GET", "/internal/sites/admin")

    async def get_recent_activity(self) -> list[dict]:
        return await self._request("GET", "/internal/sites/activity")

    async def create_site(self, site_data: dict) -> dict:
        return await self._request(
            "POST",
            "/internal/sites/",
            json=site_data,
        )

    async def update_site(self, site_code: str, site_data: dict) -> dict:
        return await self._request(
            "PUT",
            f"/internal/sites/{site_code}",
            json=site_data,
        )

    async def delete_site(self, site_code: str) -> None:
        await self._request("DELETE", f"/internal/sites/{site_code}")

    async def get_nearby_sites(
        self,
        lat: float,
        lng: float,
        radius_m: float,
        lang: str,
        include_audio: bool = False,
    ) -> list[dict]:
        return await self._request(
            "GET",
            "/internal/sites/nearby",
            params={
                "lat": lat,
                "lng": lng,
                "radius_m": radius_m,
                "lang": lang,
                "include_audio": include_audio,
            },
        )

    async def get_site_narration(self, site_code: str, lang: str) -> dict:
        return await self._request(
            "GET",
            f"/internal/sites/{site_code}/narration",
            params={"lang": lang},
        )

    async def sync_location(
        self,
        lat: float,
        lng: float,
        lang: str,
        radius_m: float,
    ) -> dict:
        return await self._request(
            "POST",
            "/internal/sites/sync-location",
            json={
                "lat": lat,
                "lng": lng,
                "lang": lang,
                "radius_m": radius_m,
            },
        )

    async def get_active_listeners(self) -> dict:
        return await self._request("GET", "/internal/listeners/active")

    async def heartbeat_listener(self, session_id: str, site_code: str) -> dict:
        return await self._request(
            "POST",
            "/internal/listeners/heartbeat",
            json={"session_id": session_id, "site_code": site_code},
        )

    async def leave_listener(self, session_id: str) -> dict:
        return await self._request(
            "POST",
            "/internal/listeners/leave",
            params={"session_id": session_id},
        )

    async def _request(self, method: str, path: str, **kwargs):
        try:
            response = await self.client.request(
                method,
                f"{self.base_url}{path}",
                **kwargs,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail="Site service timed out.",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=503,
                detail="Site service is unavailable.",
            ) from exc

        if response.is_error:
            try:
                detail = response.json().get("detail", "Site service returned an error.")
            except (ValueError, AttributeError):
                detail = "Site service returned an error."
            raise HTTPException(status_code=response.status_code, detail=detail)

        if response.status_code == 204:
            return None
        return response.json()

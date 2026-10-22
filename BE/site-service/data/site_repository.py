import math
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection


def distance_in_meters(
    first_lat: float,
    first_lng: float,
    second_lat: float,
    second_lng: float,
) -> float:
    radians = math.radians
    latitude_delta = radians(second_lat - first_lat)
    longitude_delta = radians(second_lng - first_lng)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(radians(first_lat))
        * math.cos(radians(second_lat))
        * math.sin(longitude_delta / 2) ** 2
    )
    haversine = min(1.0, max(0.0, haversine))
    return 6_371_000 * 2 * math.atan2(
        math.sqrt(haversine),
        math.sqrt(1 - haversine),
    )


class SiteRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def create(self, site_data: dict[str, Any]) -> dict[str, Any]:
        document = {**site_data}
        result = await self.collection.insert_one(document)
        document["_id"] = str(result.inserted_id)
        return {"id": document["_id"], **document}

    async def update(self, code: str, site_data: dict[str, Any]) -> dict[str, Any] | None:
        result = await self.collection.find_one_and_update(
            {"code": code},
            {"$set": site_data},
            return_document=True,
        )
        return self._serialize(result) if result else None

    async def delete(self, code: str) -> bool:
        result = await self.collection.delete_one({"code": code})
        return result.deleted_count > 0

    async def get_all(self, include_inactive: bool = False) -> list[dict[str, Any]]:
        query = {} if include_inactive else {"is_active": {"$ne": False}}
        cursor = self.collection.find(query).sort("name", 1).limit(200)
        return [self._serialize(document) async for document in cursor]

    async def get_by_code(
        self,
        code: str,
        include_inactive: bool = False,
    ) -> dict[str, Any] | None:
        query = {"code": code}
        if not include_inactive:
            query["is_active"] = {"$ne": False}
        document = await self.collection.find_one(query)
        return self._serialize(document) if document else None

    async def find_nearby(
        self,
        lng: float,
        lat: float,
        radius_m: float,
    ) -> list[dict[str, Any]]:
        cursor = self.collection.find({"is_active": {"$ne": False}}).limit(200)
        nearby: list[tuple[float, dict[str, Any]]] = []
        async for document in cursor:
            site_lat = document.get("lat")
            site_lng = document.get("lng")
            if not (
                isinstance(site_lat, (int, float))
                and isinstance(site_lng, (int, float))
                and -90 <= site_lat <= 90
                and -180 <= site_lng <= 180
            ):
                coordinates = (document.get("location") or {}).get(
                    "coordinates",
                    [],
                )
                if len(coordinates) != 2:
                    continue
                site_lng, site_lat = coordinates
                if not (
                    isinstance(site_lat, (int, float))
                    and isinstance(site_lng, (int, float))
                    and -90 <= site_lat <= 90
                    and -180 <= site_lng <= 180
                ):
                    continue

            distance = distance_in_meters(lat, lng, site_lat, site_lng)
            if distance <= radius_m:
                nearby.append((distance, self._serialize(document)))

        nearby.sort(key=lambda item: item[0])
        return [site for _, site in nearby]

    @staticmethod
    def _serialize(document: dict[str, Any]) -> dict[str, Any]:
        document["_id"] = str(document["_id"])
        return document

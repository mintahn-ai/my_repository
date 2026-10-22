from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection


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
        cursor = (
            self.collection.find(
                {
                    "is_active": {"$ne": False},
                    "location": {
                        "$near": {
                            "$geometry": {
                                "type": "Point",
                                "coordinates": [lng, lat],
                            },
                            "$maxDistance": radius_m,
                        }
                    }
                }
            )
            .limit(50)
        )
        return [self._serialize(document) async for document in cursor]

    @staticmethod
    def _serialize(document: dict[str, Any]) -> dict[str, Any]:
        document["_id"] = str(document["_id"])
        return document

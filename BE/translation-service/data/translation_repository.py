from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection


class TranslationRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def get(self, site_code: str, lang: str) -> dict[str, Any] | None:
        return await self.collection.find_one(
            {"site_code": site_code, "language": lang},
            {"_id": 0},
        )

    async def save(self, translation: dict[str, Any]) -> None:
        await self.collection.update_one(
            {
                "site_code": translation["site_code"],
                "language": translation["language"],
            },
            {"$set": translation},
            upsert=True,
        )

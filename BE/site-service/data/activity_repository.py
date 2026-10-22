from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection


class ActivityRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def record(self, action: str, site_code: str, site_name: str) -> None:
        await self.collection.insert_one(
            {
                "action": action,
                "site_code": site_code,
                "site_name": site_name,
                "created_at": datetime.now(timezone.utc),
            }
        )

    async def get_recent(self, limit: int = 10) -> list[dict[str, Any]]:
        cursor = (
            self.collection.find({})
            .sort("created_at", -1)
            .limit(limit)
        )
        records = []
        async for record in cursor:
            record["_id"] = str(record["_id"])
            created_at = record.get("created_at")
            if created_at:
                record["created_at"] = created_at.isoformat()
            records.append(record)
        return records

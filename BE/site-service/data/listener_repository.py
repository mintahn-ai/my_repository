from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorCollection


class ListenerRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def heartbeat(self, session_id: str, site_code: str) -> None:
        now = datetime.now(timezone.utc)
        await self.collection.update_one(
            {"session_id": session_id},
            {
                "$set": {"site_code": site_code, "last_seen": now},
                "$setOnInsert": {"session_id": session_id, "started_at": now},
            },
            upsert=True,
        )

    async def leave(self, session_id: str) -> None:
        await self.collection.delete_one({"session_id": session_id})

    async def get_active(self) -> dict:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=45)
        cursor = self.collection.aggregate(
            [
                {"$match": {"last_seen": {"$gte": cutoff}}},
                {"$group": {"_id": "$site_code", "count": {"$sum": 1}}},
                {"$sort": {"_id": 1}},
            ]
        )
        by_site = [
            {"site_code": item["_id"], "count": item["count"]}
            async for item in cursor
        ]
        return {
            "active_count": sum(item["count"] for item in by_site),
            "by_site": by_site,
            "updated_at": now.isoformat(),
        }

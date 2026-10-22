from motor.motor_asyncio import AsyncIOMotorCollection


DEFAULT_GEOFENCE_RADIUS_M = 50


class GeofenceSettingsRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def get_radius(self) -> int:
        settings = await self.collection.find_one({"_id": "global"})
        if settings is None:
            return DEFAULT_GEOFENCE_RADIUS_M
        return int(settings["radius_m"])

    async def set_radius(self, radius_m: int) -> int:
        await self.collection.update_one(
            {"_id": "global"},
            {"$set": {"radius_m": radius_m}},
            upsert=True,
        )
        return radius_m

import base64
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection


class AudioAssetRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def get(self, site_code: str, lang: str) -> dict[str, Any] | None:
        legacy_lang = "zh" if lang == "zh-CN" else lang
        asset = await self.collection.find_one(
            {
                "site_code": site_code,
                "lang": {"$in": [lang, legacy_lang]},
            },
            {"_id": 0, "content_type": 1, "data": 1},
        )
        if asset is None:
            return None

        data = asset.get("data")
        if isinstance(data, (bytes, bytearray, memoryview)):
            audio_data = bytes(data)
        elif isinstance(data, dict) and isinstance(data.get("$binary"), dict):
            try:
                audio_data = base64.b64decode(
                    data["$binary"]["base64"],
                    validate=True,
                )
            except (KeyError, ValueError) as exc:
                raise ValueError("Audio asset contains invalid binary data.") from exc
        else:
            raise ValueError("Audio asset does not contain binary data.")

        content_type = asset.get("content_type", "audio/mpeg")
        if not content_type.startswith("audio/") or not audio_data:
            raise ValueError("Audio asset has an invalid media type or empty content.")
        return {"content_type": content_type, "data": audio_data}

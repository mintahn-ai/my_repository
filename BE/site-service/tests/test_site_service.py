import asyncio
import unittest

from business.site_service import SiteService
from data.site_repository import SiteRepository


class FakeRepository:
    async def get_all(self):
        return []

    async def find_nearby(self, lng, lat, radius_m):
        return [
            {
                "code": "test-site",
                "name": "Test site",
                "description": "A sufficiently long description for testing.",
            }
        ]

    async def create(self, site_data):
        return site_data

    async def update(self, code, site_data):
        return {"code": code, **site_data}

    async def delete(self, code):
        return code == "test-site"

    async def get_by_code(self, code, include_inactive=False):
        if code != "test-site":
            return None
        return {
            "code": code,
            "name": "Test site",
        }


class FakeTranslationClient:
    def __init__(self):
        self.calls = 0

    async def get_audio(self, site_code, source_description, lang):
        self.calls += 1
        return {
            "site_code": site_code,
            "language": lang,
            "description": source_description,
            "audio_filename": f"{site_code}_{lang}.mp3",
        }

class FakeActivityRepository:
    def __init__(self):
        self.records = []

    async def record(self, action, site_code, site_name):
        self.records.append(
            {
                "action": action,
                "site_code": site_code,
                "site_name": site_name,
            }
        )

    async def get_recent(self):
        return self.records


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    def sort(self, field, direction):
        return self

    def __aiter__(self):
        self._iterator = iter(self.documents)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self, documents):
        self.documents = documents
        self.query = None

    def find(self, query):
        self.query = query
        return FakeCursor(self.documents)


class SiteServiceTests(unittest.TestCase):
    def test_create_and_update_sites_store_geojson_coordinates(self):
        activity_repository = FakeActivityRepository()
        service = SiteService(
            FakeRepository(),
            FakeTranslationClient(),
            activity_repository,
        )
        site = {
            "code": "test-site",
            "name": "Test site",
            "lat": 10.77,
            "lng": 106.70,
        }

        created = asyncio.run(service.create_site(dict(site)))
        updated = asyncio.run(service.update_site("test-site", dict(site)))

        expected_location = {
            "type": "Point",
            "coordinates": [106.70, 10.77],
        }
        self.assertEqual(created["location"], expected_location)
        self.assertEqual(updated["location"], expected_location)
        self.assertEqual(
            [event["action"] for event in activity_repository.records],
            ["created", "updated"],
        )

    def test_delete_site_delegates_to_repository(self):
        activity_repository = FakeActivityRepository()
        service = SiteService(
            FakeRepository(),
            FakeTranslationClient(),
            activity_repository,
        )

        self.assertTrue(asyncio.run(service.delete_site("test-site")))
        self.assertFalse(asyncio.run(service.delete_site("missing-site")))
        self.assertEqual(
            [event["action"] for event in activity_repository.records],
            ["deleted"],
        )

    def test_nearby_sites_are_decorated_with_translation_and_gateway_audio_path(self):
        service = SiteService(
            FakeRepository(),
            FakeTranslationClient(),
            FakeActivityRepository(),
        )
        result = asyncio.run(
            service.get_nearby_sites(10.77, 106.70, 500, "en", include_audio=True)
        )

        self.assertEqual(result[0]["translation"]["language"], "en")
        self.assertEqual(
            result[0]["audio_url"],
            "/api/audio/files/test-site_en.mp3",
        )

    def test_nearby_query_uses_longitude_first_and_meter_radius(self):
        collection = FakeCollection(
            [
                {
                    "_id": "mongo-id",
                    "code": "test-site",
                }
            ]
        )
        repository = SiteRepository(collection)

        result = asyncio.run(repository.find_nearby(106.70, 10.77, 500))

        query = collection.query
        self.assertEqual(
            query["location"]["$near"]["$geometry"]["coordinates"],
            [106.70, 10.77],
        )
        self.assertEqual(query["location"]["$near"]["$maxDistance"], 500)
        self.assertEqual(result[0]["_id"], "mongo-id")

    def test_sync_location_returns_a_trigger_only_inside_geofence(self):
        service = SiteService(
            FakeRepository(),
            FakeTranslationClient(),
            FakeActivityRepository(),
        )
        result = asyncio.run(service.sync_location(10.77, 106.70, "vi", 30))

        self.assertTrue(result["in_zone"])
        self.assertTrue(result["audio"]["trigger_audio"])
        self.assertEqual(result["site"]["code"], "test-site")

    def test_public_catalog_can_be_loaded_without_generating_audio(self):
        class Repository(FakeRepository):
            async def get_all(self):
                return [{"code": "test-site"}]

        translation_client = FakeTranslationClient()
        service = SiteService(
            Repository(),
            translation_client,
            FakeActivityRepository(),
        )
        result = asyncio.run(service.get_sites("vi"))

        self.assertEqual(result, [{"code": "test-site"}])
        self.assertEqual(translation_client.calls, 0)


if __name__ == "__main__":
    unittest.main()

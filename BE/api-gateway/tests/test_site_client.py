import asyncio
import json
import unittest

import httpx

from data.clients.site_client import SiteClient


class SiteClientTests(unittest.TestCase):
    def test_site_crud_requests_are_forwarded_to_site_service(self):
        requests = []
        site = {
            "name": "Di tích kiểm thử",
            "code": "di-tich-kiem-thu",
            "lat": 10.77,
            "lng": 106.69,
            "address": "Quận 1",
            "category": "Di tích lịch sử",
            "description": "Nội dung thuyết minh kiểm thử dài hơn mười ký tự.",
            "is_active": True,
        }

        def handler(request):
            requests.append(request)
            if request.url.path.endswith("/admin"):
                return httpx.Response(200, json=[site])
            if request.url.path.endswith("/activity"):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "action": "created",
                            "site_code": site["code"],
                            "site_name": site["name"],
                            "created_at": "2026-10-22T12:00:00+00:00",
                        }
                    ],
                )
            if request.method == "DELETE":
                return httpx.Response(204)
            return httpx.Response(200, json=site)

        async def run_test():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as client:
                site_client = SiteClient(client, "http://site-service:8000")
                admin_sites = await site_client.get_admin_sites()
                activities = await site_client.get_recent_activity()
                created = await site_client.create_site(site)
                updated = await site_client.update_site(
                    "di-tich-kiem-thu",
                    {**site, "name": "Tên đã sửa"},
                )
                deleted = await site_client.delete_site("di-tich-kiem-thu")
                return admin_sites, activities, created, updated, deleted

        admin_sites, activities, created, updated, deleted = asyncio.run(run_test())

        self.assertEqual(admin_sites, [site])
        self.assertEqual(activities[0]["action"], "created")
        self.assertEqual(created, site)
        self.assertEqual(updated, site)
        self.assertIsNone(deleted)
        self.assertEqual(
            [(request.method, request.url.path) for request in requests],
            [
                ("GET", "/internal/sites/admin"),
                ("GET", "/internal/sites/activity"),
                ("POST", "/internal/sites/"),
                ("PUT", "/internal/sites/di-tich-kiem-thu"),
                ("DELETE", "/internal/sites/di-tich-kiem-thu"),
            ],
        )
        update_request = next(request for request in requests if request.method == "PUT")
        self.assertEqual(json.loads(update_request.read())["name"], "Tên đã sửa")

    def test_listener_requests_are_forwarded_to_site_service(self):
        requests = []

        def handler(request):
            requests.append(request)
            if request.url.path.endswith("/active"):
                return httpx.Response(
                    200,
                    json={"active_count": 2, "by_site": [{"site_code": "test-site", "count": 2}]},
                )
            if request.url.path.endswith("/heartbeat"):
                return httpx.Response(200, json={"active": True})
            return httpx.Response(200, json={"active": False})

        async def run_test():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as client:
                site_client = SiteClient(client, "http://site-service:8000")
                stats = await site_client.get_active_listeners()
                heartbeat = await site_client.heartbeat_listener(
                    "12f8d20d-1d69-4f92-9c74-0a29dcb83423",
                    "test-site",
                )
                leave = await site_client.leave_listener(
                    "12f8d20d-1d69-4f92-9c74-0a29dcb83423"
                )
                return stats, heartbeat, leave

        stats, heartbeat, leave = asyncio.run(run_test())

        self.assertEqual(stats["active_count"], 2)
        self.assertTrue(heartbeat["active"])
        self.assertFalse(leave["active"])
        self.assertEqual(
            [request.url.path for request in requests],
            [
                "/internal/listeners/active",
                "/internal/listeners/heartbeat",
                "/internal/listeners/leave",
            ],
        )
        self.assertEqual(
            json.loads(requests[1].read()),
            {
                "session_id": "12f8d20d-1d69-4f92-9c74-0a29dcb83423",
                "site_code": "test-site",
            },
        )
        self.assertEqual(
            requests[2].url.params["session_id"],
            "12f8d20d-1d69-4f92-9c74-0a29dcb83423",
        )

    def test_nearby_request_is_forwarded_to_site_service(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json=[{"code": "test-site"}])

        async def run_test():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as client:
                site_client = SiteClient(client, "http://site-service:8000/")
                return await site_client.get_nearby_sites(
                    10.77,
                    106.70,
                    500,
                    "vi",
                )

        result = asyncio.run(run_test())

        self.assertEqual(result, [{"code": "test-site"}])
        self.assertEqual(
            requests[0].url.path,
            "/internal/sites/nearby",
        )
        self.assertEqual(requests[0].url.params["radius_m"], "500")

    def test_geofence_settings_requests_are_forwarded_to_site_service(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"radius_m": 75})

        async def run_test():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as client:
                site_client = SiteClient(client, "http://site-service:8000")
                current = await site_client.get_geofence_settings()
                updated = await site_client.update_geofence_settings(75)
                return current, updated

        current, updated = asyncio.run(run_test())

        self.assertEqual(current, {"radius_m": 75})
        self.assertEqual(updated, {"radius_m": 75})
        self.assertEqual(
            [(request.method, request.url.path) for request in requests],
            [
                ("GET", "/internal/sites/geofence-settings"),
                ("PUT", "/internal/sites/geofence-settings"),
            ],
        )
        self.assertEqual(json.loads(requests[1].read()), {"radius_m": 75})

    def test_geofence_request_is_forwarded_to_site_service(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"in_zone": False, "trigger": False})

        async def run_test():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as client:
                site_client = SiteClient(client, "http://site-service:8000")
                return await site_client.sync_location(10.77, 106.70, "vi", 30)

        result = asyncio.run(run_test())

        self.assertFalse(result["in_zone"])
        self.assertEqual(requests[0].url.path, "/internal/sites/sync-location")
        self.assertEqual(
            json.loads(requests[0].read()),
            {"lat": 10.77, "lng": 106.7, "lang": "vi", "radius_m": 30},
        )


if __name__ == "__main__":
    unittest.main()

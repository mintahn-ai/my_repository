import asyncio
import unittest
from types import SimpleNamespace

import httpx
from fastapi import FastAPI

from presentation.admin_auth import create_admin_token
from presentation.auth_router import router as auth_router
from presentation.gateway_router import router


class GatewayAccessTests(unittest.TestCase):
    def test_public_listener_mode_hides_admin_routes(self):
        app = FastAPI()
        app.state.public_listener_only = True
        app.state.admin_auth_enabled = False
        app.state.admin_auth_required = False
        app.state.gateway_service = SimpleNamespace()
        app.include_router(router)
        requests = [
            ("GET", "/api/sites/admin", None),
            ("GET", "/api/sites/activity", None),
            ("POST", "/api/sites/", {
                "name": "Di tích kiểm thử",
                "code": "di-tich-kiem-thu",
                "lat": 10.77,
                "lng": 106.69,
                "address": "Quận 1",
                "description": "Nội dung thuyết minh kiểm thử dài hơn mười ký tự.",
            }),
            ("PUT", "/api/sites/di-tich-kiem-thu", {
                "name": "Di tích kiểm thử",
                "lat": 10.77,
                "lng": 106.69,
                "address": "Quận 1",
                "description": "Nội dung thuyết minh kiểm thử dài hơn mười ký tự.",
            }),
            ("DELETE", "/api/sites/di-tich-kiem-thu", None),
            ("GET", "/api/sites/listeners/active", None),
        ]

        async def send_requests():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return [
                    await client.request(method, path, json=body)
                    for method, path, body in requests
                ]

        responses = asyncio.run(send_requests())

        self.assertEqual([response.status_code for response in responses], [404] * 6)

    def test_local_mode_keeps_admin_routes_available(self):
        app = FastAPI()
        app.state.public_listener_only = False
        app.state.admin_auth_enabled = False
        app.state.admin_auth_required = False
        app.state.gateway_service = SimpleNamespace(
            get_admin_sites=lambda: asyncio.sleep(0, result=[{"code": "test-site"}])
        )
        app.include_router(router)

        async def send_request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.get("/api/sites/admin")

        response = asyncio.run(send_request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{"code": "test-site"}])

    def test_admin_routes_require_a_valid_bearer_token_when_auth_is_enabled(self):
        app = FastAPI()
        app.state.public_listener_only = False
        app.state.admin_auth_enabled = True
        app.state.admin_auth_required = True
        app.state.admin_username = "owner"
        app.state.admin_password = "private-password"
        app.state.admin_token_secret = "s" * 40
        app.state.gateway_service = SimpleNamespace(
            get_admin_sites=lambda: asyncio.sleep(0, result=[{"code": "test-site"}])
        )
        app.include_router(router)
        app.include_router(auth_router)
        token, _ = create_admin_token("owner", app.state.admin_token_secret)

        async def send_requests():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                anonymous = await client.get("/api/sites/admin")
                invalid = await client.get(
                    "/api/sites/admin",
                    headers={"Authorization": "Bearer invalid-token"},
                )
                authenticated = await client.get(
                    "/api/sites/admin",
                    headers={"Authorization": f"Bearer {token}"},
                )
                login = await client.post(
                    "/api/auth/login",
                    json={
                        "username": "owner",
                        "password": "private-password",
                    },
                )
                bad_login = await client.post(
                    "/api/auth/login",
                    json={"username": "owner", "password": "wrong"},
                )
                for _ in range(9):
                    await client.post(
                        "/api/auth/login",
                        json={"username": "owner", "password": "wrong"},
                    )
                locked_login = await client.post(
                    "/api/auth/login",
                    json={
                        "username": "owner",
                        "password": "private-password",
                    },
                )
                return anonymous, invalid, authenticated, login, bad_login, locked_login

        (
            anonymous,
            invalid,
            authenticated,
            login,
            bad_login,
            locked_login,
        ) = asyncio.run(send_requests())

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(authenticated.status_code, 200)
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["token_type"], "bearer")
        self.assertEqual(login.headers["cache-control"], "no-store")
        self.assertEqual(bad_login.status_code, 401)
        self.assertEqual(locked_login.status_code, 429)
        self.assertIn("retry-after", locked_login.headers)


if __name__ == "__main__":
    unittest.main()

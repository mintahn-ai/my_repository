import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from presentation.admin_auth import create_admin_token

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LOGIN_FAILURE_LIMIT = 10
LOGIN_FAILURE_WINDOW_SECONDS = 900
MAX_TRACKED_LOGIN_NAMES = 1024


class AdminCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024)


@router.post("/login")
async def login(
    credentials: AdminCredentials,
    request: Request,
    response: Response,
):
    if not request.app.state.admin_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found.",
        )
    failures = getattr(request.app.state, "login_failures", None)
    if failures is None:
        failures = {}
        request.app.state.login_failures = failures
    now = time.monotonic()
    username_key = credentials.username.casefold()
    started_at, attempts = failures.get(username_key, (now, 0))
    if now - started_at >= LOGIN_FAILURE_WINDOW_SECONDS:
        started_at, attempts = now, 0
    if attempts >= LOGIN_FAILURE_LIMIT:
        retry_after = max(
            1,
            int(LOGIN_FAILURE_WINDOW_SECONDS - (now - started_at)),
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Quá nhiều lần đăng nhập thất bại. Hãy thử lại sau.",
            headers={"Retry-After": str(retry_after)},
        )
    if not (
        secrets.compare_digest(credentials.username, request.app.state.admin_username)
        and secrets.compare_digest(credentials.password, request.app.state.admin_password)
    ):
        failures[username_key] = (started_at, attempts + 1)
        if len(failures) > MAX_TRACKED_LOGIN_NAMES:
            oldest_name = min(failures, key=lambda name: failures[name][0])
            del failures[oldest_name]
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng.",
        )

    failures.pop(username_key, None)
    token, expires_in = create_admin_token(
        request.app.state.admin_username,
        request.app.state.admin_token_secret,
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "username": request.app.state.admin_username,
    }

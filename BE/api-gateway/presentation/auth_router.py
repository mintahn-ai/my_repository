import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from presentation.admin_auth import (
    create_admin_token,
    get_admin_credentials,
    hash_admin_password,
    require_admin_api,
    verify_admin_password,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LOGIN_FAILURE_LIMIT = 10
LOGIN_FAILURE_WINDOW_SECONDS = 900
MAX_TRACKED_LOGIN_NAMES = 1024


class AdminCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024)


class AdminCredentialUpdate(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    username: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=1024)


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
    admin_credentials = await get_admin_credentials(request)
    password_matches = (
        verify_admin_password(
            credentials.password,
            admin_credentials["password_hash"],
        )
        if "password_hash" in admin_credentials
        else secrets.compare_digest(
            credentials.password,
            admin_credentials["password"],
        )
    )
    if not (
        secrets.compare_digest(credentials.username, admin_credentials["username"])
        and password_matches
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
        admin_credentials["username"],
        request.app.state.admin_token_secret,
        admin_credentials.get("token_version", 0),
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "username": admin_credentials["username"],
    }


@router.put("/credentials")
async def update_admin_credentials(
    credentials: AdminCredentialUpdate,
    request: Request,
    response: Response,
    _: None = Depends(require_admin_api),
):
    current = await get_admin_credentials(request)
    password_matches = (
        verify_admin_password(
            credentials.current_password,
            current["password_hash"],
        )
        if "password_hash" in current
        else secrets.compare_digest(
            credentials.current_password,
            current["password"],
        )
    )
    username = credentials.username.strip()
    if not password_matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu hiện tại không chính xác.",
        )
    if len(username) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên đăng nhập cần có ít nhất 3 ký tự.",
        )
    if credentials.new_password == credentials.current_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mật khẩu mới phải khác mật khẩu hiện tại.",
        )

    new_version = current.get("token_version", 0) + 1
    collection = getattr(request.app.state, "admin_credentials_collection", None)
    if collection is not None:
        await collection.update_one(
            {"_id": "admin"},
            {
                "$set": {
                    "username": username,
                    "password_hash": hash_admin_password(credentials.new_password),
                    "token_version": new_version,
                },
            },
        )
    else:
        request.app.state.admin_username = username
        request.app.state.admin_password = credentials.new_password
        request.app.state.admin_token_version = new_version

    token, expires_in = create_admin_token(
        username,
        request.app.state.admin_token_secret,
        new_version,
    )
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return {
        "username": username,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
    }

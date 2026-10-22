import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException, Request, status
from jwt import InvalidTokenError

TOKEN_LIFETIME = timedelta(hours=8)


def configure_admin_auth(app) -> None:
    configured = {
        "username": os.getenv("ADMIN_USERNAME"),
        "password": os.getenv("ADMIN_PASSWORD"),
        "secret": os.getenv("ADMIN_TOKEN_SECRET"),
    }
    auth_required = os.getenv("ADMIN_AUTH_REQUIRED")
    if auth_required is None:
        auth_required = os.getenv("RENDER", "").lower() == "true"
    elif auth_required.lower() not in {"true", "false"}:
        raise RuntimeError("ADMIN_AUTH_REQUIRED must be 'true' or 'false'.")
    else:
        auth_required = auth_required.lower() == "true"

    supplied_values = [value is not None for value in configured.values()]
    if any(supplied_values) and not all(supplied_values):
        raise RuntimeError(
            "Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_TOKEN_SECRET together."
        )
    auth_enabled = auth_required or all(supplied_values)
    if auth_required and not all(supplied_values):
        raise RuntimeError(
            "Admin authentication is required; set ADMIN_USERNAME, "
            "ADMIN_PASSWORD, and ADMIN_TOKEN_SECRET."
        )
    if auth_enabled and len(configured["secret"].encode("utf-8")) < 32:
        raise RuntimeError("ADMIN_TOKEN_SECRET must contain at least 32 bytes.")
    if auth_enabled and not configured["username"].strip():
        raise RuntimeError("ADMIN_USERNAME cannot be empty.")
    if auth_enabled and len(configured["password"]) < 12:
        raise RuntimeError("ADMIN_PASSWORD must contain at least 12 characters.")

    public_listener_only = os.getenv("PUBLIC_LISTENER_ONLY", "false").lower()
    if public_listener_only not in {"true", "false"}:
        raise RuntimeError("PUBLIC_LISTENER_ONLY must be 'true' or 'false'.")

    app.state.admin_auth_enabled = auth_enabled
    app.state.admin_auth_required = auth_required
    app.state.admin_username = configured["username"]
    app.state.admin_password = configured["password"]
    app.state.admin_token_secret = configured["secret"]
    app.state.public_listener_only = public_listener_only == "true"


def create_admin_token(username: str, secret: str) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    expires_at = now + TOKEN_LIFETIME
    token = jwt.encode(
        {"sub": username, "iat": now, "exp": expires_at},
        secret,
        algorithm="HS256",
    )
    return token, int(TOKEN_LIFETIME.total_seconds())


async def require_admin_api(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    if request.app.state.public_listener_only:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if not request.app.state.admin_auth_enabled:
        if request.app.state.admin_auth_required:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Admin authentication is not configured.",
            )
        return

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(
            token,
            request.app.state.admin_token_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "iat", "sub"]},
        )
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin session is invalid or expired.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if not secrets.compare_digest(
        str(payload.get("sub", "")),
        request.app.state.admin_username,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin session is invalid or expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

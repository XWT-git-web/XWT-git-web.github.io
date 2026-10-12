"""Zhijian API. Run behind an HTTPS reverse proxy; bind Uvicorn to 127.0.0.1."""
from __future__ import annotations

import base64
from contextlib import contextmanager
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

SESSION_SECONDS = 30 * 24 * 3600
EMAIL = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$")
PHONE = re.compile(r"^\+?[1-9]\d{6,14}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_SETTINGS = {"startTime": "09:00", "restDay": 0, "sound": True}


class Credentials(BaseModel):
    identifier: str = Field(min_length=7, max_length=254)
    password: str = Field(min_length=10, max_length=128)


class PasswordChange(BaseModel):
    currentPassword: str = Field(min_length=10, max_length=128)
    newPassword: str = Field(min_length=10, max_length=128)


class PasswordConfirm(BaseModel):
    password: str = Field(min_length=10, max_length=128)


class StudyEvent(BaseModel):
    id: str = Field(min_length=36, max_length=36)
    day: str = Field(min_length=10, max_length=10)


class SettingsUpdate(BaseModel):
    version: int = Field(ge=0)
    startTime: str = Field(min_length=5, max_length=5)
    restDay: int = Field(ge=0, le=6)
    sound: bool


class TimerUpdate(BaseModel):
    version: int = Field(ge=0)
    phase: Literal["focus", "break", "done"]
    status: Literal["idle", "running", "paused"]
    remaining: int = Field(ge=0, le=3000)
    endAt: Optional[int] = None
    day: str = Field(min_length=10, max_length=10)
    sessionId: Optional[str] = Field(default=None, max_length=36)


class SyncRequest(BaseModel):
    events: list[StudyEvent] = Field(default_factory=list, max_length=100)
    settings: Optional[SettingsUpdate] = None
    timer: Optional[TimerUpdate] = None


def normalize_identifier(raw: str) -> str:
    value = raw.strip().lower()
    if EMAIL.fullmatch(value) or PHONE.fullmatch(value):
        return value
    raise HTTPException(422, "请输入有效的邮箱或手机号")


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000, dklen=32)
    return f"pbkdf2_sha256:600000:{salt.hex()}:{digest.hex()}"


def check_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected_hex = encoded.split(":")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations), dklen=32)
        return hmac.compare_digest(digest, bytes.fromhex(expected_hex))
    except (ValueError, TypeError):
        return False


def valid_day(value: str) -> bool:
    if not DAY.fullmatch(value):
        return False
    try:
        from datetime import date
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


@contextmanager
def db_connection(path: Path):
    connection = sqlite3.connect(path, timeout=10)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with db_connection(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            identifier TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS study_events (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            day TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE INDEX IF NOT EXISTS events_day ON study_events(user_id, day);
        CREATE TABLE IF NOT EXISTS user_state (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            start_time TEXT NOT NULL DEFAULT '09:00',
            rest_day INTEGER NOT NULL DEFAULT 0,
            sound INTEGER NOT NULL DEFAULT 1,
            settings_version INTEGER NOT NULL DEFAULT 0,
            timer_phase TEXT NOT NULL DEFAULT 'focus',
            timer_status TEXT NOT NULL DEFAULT 'idle',
            timer_remaining INTEGER NOT NULL DEFAULT 3000,
            timer_end_at INTEGER,
            timer_day TEXT,
            timer_session_id TEXT,
            timer_version INTEGER NOT NULL DEFAULT 0
        );
        """)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(user_state)")}
        if "timer_session_id" not in columns:
            db.execute("ALTER TABLE user_state ADD COLUMN timer_session_id TEXT")


def create_app(db_path: str | Path | None = None) -> FastAPI:
    path = Path(db_path or os.environ.get("ZHIJIAN_DB_PATH", Path(__file__).resolve().parent / "data" / "zhijian.sqlite3"))
    init_db(path)
    app = FastAPI(title="知间 API", docs_url=None, redoc_url=None, openapi_url=None)
    origins = [x.strip() for x in os.environ.get("ZHIJIAN_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost,https://localhost,capacitor://localhost,zhijian://app").split(",") if x.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"])
    attempts: dict[str, list[float]] = {}
    attempt_lock = threading.Lock()

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def rate_limit(request: Request, identifier: str, action: str) -> None:
        key = f"{request.client.host if request.client else '?'}:{action}:{identifier}"
        now = time.monotonic()
        with attempt_lock:
            recent = [when for when in attempts.get(key, []) if now - when < 300]
            if len(recent) >= (6 if action == "login" else 12):
                raise HTTPException(429, "尝试过于频繁，请稍后再试")
            recent.append(now)
            attempts[key] = recent
            if len(attempts) > 10000:
                attempts.clear()

    def issue_session(db: sqlite3.Connection, user_id: str) -> str:
        token = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS))
        return token

    def current_user(authorization: Optional[str] = Header(default=None)) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "请先登录")
        token = authorization[7:]
        if len(token) > 100:
            raise HTTPException(401, "登录已失效")
        with db_connection(path) as db:
            row = db.execute("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?", (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, "登录已失效")
        return row["user_id"]

    def response_state(db: sqlite3.Connection, user_id: str, acknowledged: list[str] | None = None, conflicts: list[str] | None = None):
        row = db.execute("SELECT * FROM user_state WHERE user_id=?", (user_id,)).fetchone()
        records = {r["day"]: r["count"] for r in db.execute("SELECT day, COUNT(*) AS count FROM study_events WHERE user_id=? GROUP BY day", (user_id,))}
        return {
            "records": records,
            "settings": {"startTime": row["start_time"], "restDay": row["rest_day"], "sound": bool(row["sound"]), "version": row["settings_version"]},
            "timer": {"phase": row["timer_phase"], "status": row["timer_status"], "remaining": row["timer_remaining"], "endAt": row["timer_end_at"], "day": row["timer_day"], "sessionId": row["timer_session_id"], "version": row["timer_version"]},
            "acknowledged": acknowledged or [],
            "conflicts": conflicts or [],
        }

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.post("/api/register", status_code=201)
    def register(payload: Credentials, request: Request):
        identifier = normalize_identifier(payload.identifier)
        rate_limit(request, identifier, "register")
        user_id = str(uuid.uuid4())
        try:
            with db_connection(path) as db:
                db.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (user_id, identifier, password_hash(payload.password), int(time.time())))
                db.execute("INSERT INTO user_state(user_id) VALUES (?)", (user_id,))
                token = issue_session(db, user_id)
        except sqlite3.IntegrityError:
            raise HTTPException(409, "该邮箱或手机号已注册")
        return {"token": token, "user": {"id": user_id, "identifier": identifier}}

    @app.post("/api/login")
    def login(payload: Credentials, request: Request):
        identifier = normalize_identifier(payload.identifier)
        rate_limit(request, identifier, "login")
        with db_connection(path) as db:
            row = db.execute("SELECT id, password_hash FROM users WHERE identifier=?", (identifier,)).fetchone()
            if not row or not check_password(payload.password, row["password_hash"]):
                raise HTTPException(401, "账号或密码错误")
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
            token = issue_session(db, row["id"])
        return {"token": token, "user": {"id": row["id"], "identifier": identifier}}

    @app.post("/api/password")
    def change_password(payload: PasswordChange, authorization: Optional[str] = Header(default=None), user_id: str = Depends(current_user)):
        with db_connection(path) as db:
            row = db.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            if not check_password(payload.currentPassword, row["password_hash"]):
                raise HTTPException(401, "当前密码错误")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(payload.newPassword), user_id))
            token_hash = hashlib.sha256(authorization[7:].encode()).hexdigest()
            db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user_id, token_hash))
        return {"ok": True}

    @app.delete("/api/account")
    def delete_account(payload: PasswordConfirm, user_id: str = Depends(current_user)):
        with db_connection(path) as db:
            row = db.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            if not check_password(payload.password, row["password_hash"]):
                raise HTTPException(401, "密码错误")
            db.execute("DELETE FROM users WHERE id=?", (user_id,))
        return {"ok": True}

    @app.post("/api/logout")
    def logout(authorization: Optional[str] = Header(default=None), user_id: str = Depends(current_user)):
        token = authorization[7:]
        with db_connection(path) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=? AND user_id=?", (hashlib.sha256(token.encode()).hexdigest(), user_id))
        return {"ok": True}

    @app.get("/api/me")
    def me(user_id: str = Depends(current_user)):
        with db_connection(path) as db:
            row = db.execute("SELECT identifier FROM users WHERE id=?", (user_id,)).fetchone()
        return {"id": user_id, "identifier": row["identifier"]}

    @app.get("/api/state")
    def state(user_id: str = Depends(current_user)):
        with db_connection(path) as db:
            return response_state(db, user_id)

    @app.post("/api/sync")
    def sync(payload: SyncRequest, user_id: str = Depends(current_user)):
        acknowledged: list[str] = []
        conflicts: list[str] = []
        for event in payload.events:
            if not valid_day(event.day):
                raise HTTPException(422, "无效的打卡日期")
            try:
                uuid.UUID(event.id)
            except ValueError:
                raise HTTPException(422, "无效的打卡编号")
        if payload.settings and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", payload.settings.startTime):
            raise HTTPException(422, "无效的提醒时间")
        if payload.timer:
            timer = payload.timer
            if not valid_day(timer.day):
                raise HTTPException(422, "无效的计时日期")
            if timer.sessionId:
                try:
                    uuid.UUID(timer.sessionId)
                except ValueError:
                    raise HTTPException(422, "无效的计时编号")
            if timer.status == "running" and (timer.endAt is None or abs(timer.endAt - int(time.time() * 1000)) > 24 * 3600 * 1000):
                raise HTTPException(422, "无效的计时结束时间")
        with db_connection(path) as db:
            db.execute("BEGIN IMMEDIATE")
            for event in payload.events:
                exists = db.execute("SELECT 1 FROM study_events WHERE user_id=? AND id=?", (user_id, event.id)).fetchone()
                if not exists:
                    count = db.execute("SELECT COUNT(*) FROM study_events WHERE user_id=? AND day=?", (user_id, event.day)).fetchone()[0]
                    if count < 8:
                        db.execute("INSERT INTO study_events VALUES (?, ?, ?, ?)", (user_id, event.id, event.day, int(time.time() * 1000)))
                acknowledged.append(event.id)
            row = db.execute("SELECT settings_version, timer_version FROM user_state WHERE user_id=?", (user_id,)).fetchone()
            if payload.settings:
                s = payload.settings
                if s.version == row["settings_version"]:
                    db.execute("UPDATE user_state SET start_time=?, rest_day=?, sound=?, settings_version=settings_version+1 WHERE user_id=?", (s.startTime, s.restDay, int(s.sound), user_id))
                else:
                    conflicts.append("settings")
            if payload.timer:
                t = payload.timer
                if t.version == row["timer_version"]:
                    db.execute("UPDATE user_state SET timer_phase=?, timer_status=?, timer_remaining=?, timer_end_at=?, timer_day=?, timer_session_id=?, timer_version=timer_version+1 WHERE user_id=?", (t.phase, t.status, t.remaining, t.endAt, t.day, t.sessionId, user_id))
                else:
                    conflicts.append("timer")
            result = response_state(db, user_id, acknowledged, conflicts)
        return result

    return app


app = create_app()

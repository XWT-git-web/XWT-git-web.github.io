import uuid
from datetime import date

from fastapi.testclient import TestClient

from app import create_app


def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.sqlite3"))


def signup(http, identifier="reader@example.com"):
    result = http.post("/api/register", json={"identifier": identifier, "password": "a-long-password-123"})
    assert result.status_code == 201, result.text
    return {"Authorization": f"Bearer {result.json()['token']}"}


def test_registration_login_logout_and_isolation(tmp_path):
    http = client(tmp_path)
    alice = signup(http)
    assert http.post("/api/register", json={"identifier": "reader@example.com", "password": "a-long-password-123"}).status_code == 409
    assert http.post("/api/login", json={"identifier": "reader@example.com", "password": "incorrect-pass"}).status_code == 401
    bob = signup(http, "second@example.com")
    day = date.today().isoformat()
    event_id = str(uuid.uuid4())
    response = http.post("/api/sync", headers=alice, json={"events": [{"id": event_id, "day": day}]})
    assert response.status_code == 200
    assert response.json()["records"][day] == 1
    assert http.get("/api/state", headers=bob).json()["records"] == {}
    assert http.post("/api/logout", headers=alice).status_code == 200
    assert http.get("/api/state", headers=alice).status_code == 401
    login = http.post("/api/login", json={"identifier": "reader@example.com", "password": "a-long-password-123"})
    assert login.status_code == 200
    assert http.get("/api/state", headers={"Authorization": f"Bearer {login.json()['token']}"}).json()["records"][day] == 1


def test_idempotent_events_daily_cap_and_conflicts(tmp_path):
    http = client(tmp_path)
    headers = signup(http)
    day = date.today().isoformat()
    event = {"id": str(uuid.uuid4()), "day": day}
    first = http.post("/api/sync", headers=headers, json={"events": [event]}).json()
    assert first["acknowledged"] == [event["id"]]
    assert http.post("/api/sync", headers=headers, json={"events": [event]}).json()["records"][day] == 1
    more = [{"id": str(uuid.uuid4()), "day": day} for _ in range(10)]
    capped = http.post("/api/sync", headers=headers, json={"events": more}).json()
    assert capped["records"][day] == 8
    settings = {"version": 0, "startTime": "08:30", "restDay": 6, "sound": False}
    accepted = http.post("/api/sync", headers=headers, json={"settings": settings}).json()
    assert accepted["settings"]["version"] == 1
    assert accepted["settings"]["startTime"] == "08:30"
    stale = http.post("/api/sync", headers=headers, json={"settings": settings}).json()
    assert stale["conflicts"] == ["settings"]
    assert stale["settings"]["startTime"] == "08:30"


def test_invalid_payloads_do_not_write(tmp_path):
    http = client(tmp_path)
    headers = signup(http)
    bad = http.post("/api/sync", headers=headers, json={"events": [{"id": str(uuid.uuid4()), "day": "2026-02-30"}]})
    assert bad.status_code == 422
    assert http.get("/api/state", headers=headers).json()["records"] == {}
    assert http.post("/api/register", json={"identifier": "bad", "password": "a-long-password-123"}).status_code == 422


def test_password_change_and_account_deletion(tmp_path):
    http = client(tmp_path)
    headers = signup(http)
    assert http.post("/api/password", headers=headers, json={"currentPassword": "wrong-password", "newPassword": "new-password-123"}).status_code == 401
    changed = http.post("/api/password", headers=headers, json={"currentPassword": "a-long-password-123", "newPassword": "new-password-123"})
    assert changed.status_code == 200
    assert http.post("/api/login", json={"identifier": "reader@example.com", "password": "a-long-password-123"}).status_code == 401
    assert http.post("/api/login", json={"identifier": "reader@example.com", "password": "new-password-123"}).status_code == 200
    assert http.request("DELETE", "/api/account", headers=headers, json={"password": "wrong-password"}).status_code == 401
    assert http.request("DELETE", "/api/account", headers=headers, json={"password": "new-password-123"}).status_code == 200
    assert http.get("/api/state", headers=headers).status_code == 401

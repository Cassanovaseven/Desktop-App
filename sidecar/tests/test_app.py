import pytest
from fastapi.testclient import TestClient

from alfonso_sidecar.app import create_app
from alfonso_sidecar.__main__ import main


def test_health_dengan_token():
    c = TestClient(create_app("t0k3n"))
    r = c.get("/health", headers={"X-Alfonso-Token": "t0k3n"})
    assert r.status_code == 200 and r.json() == {"status": "ok", "version": "0.1.0"}


def test_tanpa_token_401():
    assert TestClient(create_app("t0k3n")).get("/health").status_code == 401


def test_token_salah_401():
    assert TestClient(create_app("t0k3n")).get("/health", headers={"X-Alfonso-Token": "salah"}).status_code == 401


def test_token_non_ascii_401_bukan_500():
    assert TestClient(create_app("t0k3n")).get("/health", headers={"X-Alfonso-Token": "tökén".encode("utf-8")}).status_code == 401


def test_main_tanpa_env_keluar_kode_2(monkeypatch):
    monkeypatch.delenv("ALFONSO_SIDECAR_TOKEN", raising=False)
    with pytest.raises(SystemExit) as e:
        main()
    assert e.value.code == 2

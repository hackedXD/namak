"""LocalRawStore: content-addressed keys and immutability (§1.1 principle 2)."""

from __future__ import annotations

import pytest

from ingest.core.rawstore import ImmutabilityError, LocalRawStore, raw_key


def test_raw_key_layout():
    assert (
        raw_key("nppa_ceiling", "2026-08-10", "abc123", "pdf")
        == "raw/nppa_ceiling/2026-08-10/abc123.pdf"
    )


def test_put_get_roundtrip(tmp_path):
    store = LocalRawStore(tmp_path)
    key = raw_key("s", "2026-08-10", "deadbeef", "bin")
    store.put(key, b"hello")
    assert store.exists(key)
    assert store.get(key) == b"hello"


def test_put_same_bytes_is_idempotent(tmp_path):
    store = LocalRawStore(tmp_path)
    key = "raw/s/2026-08-10/x.bin"
    store.put(key, b"same")
    store.put(key, b"same")  # no raise
    assert store.get(key) == b"same"


def test_put_different_bytes_refuses(tmp_path):
    store = LocalRawStore(tmp_path)
    key = "raw/s/2026-08-10/x.bin"
    store.put(key, b"original")
    with pytest.raises(ImmutabilityError):
        store.put(key, b"tampered")
    assert store.get(key) == b"original"

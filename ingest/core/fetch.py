"""Fetcher — the only place in the pipeline that touches the network.

Implements content-hash dedup with conditional GET (§3.3.1): most days nothing
has changed and this exits in well under a second. The HTTP client is injected
(``HttpClient`` protocol) so tests drive it with canned bytes and no network.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from .db import Db
from .hashing import sha256_bytes
from .models import RawArtifact, Snapshot
from .rawstore import RawStore, raw_key


@dataclass(frozen=True)
class HttpResponse:
    status: int
    content: bytes
    headers: dict[str, str]


class HttpClient(Protocol):
    def get(self, url: str, headers: dict[str, str]) -> HttpResponse:
        ...


@dataclass(frozen=True)
class FetchOutcome:
    snapshot: Snapshot | None
    reason: str  # 'new' | 'unchanged_304' | 'unchanged_by_hash'
    artifact: RawArtifact | None = None


def fetch_with_dedup(
    *,
    source_id: str,
    url: str,
    ext: str,
    http: HttpClient,
    store: RawStore,
    db: Db,
    today: str | None = None,
) -> FetchOutcome:
    prev = db.latest_promoted_snapshot(source_id)

    headers: dict[str, str] = {}
    if prev and prev.etag:
        headers["If-None-Match"] = prev.etag
    if prev and prev.last_modified:
        headers["If-Modified-Since"] = prev.last_modified

    resp = http.get(url, headers)

    if resp.status == 304:
        return FetchOutcome(snapshot=None, reason="unchanged_304")

    if resp.status != 200:
        raise RuntimeError(f"{source_id}: unexpected status {resp.status} from {url}")

    digest = sha256_bytes(resp.content)
    if db.snapshot_exists(source_id, digest):
        return FetchOutcome(snapshot=None, reason="unchanged_by_hash")

    iso_date = today or date.today().isoformat()
    key = raw_key(source_id, iso_date, digest, ext)
    # Raw first: bytes hit the immutable store BEFORE anything parses them.
    store.put(key, resp.content)

    snapshot = db.insert_snapshot(source_id, digest, key)
    artifact = RawArtifact(
        source_id=source_id,
        content=resp.content,
        content_type=resp.headers.get("content-type"),
        ext=ext,
        fetched_url=url,
    )
    return FetchOutcome(snapshot=snapshot, reason="new", artifact=artifact)

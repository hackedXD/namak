"""Real HTTP client (httpx) implementing the ``HttpClient`` protocol.

This is the ONLY production code that performs network I/O.

TLS: we build an explicit SSLContext from a CA bundle and always verify — never
disable verification. The bundle defaults to SALT_CA_BUNDLE or SSL_CERT_FILE if
set (both point at the egress-proxy CA inside CI), else system roots.

Operational notes discovered during the S3 build:
  - nppa.gov.in serves an INCOMPLETE certificate chain (omits its intermediate).
    A bundle that includes the intermediate — or the egress-proxy CA when behind
    one — verifies it; system roots alone do not.
  - Some gov.in hosts (nppa, cdsco) return 503 to datacenter/CI egress IPs
    (see spikes/u1-ipdms/FINDINGS.md). Fetching runs from an India-resident
    egress in production; the fetcher is relocatable by design (§5.4).
  - ``trust_env`` is False by default so we use the direct (transparently routed)
    egress, which verifies against the bundle. Set trust_env=True only where an
    explicit HTTPS_PROXY should be honoured.
"""

from __future__ import annotations

import os
import ssl

import httpx

from .fetch import HttpResponse

_DEFAULT_UA = "salt-ingest/0.0 (+https://github.com/hackedXD/namak)"


def _build_ssl_context(ca_bundle: str | None) -> ssl.SSLContext:
    ca = ca_bundle or os.environ.get("SALT_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


class HttpxClient:
    def __init__(
        self,
        timeout: float = 30.0,
        ca_bundle: str | None = None,
        trust_env: bool = False,
    ) -> None:
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            verify=_build_ssl_context(ca_bundle),
            trust_env=trust_env,
            headers={"User-Agent": _DEFAULT_UA},
        )

    def get(self, url: str, headers: dict[str, str]) -> HttpResponse:
        r = self._client.get(url, headers=headers)
        return HttpResponse(
            status=r.status_code,
            content=r.content,
            headers={k.lower(): v for k, v in r.headers.items()},
        )

    def close(self) -> None:
        self._client.close()

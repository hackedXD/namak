"""S3 — NPPA ceiling prices (design §3.1 source S3).

Artifact: NPPA's *Compendium of Ceiling Prices* PDF (nppa.gov.in). It carries a
7-column table — Medicine · Dosage form & strength · Unit/Pack · Ceiling Price
(Rs.) · S.O. No. · Date of notification — the exact fields the ceiling schema
needs.

The PDF has no ruling lines, so table auto-detection lumps rows together. We
instead parse text line-by-line, anchoring on the trailing
``<price> <S.O.no>(E) <dd.mm.yyyy>`` triplet that every data row ends with, and
we CONSERVATIVELY skip any line that doesn't cleanly match — a missed row is an
acceptable gap, a mis-parsed price is not (§12.3, precision over recall).

parse() is pure: bytes in, rows out, no network, no database. The medicine /
strength / salt decomposition is deliberately NOT done here — that is the
normaliser's job (§4.1). This parser preserves the source text verbatim.
"""

from __future__ import annotations

import io
import re
from typing import Iterator

import pdfplumber

from ..core.models import Cadence, RawArtifact, StagedRow, ValidationReport
from ..core.validate import run_generic_gates

# A data row ends with: <ceiling price>  <S.O. no like 1499(E)>  <dd.mm.yyyy>
_ROW_RE = re.compile(
    r"^(?P<desc>.*?)\s+"
    r"(?P<price>\d+(?:\.\d+)?)\s+"
    r"(?P<so>\d{2,5}\(E\))\s+"
    r"(?P<date>\d{2}\.\d{2}\.\d{4})\s*$"
)
# Optional leading NLEM section number, e.g. "1.1.3" or "1.2.4".
_SECTION_RE = re.compile(r"^(?P<sec>\d+(?:\.\d+)+)\s+(?P<rest>.*)$")


def _iso_date(ddmmyyyy: str) -> str:
    d, m, y = ddmmyyyy.split(".")
    return f"{y}-{m}-{d}"


class NppaCeilingSource:
    id = "nppa_ceiling"
    cadence = Cadence.EVENT  # on notification + annual April WPI revision
    url = "https://nppa.gov.in/en/compendiumofprice"

    def parse(self, artifact: RawArtifact) -> Iterator[StagedRow]:
        with pdfplumber.open(io.BytesIO(artifact.content)) as pdf:
            for page_index, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                for raw in text.split("\n"):
                    line = raw.strip()
                    if not line:
                        continue
                    m = _ROW_RE.match(line)
                    if not m:
                        continue  # header / section / narrative / continuation
                    desc = m.group("desc").strip()
                    section = None
                    sm = _SECTION_RE.match(desc)
                    if sm:
                        section = sm.group("sec")
                        desc = sm.group("rest").strip()
                    if not desc:
                        continue
                    yield StagedRow(
                        entity="staging_ceiling",
                        fields={
                            "source_page": page_index + 1,
                            "nlem_section": section,
                            "raw_description": desc,
                            "ceiling_price": float(m.group("price")),
                            "notification_no": m.group("so"),
                            "notification_date": _iso_date(m.group("date")),
                            "raw_line": line,
                        },
                    )

    def validate(
        self, rows: list[StagedRow], prev: object | None = None
    ) -> ValidationReport:
        dicts = [r.fields for r in rows]
        prev_count = len(prev) if isinstance(prev, list) else None
        return run_generic_gates(dicts, prev_row_count=prev_count)

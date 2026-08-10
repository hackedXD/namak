"""S10 — India PIN-code centroids (design §3.1 S10, §4.5 step 1).

Artifact: the GeoNames India postal export ``IN.zip`` (CC-BY 4.0). It has one row
per (pincode, place) with lat/lng; we aggregate to one centroid per pincode.
GeoNames is a community/tier-2 source — chosen because the official India Post
open data has empty coordinates for most offices (measured). It is recorded as
tier-2 CC in the `source` licensing register and surfaced on /sources.

parse() is pure: bytes (the zip) in, one StagedRow per pincode out. No network,
no database.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from statistics import fmean
from typing import Iterator

from ..core.models import Cadence, GateResult, RawArtifact, StagedRow, ValidationReport
from ..core.validate import (
    gate_coord_sanity,
    gate_encoding,
    gate_required_fields,
    gate_row_count_drift,
)

# GeoNames "geonames postal code" tab-separated column order.
_COL = {
    "country": 0,
    "postal_code": 1,
    "place_name": 2,
    "admin1_name": 3,
    "admin2_name": 5,
    "latitude": 9,
    "longitude": 10,
}
# Rough India bounding box (incl. Andaman & Nicobar, Lakshadweep).
_LAT_RANGE = (6.0, 37.5)
_LNG_RANGE = (68.0, 97.5)


class GeonamesPincodeSource:
    id = "geonames_pincode"
    cadence = Cadence.RARE
    url = "https://download.geonames.org/export/zip/IN.zip"

    def parse(self, artifact: RawArtifact) -> Iterator[StagedRow]:
        with zipfile.ZipFile(io.BytesIO(artifact.content)) as z:
            text = z.read("IN.txt").decode("utf-8")

        agg: dict[str, dict] = defaultdict(
            lambda: {"lat": [], "lng": [], "state": None, "district": None}
        )
        for row in csv.reader(text.splitlines(), delimiter="\t"):
            if len(row) <= _COL["longitude"]:
                continue
            pin = row[_COL["postal_code"]].strip()
            try:
                lat = float(row[_COL["latitude"]])
                lng = float(row[_COL["longitude"]])
            except ValueError:
                continue
            if not pin:
                continue
            a = agg[pin]
            a["lat"].append(lat)
            a["lng"].append(lng)
            if a["state"] is None:
                a["state"] = row[_COL["admin1_name"]].strip() or None
                a["district"] = row[_COL["admin2_name"]].strip() or None

        # deterministic order: by pincode
        for pin in sorted(agg):
            a = agg[pin]
            yield StagedRow(
                entity="pin_centroid",
                fields={
                    "pincode": pin,
                    "lat": round(fmean(a["lat"]), 6),
                    "lng": round(fmean(a["lng"]), 6),
                    "place_count": len(a["lat"]),
                    "state": a["state"],
                    "district": a["district"],
                },
            )

    def validate(
        self, rows: list[StagedRow], prev: object | None = None
    ) -> ValidationReport:
        dicts = [r.fields for r in rows]
        prev_count = len(prev) if isinstance(prev, list) else None
        results = [
            gate_required_fields(dicts, ("pincode", "lat", "lng")),
            gate_coord_sanity(dicts, _LAT_RANGE, _LNG_RANGE),
            gate_row_count_drift(len(dicts), prev_count),
            gate_encoding([{"raw_line": f"{d.get('state','')}"} for d in dicts]),
            self._gate_pincode_format(dicts),
        ]
        return ValidationReport(results=results)

    @staticmethod
    def _gate_pincode_format(rows: list[dict]) -> GateResult:
        bad = sum(1 for r in rows if not (str(r["pincode"]).isdigit() and len(str(r["pincode"])) == 6))
        return GateResult("pincode_format", bad == 0, f"{bad} non-6-digit pincodes" if bad else "")

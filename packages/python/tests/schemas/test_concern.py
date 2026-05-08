"""Drift-detection tests for ConcernCategory + IntegritySeverity.

The canonical source for both enumerations is ``schemas/concern.schema.json``
at the repo root. Every Python-side declaration must match it exactly.
These tests fail fast on drift — same incident class as the May 6, 2026
mnemom-prover outage (six-vs-eight categories), caught at PR time
instead of in production.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from aip.analysis.engine import VALID_CATEGORIES, VALID_SEVERITIES
from aip.schemas.concern import (
    VALID_CONCERN_CATEGORIES,
    ConcernCategory,
    IntegritySeverity,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO_ROOT / "schemas" / "concern.schema.json"


def _schema_enum(defs_key: str) -> set[str]:
    schema = json.loads(SCHEMA_PATH.read_text())
    return set(schema["$defs"][defs_key]["enum"])


def test_schema_concern_category_matches_concern_py_literal() -> None:
    schema_categories = _schema_enum("ConcernCategory")
    literal_categories = set(get_args(ConcernCategory))
    assert literal_categories == schema_categories, (
        f"ConcernCategory Literal in aip.schemas.concern drifted from "
        f"schemas/concern.schema.json.\n"
        f"  In Literal but not in schema: {literal_categories - schema_categories}\n"
        f"  In schema but not in Literal: {schema_categories - literal_categories}"
    )


def test_schema_concern_category_matches_concern_py_valid_set() -> None:
    schema_categories = _schema_enum("ConcernCategory")
    assert schema_categories == VALID_CONCERN_CATEGORIES, (
        f"VALID_CONCERN_CATEGORIES in aip.schemas.concern drifted from "
        f"schemas/concern.schema.json.\n"
        f"  In set but not in schema: {VALID_CONCERN_CATEGORIES - schema_categories}\n"
        f"  In schema but not in set: {schema_categories - VALID_CONCERN_CATEGORIES}"
    )


def test_schema_concern_category_matches_engine_py_valid_categories() -> None:
    schema_categories = _schema_enum("ConcernCategory")
    assert schema_categories == VALID_CATEGORIES, (
        f"VALID_CATEGORIES in aip.analysis.engine drifted from "
        f"schemas/concern.schema.json.\n"
        f"  In set but not in schema: {VALID_CATEGORIES - schema_categories}\n"
        f"  In schema but not in set: {schema_categories - VALID_CATEGORIES}"
    )


def test_schema_severity_matches_concern_py_literal() -> None:
    schema_severities = _schema_enum("IntegritySeverity")
    literal_severities = set(get_args(IntegritySeverity))
    assert literal_severities == schema_severities, (
        f"IntegritySeverity Literal drifted from schemas/concern.schema.json.\n"
        f"  In Literal but not in schema: {literal_severities - schema_severities}\n"
        f"  In schema but not in Literal: {schema_severities - literal_severities}"
    )


def test_schema_severity_matches_engine_py_valid_severities() -> None:
    schema_severities = _schema_enum("IntegritySeverity")
    assert schema_severities == VALID_SEVERITIES, (
        "VALID_SEVERITIES in aip.analysis.engine drifted from "
        "schemas/concern.schema.json."
    )

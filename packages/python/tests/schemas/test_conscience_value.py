"""Canonical JSON schema parity tests for conscience-value.schema.json.

Validates that every Python-side enumeration and required-field set declared
for ConscienceValue and ConscienceValueType matches the canonical schema at
schemas/conscience-value.schema.json.
These tests fail fast on drift — catching schema/implementation divergence at
PR time rather than in production.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from aip.schemas.conscience import ConscienceValue, ConscienceValueType

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO_ROOT / "schemas" / "conscience-value.schema.json"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def test_schema_conscience_value_type_matches_conscience_py_literal() -> None:
    schema = _load_schema()
    schema_types = set(schema["properties"]["type"]["enum"])
    literal_types = set(get_args(ConscienceValueType))
    assert literal_types == schema_types, (
        f"ConscienceValueType Literal in aip.schemas.conscience drifted from "
        f"schemas/conscience-value.schema.json.\n"
        f"  In Literal but not in schema: {literal_types - schema_types}\n"
        f"  In schema but not in Literal: {schema_types - literal_types}"
    )


def test_schema_conscience_value_required_fields_covered_by_conscience_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["required"])
    py_fields = set(ConscienceValue.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"ConscienceValue in aip.schemas.conscience is missing required fields "
        f"declared in schemas/conscience-value.schema.json: {missing}"
    )

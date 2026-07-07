"""Canonical JSON schema parity tests for integrity-signal.schema.json.

Validates that every Python-side enumeration and required-field set declared
for IntegritySignal, WindowSummary, and VerdictCounts matches the canonical
schema at schemas/integrity-signal.schema.json.
These tests fail fast on drift — catching schema/implementation divergence at
PR time rather than in production.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from aip.schemas.signal import IntegritySignal, RecommendedAction, VerdictCounts, WindowSummary

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO_ROOT / "schemas" / "integrity-signal.schema.json"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def test_schema_recommended_action_matches_signal_py_literal() -> None:
    schema = _load_schema()
    schema_actions = set(schema["properties"]["recommended_action"]["enum"])
    literal_actions = set(get_args(RecommendedAction))
    assert literal_actions == schema_actions, (
        f"RecommendedAction Literal in aip.schemas.signal drifted from "
        f"schemas/integrity-signal.schema.json.\n"
        f"  In Literal but not in schema: {literal_actions - schema_actions}\n"
        f"  In schema but not in Literal: {schema_actions - literal_actions}"
    )


def test_schema_integrity_signal_required_fields_covered_by_signal_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["required"])
    py_fields = set(IntegritySignal.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"IntegritySignal in aip.schemas.signal is missing required fields "
        f"declared in schemas/integrity-signal.schema.json: {missing}"
    )


def test_schema_window_summary_required_fields_covered_by_signal_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["$defs"]["WindowSummary"]["required"])
    py_fields = set(WindowSummary.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"WindowSummary in aip.schemas.signal is missing required fields "
        f"declared in schemas/integrity-signal.schema.json ($defs.WindowSummary): {missing}"
    )


def test_schema_verdict_counts_required_fields_covered_by_signal_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["$defs"]["WindowSummary"]["properties"]["verdicts"]["required"])
    py_fields = set(VerdictCounts.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"VerdictCounts in aip.schemas.signal is missing required fields "
        f"declared in schemas/integrity-signal.schema.json "
        f"($defs.WindowSummary.properties.verdicts): {missing}"
    )

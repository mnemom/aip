"""Canonical JSON schema parity tests for integrity-checkpoint.schema.json.

Validates that every Python-side enumeration and required-field set declared
for IntegrityCheckpoint, ConscienceContext, AnalysisMetadata, and WindowPosition
matches the canonical schema at schemas/integrity-checkpoint.schema.json.
These tests fail fast on drift — catching schema/implementation divergence at
PR time rather than in production, mirroring the same guard that exists for
ConcernCategory and IntegritySeverity in test_concern.py.

ConsultationDepth is validated here (not in a conscience test) because its
canonical schema definition lives inside $defs.ConscienceContext in
integrity-checkpoint.schema.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from aip.schemas.checkpoint import (
    VALID_VERDICTS,
    AnalysisMetadata,
    IntegrityCheckpoint,
    IntegrityVerdict,
    WindowPosition,
)
from aip.schemas.conscience import VALID_CONSULTATION_DEPTHS, ConscienceContext, ConsultationDepth

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO_ROOT / "schemas" / "integrity-checkpoint.schema.json"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def test_schema_integrity_verdict_matches_checkpoint_py_literal() -> None:
    schema = _load_schema()
    schema_verdicts = set(schema["properties"]["verdict"]["enum"])
    literal_verdicts = set(get_args(IntegrityVerdict))
    assert literal_verdicts == schema_verdicts, (
        f"IntegrityVerdict Literal in aip.schemas.checkpoint drifted from "
        f"schemas/integrity-checkpoint.schema.json.\n"
        f"  In Literal but not in schema: {literal_verdicts - schema_verdicts}\n"
        f"  In schema but not in Literal: {schema_verdicts - literal_verdicts}"
    )


def test_schema_integrity_verdict_matches_checkpoint_py_valid_set() -> None:
    schema = _load_schema()
    schema_verdicts = set(schema["properties"]["verdict"]["enum"])
    assert schema_verdicts == VALID_VERDICTS, (
        f"VALID_VERDICTS in aip.schemas.checkpoint drifted from "
        f"schemas/integrity-checkpoint.schema.json.\n"
        f"  In set but not in schema: {VALID_VERDICTS - schema_verdicts}\n"
        f"  In schema but not in set: {schema_verdicts - VALID_VERDICTS}"
    )


def test_schema_consultation_depth_matches_conscience_py_literal() -> None:
    schema = _load_schema()
    schema_depths = set(
        schema["$defs"]["ConscienceContext"]["properties"]["consultation_depth"]["enum"]
    )
    literal_depths = set(get_args(ConsultationDepth))
    assert literal_depths == schema_depths, (
        f"ConsultationDepth Literal in aip.schemas.conscience drifted from "
        f"schemas/integrity-checkpoint.schema.json ($defs.ConscienceContext).\n"
        f"  In Literal but not in schema: {literal_depths - schema_depths}\n"
        f"  In schema but not in Literal: {schema_depths - literal_depths}"
    )


def test_schema_consultation_depth_matches_conscience_py_valid_set() -> None:
    schema = _load_schema()
    schema_depths = set(
        schema["$defs"]["ConscienceContext"]["properties"]["consultation_depth"]["enum"]
    )
    assert schema_depths == VALID_CONSULTATION_DEPTHS, (
        f"VALID_CONSULTATION_DEPTHS in aip.schemas.conscience drifted from "
        f"schemas/integrity-checkpoint.schema.json ($defs.ConscienceContext).\n"
        f"  In set but not in schema: {VALID_CONSULTATION_DEPTHS - schema_depths}\n"
        f"  In schema but not in set: {schema_depths - VALID_CONSULTATION_DEPTHS}"
    )


def test_schema_integrity_checkpoint_required_fields_covered_by_checkpoint_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["required"])
    py_fields = set(IntegrityCheckpoint.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"IntegrityCheckpoint in aip.schemas.checkpoint is missing required fields "
        f"declared in schemas/integrity-checkpoint.schema.json: {missing}"
    )


def test_schema_conscience_context_required_fields_covered_by_conscience_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["$defs"]["ConscienceContext"]["required"])
    py_fields = set(ConscienceContext.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"ConscienceContext in aip.schemas.conscience is missing required fields "
        f"declared in schemas/integrity-checkpoint.schema.json ($defs.ConscienceContext): {missing}"
    )


def test_schema_analysis_metadata_required_fields_covered_by_checkpoint_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["$defs"]["AnalysisMetadata"]["required"])
    py_fields = set(AnalysisMetadata.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"AnalysisMetadata in aip.schemas.checkpoint is missing required fields "
        f"declared in schemas/integrity-checkpoint.schema.json ($defs.AnalysisMetadata): {missing}"
    )


def test_schema_window_position_required_fields_covered_by_checkpoint_py() -> None:
    schema = _load_schema()
    schema_required = set(schema["$defs"]["WindowPosition"]["required"])
    py_fields = set(WindowPosition.__dataclass_fields__)
    missing = schema_required - py_fields
    assert not missing, (
        f"WindowPosition in aip.schemas.checkpoint is missing required fields "
        f"declared in schemas/integrity-checkpoint.schema.json ($defs.WindowPosition): {missing}"
    )

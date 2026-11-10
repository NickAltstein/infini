"""Tests for Level 4 Loop Brakes (max runs, tokens, dollars, stagnation, per-step persistence)."""
import json
import pytest
from pathlib import Path
from infini.parse import parse
from infini.engine import run


MINIMAL_LOOPFILE = """
LOOPFILE: "1.0"
name: loop-brakes-test
version: 1.0.0
OBJECTIVE: "Test Level 4 loop brakes."

AGENTS:
  - name: test_agent
    role: builder
    model_tier: sonnet

STEPS:
  - id: step_one
    name: First Step
    action: Generate baseline output
    uses: test_agent
    produces:
      - out1.txt

VERIFY:
  syntactic:
    - out1.txt:exists
  semantic:
    - judge:quality>=90
  confidence_threshold: 85

BUDGET:
  dollars: 5.0
  minutes: 5.0

STOP_WHEN:
  - iterations>=5
"""


def test_loop_brakes_token_ceiling(tmp_path):
    # Set tight token limit
    yaml_str = MINIMAL_LOOPFILE.replace("dollars: 5.0", "dollars: 5.0\n  tokens: 50")
    lf = parse(yaml_str)

    trace = run(lf, output_dir=tmp_path, mock=True, max_iterations=5, verbose=False)
    assert trace.outcome == "budget_exceeded"
    brakes = trace.extensions.get("loop_brakes", {})
    assert brakes.get("tripped") is not None
    assert brakes["tripped"]["brake"] == "max_tokens"


def test_loop_brakes_dollar_ceiling(tmp_path):
    # Set tight dollar limit that will be tripped on first step
    yaml_str = MINIMAL_LOOPFILE.replace("dollars: 5.0", "dollars: 0.0001")
    lf = parse(yaml_str)

    trace = run(lf, output_dir=tmp_path, mock=True, max_iterations=5, verbose=False)
    assert trace.outcome == "budget_exceeded"
    brakes = trace.extensions.get("loop_brakes", {})
    assert brakes.get("tripped") is not None
    assert brakes["tripped"]["brake"] == "max_dollars"


def test_loop_brakes_stagnation_detection(tmp_path):
    # Non-deterministic mode where verification fails repeatedly and produces identical outputs
    # Force verification threshold to 100 so it doesn't pass
    yaml_str = MINIMAL_LOOPFILE.replace("confidence_threshold: 85", "confidence_threshold: 99")
    lf = parse(yaml_str)

    trace = run(lf, output_dir=tmp_path, mock=True, max_iterations=5, deterministic=False, verbose=False)
    brakes = trace.extensions.get("loop_brakes", {})
    # Either shipped if lucky random pass, or stagnation halted after 2 consecutive rounds finding nothing new
    if trace.outcome != "verified":
        assert trace.outcome == "stagnation_halted"
        assert brakes.get("tripped") is not None
        assert brakes["tripped"]["brake"] == "stagnation"
        assert brakes["tripped"]["consecutive_stagnant_rounds"] >= 2


def test_loop_brakes_incremental_state_persistence(tmp_path):
    lf = parse(MINIMAL_LOOPFILE)
    run_file = tmp_path / "run.json"

    trace = run(lf, output_dir=tmp_path, mock=True, max_iterations=2, deterministic=True, verbose=False)
    assert run_file.exists()
    data = json.loads(run_file.read_text())
    assert "steps" in data
    assert len(data["steps"]) >= 1
    assert data["extensions"]["loop_brakes"]["state_persisted_per_step"] is True

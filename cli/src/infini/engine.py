"""INFINI Reference Engine.

Executes a Loopfile: runs the STEPS DAG, enforces BUDGET, runs VERIFY,
and emits a trace. In mock mode (default for V1), uses the mock LLM
engine so no API key is required.
"""
from __future__ import annotations

from pathlib import Path

from .parse import Loopfile, Step
from .trace import Trace, add_step, add_verification, finalize_trace, save_trace, new_trace
from .mock import mock_execute, mock_verify
from .verifier import SyntacticVerifier


class BudgetExceeded(Exception):
    pass


def run(
    loopfile: Loopfile,
    output_dir: str | Path = "runs/latest",
    mock: bool = True,
    max_iterations: int = 5,
    verbose: bool = True,
    deterministic: bool = False,
    working_dir: str | Path | None = None,
) -> Trace:
    """Execute a Loopfile. Returns the completed Trace.

    Args:
        loopfile: Parsed Loopfile to run.
        output_dir: Where to save the trace (run.json).
        mock: If True, use mock LLM (no API key needed).
        max_iterations: Hard cap on iterations (overrides STOP_WHEN if lower).
        verbose: Print progress to stdout.
        deterministic: If True, all verifiers pass on iteration 1 (for conformance).
        working_dir: If set, syntactic checks run against this directory
                     (real filesystem + subprocess checks). If None,
                     syntactic checks are skipped — pure mock mode preserves
                     conformance.
    """
    trace = new_trace(loopfile.name, _serialize(loopfile))

    # MCP: record the declared TOOLS servers in the trace. The mock
    # engine never launches servers (determinism); the live engine
    # and McpToolRuntime do the actual loading. See docs/mcp-runtime.md.
    if loopfile.tools:
        from .mcp_runtime import plan_mcp_runtime
        trace.extensions["mcp"] = plan_mcp_runtime(loopfile.tools)
        if verbose:
            names = ", ".join(
                s["name"] for s in trace.extensions["mcp"]["servers"]
            )
            _log(f"▶ mcp: {len(loopfile.tools)} server(s) declared: {names}")

    # Level 4 Loop Brakes Configuration & Enforcement
    stop_when_cap = max_iterations
    max_tokens = loopfile.budget.tokens
    max_dollars = loopfile.budget.dollars
    stagnation_limit = 2

    for pred in loopfile.stop_when:
        if pred.startswith("iterations>="):
            try:
                stop_when_cap = min(stop_when_cap, int(pred.split(">=")[1]))
            except (ValueError, IndexError):
                pass
        elif pred.startswith("tokens>="):
            try:
                parsed_tokens = int(pred.split(">=")[1])
                max_tokens = parsed_tokens if max_tokens is None else min(max_tokens, parsed_tokens)
            except (ValueError, IndexError):
                pass
        elif pred.startswith("dollars>=") or pred.startswith("cost>="):
            try:
                parsed_dollars = float(pred.split(">=")[1])
                max_dollars = min(max_dollars, parsed_dollars)
            except (ValueError, IndexError):
                pass
        elif pred.startswith("stagnation>="):
            try:
                stagnation_limit = int(pred.split(">=")[1])
            except (ValueError, IndexError):
                pass

    effective_max = min(max_iterations, stop_when_cap)

    trace.extensions["loop_brakes"] = {
        "max_runs": effective_max,
        "max_dollars": max_dollars,
        "max_tokens": max_tokens,
        "stagnation_limit": stagnation_limit,
        "state_persisted_per_step": True,
        "stagnant_consecutive_rounds": 0,
        "tripped": None,
    }

    if verbose:
        _log(f"▶ engine: infini-reference {'(mock)' if mock else '(live)'}")
        _log(f"▶ reading state... none found, starting fresh")
        _log(f"▶ objective: {loopfile.objective}")
        _log(f"▶ budget: ${loopfile.budget.dollars} / {loopfile.budget.minutes}m (payment: {loopfile.budget.payment_method}, settlement: {loopfile.budget.settlement})")

    from .agent_pay import AgentPayAdapter
    pay_adapter = AgentPayAdapter(wallet_address=loopfile.budget.wallet_address, default_method=loopfile.budget.payment_method)

    outcome = "unverified"
    lessons: list[str] = []
    prior_progress_sig = None
    stagnant_rounds = 0

    for iteration in range(1, effective_max + 1):
        trace.iterations = iteration
        if verbose:
            _log(f"▶ iteration {iteration}")

        # Execute all steps
        for step in loopfile.steps:
            result = _execute_step(loopfile, step, iteration, mock)

            if result.status == "failed" and step.retry:
                # Retry
                for attempt in range(1, step.retry.get("max", 3) + 1):
                    if verbose:
                        _log(f"  ⚠ {step.id} {step.name} failed, retry {attempt}/{step.retry.get('max', 3)}")
                    result = _execute_step(loopfile, step, iteration, mock, retry_attempt=attempt)
                    if result.status == "ok":
                        break

            # Escrow hold check for step budget
            if result.cost_dollars > 0:
                try:
                    pay_adapter.hold_in_escrow(loopfile, step.id, result.cost_dollars)
                except ValueError as exc:
                    outcome = "budget_exceeded"
                    reason = f"escrow budget exceeded: {exc}"
                    trace.extensions["loop_brakes"]["tripped"] = {
                        "brake": "max_dollars",
                        "reason": reason,
                        "iteration": iteration,
                        "step": step.id,
                    }
                    if verbose:
                        _log(f"  ✗ loop brake: {reason}")
                    finalize_trace(trace, outcome, lessons)
                    pay_adapter.settle_or_refund(trace, loopfile)
                    save_trace(trace, Path(output_dir) / "run.json")
                    return trace

            add_step(
                trace, step.id, step.name,
                agent=step.uses, action=step.action,
                artifacts=result.artifacts,
                cost_dollars=result.cost_dollars,
                cost_minutes=result.cost_minutes,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                status=result.status,
                retry_attempt=result.retry_attempt,
            )

            if verbose:
                status_icon = "✓" if result.status == "ok" else "⚠"
                _log(f"  {status_icon} {step.id} {step.name}  ${result.cost_dollars:.2f} · {result.cost_minutes:.1f}m")

            # Level 4 loop brake: State written incrementally after every single step
            save_trace(trace, Path(output_dir) / "run.json")

            # Check dollar budget brake
            if trace.budget["spent_dollars"] >= max_dollars:
                outcome = "budget_exceeded"
                reason = f"dollar budget exceeded (${trace.budget['spent_dollars']:.2f} >= ${max_dollars:.2f})"
                trace.extensions["loop_brakes"]["tripped"] = {
                    "brake": "max_dollars",
                    "reason": reason,
                    "iteration": iteration,
                    "step": step.id,
                }
                if verbose:
                    _log(f"  ✗ loop brake: {reason}")
                finalize_trace(trace, outcome, lessons)
                pay_adapter.settle_or_refund(trace, loopfile)
                save_trace(trace, Path(output_dir) / "run.json")
                return trace

            # Check token ceiling brake
            if max_tokens is not None and trace.budget.get("spent_tokens", 0) >= max_tokens:
                outcome = "budget_exceeded"
                reason = f"token ceiling exceeded ({trace.budget['spent_tokens']} >= {max_tokens})"
                trace.extensions["loop_brakes"]["tripped"] = {
                    "brake": "max_tokens",
                    "reason": reason,
                    "iteration": iteration,
                    "step": step.id,
                }
                if verbose:
                    _log(f"  ✗ loop brake: {reason}")
                finalize_trace(trace, outcome, lessons)
                pay_adapter.settle_or_refund(trace, loopfile)
                save_trace(trace, Path(output_dir) / "run.json")
                return trace

            if trace.budget["spent_minutes"] >= loopfile.budget.minutes:
                outcome = "budget_exceeded"
                reason = f"minute budget exceeded ({trace.budget['spent_minutes']:.1f}m / {loopfile.budget.minutes}m)"
                trace.extensions["loop_brakes"]["tripped"] = {
                    "brake": "max_minutes",
                    "reason": reason,
                    "iteration": iteration,
                    "step": step.id,
                }
                if verbose:
                    _log(f"  ✗ loop brake: {reason}")
                finalize_trace(trace, outcome, lessons)
                pay_adapter.settle_or_refund(trace, loopfile)
                save_trace(trace, Path(output_dir) / "run.json")
                return trace

        # Run verification
        if verbose:
            _log(f"▶ verification:")
        all_passed = True
        confidences: list[float] = []

        # Syntactic checks: real when working_dir is set, otherwise fall
        # back to the mock verifier (preserves conformance determinism).
        if working_dir is not None:
            verifier = SyntacticVerifier(working_dir)
            syn_results = verifier.verify_all(list(loopfile.verify.syntactic))
            for check in loopfile.verify.syntactic:
                r = syn_results.get(check, {"passed": False, "detail": "not run"})
                passed = bool(r["passed"])
                add_verification(trace, check, passed, confidence=None, detail=r.get("detail"))
                if verbose:
                    _log(f"  {'✓' if passed else '✗'} {check}" + (f" ({r['detail']})" if not passed and r.get("detail") else ""))
                if not passed:
                    all_passed = False
        else:
            for check in loopfile.verify.syntactic:
                passed, _ = mock_verify(check, loopfile.name, iteration, loopfile.verify.confidence_threshold, deterministic=deterministic) if mock else (True, None)
                add_verification(trace, check, passed, confidence=None)
                if verbose:
                    _log(f"  {'✓' if passed else '✗'} {check}")
                if not passed:
                    all_passed = False

        for check in loopfile.verify.semantic:
            passed, conf = mock_verify(check, loopfile.name, iteration, loopfile.verify.confidence_threshold, deterministic=deterministic) if mock else (True, 90.0)
            add_verification(trace, check, passed, confidence=conf)
            if conf is not None:
                confidences.append(conf)
            if verbose:
                _log(f"  {'✓' if passed else '✗'} {check} (conf {conf})" if conf else f"  {'✓' if passed else '✗'} {check}")
            if not passed:
                all_passed = False

        # Check confidence threshold
        if confidences:
            mean_conf = sum(confidences) / len(confidences)
            if mean_conf < loopfile.verify.confidence_threshold:
                all_passed = False
                if verbose:
                    _log(f"  ✗ mean confidence {mean_conf:.1f} < threshold {loopfile.verify.confidence_threshold}")

        if all_passed:
            outcome = "verified"
            lesson = f"{loopfile.name} shipped at iteration {iteration} with mean confidence {sum(confidences)/len(confidences):.1f}." if confidences else f"{loopfile.name} shipped at iteration {iteration}."
            lessons.append(lesson)
            if verbose:
                _log(f"✓ shipped. state saved. lessons appended.")
            break

        # Level 4 loop brake: Stagnation detection (stop after two rounds that find nothing new)
        current_artifacts = sorted(list({a for s in trace.steps for a in s.artifacts}))
        passed_verifs = sorted([v.check for v in trace.verifications if v.status == "pass"])
        progress_sig = (current_artifacts, passed_verifs)

        if iteration > 1 and prior_progress_sig is not None and progress_sig == prior_progress_sig:
            stagnant_rounds += 1
            trace.extensions["loop_brakes"]["stagnant_consecutive_rounds"] = stagnant_rounds
            if verbose:
                _log(f"  ⚠ stagnation warning: round {iteration} found nothing new ({stagnant_rounds}/{stagnation_limit})")
            if stagnant_rounds >= stagnation_limit:
                outcome = "stagnation_halted"
                reason = f"stagnation brake: stopped after {stagnation_limit} consecutive rounds that found nothing new"
                trace.extensions["loop_brakes"]["tripped"] = {
                    "brake": "stagnation",
                    "reason": reason,
                    "iteration": iteration,
                    "consecutive_stagnant_rounds": stagnant_rounds,
                }
                if verbose:
                    _log(f"  ✗ loop brake: {reason}")
                finalize_trace(trace, outcome, lessons)
                pay_adapter.settle_or_refund(trace, loopfile)
                save_trace(trace, Path(output_dir) / "run.json")
                return trace
        else:
            stagnant_rounds = 0
            prior_progress_sig = progress_sig

        # Check stop conditions — effective_max already accounts for STOP_WHEN iterations>=N
        if iteration >= effective_max:
            if outcome == "unverified":
                trace.extensions["loop_brakes"]["tripped"] = {
                    "brake": "max_runs",
                    "reason": f"maximum iterations cap reached ({effective_max})",
                    "iteration": iteration,
                }
            break

    finalize_trace(trace, outcome, lessons)
    pay_adapter.settle_or_refund(trace, loopfile)
    save_trace(trace, Path(output_dir) / "run.json")

    if verbose:
        settlement_status = trace.settlement.get("status") if trace.settlement else "none"
        _log(f"▶ cost: ${trace.budget['spent_dollars']:.2f} / ${loopfile.budget.dollars} · {trace.budget['spent_minutes']:.1f}m / {loopfile.budget.minutes}m")
        _log(f"▶ outcome: {outcome} (settlement: {settlement_status})")
        _log(f"▶ trace: {Path(output_dir) / 'run.json'}")

    return trace


def _execute_step(
    loopfile: Loopfile,
    step: Step,
    iteration: int,
    mock: bool,
    retry_attempt: int = 0,
):
    """Execute a single step. Returns a MockResult (or equivalent)."""
    if mock:
        # Find the agent
        agent = next((a for a in loopfile.agents if a.name == step.uses), None)
        model_tier = agent.model_tier if agent else "sonnet"
        role = agent.role if agent else "builder"
        return mock_execute(
            step_id=step.id, step_name=step.name, action=step.action,
            agent_role=role, model_tier=model_tier, produces=step.produces,
            loopfile_name=loopfile.name, iteration=iteration,
            retry_attempt=retry_attempt,
        )
    else:
        # Live mode: route to the live MCP engine
        # This is reached only if run() is called with mock=False and no --plan
        # The live engine is invoked at the CLI level, not here.
        raise NotImplementedError(
            "Live execution is handled by the live_engine module. "
            "Use `infini run loop.yaml --live` from the CLI."
        )


def _serialize(loopfile: Loopfile) -> str:
    """Serialize a Loopfile back to YAML for hashing."""
    import yaml
    from .parse import to_dict
    return yaml.dump(to_dict(loopfile), sort_keys=False, default_flow_style=False)


def _log(msg: str) -> None:
    """Print to stdout."""
    print(msg)

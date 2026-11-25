# INFINI

Deterministic agent loop runner with budget limits and a stagnation stop (`stagnation_limit = 2`).

[![INFINI CI](https://github.com/NickAltstein/infini/actions/workflows/infini-ci.yml/badge.svg)](https://github.com/NickAltstein/infini/actions/workflows/infini-ci.yml)

You describe a loop in a `Loopfile` (objective, agents, steps, verification checks and a budget). `infini run` repeats the steps until verification passes, a budget limit is hit, or two consecutive rounds make no progress. Each run writes a JSON trace, `run.json`, that you can inspect, replay from a step, diff against another run, and sign.

The package is `infini-cli`. The `infini` name on PyPI belongs to a different project.

## Quickstart

These are the Quickstart commands from `infini --help`. Each was run from a source checkout in a fresh virtual environment (Python 3.11+), with the repository's `examples/quickstart.yaml` copied to `loop.yaml`.

```bash
git clone https://github.com/NickAltstein/infini.git
cd infini
pip install -e ".[dev]"
cp examples/quickstart.yaml loop.yaml
```

```bash
infini validate loop.yaml                 # check the Loopfile against the schema
infini run loop.yaml --mock               # run with the mock engine; writes runs/latest/run.json
infini inspect runs/latest/               # steps, verification results and lessons
infini replay runs/latest/ --step s1      # re-run from step s1; writes runs/replay-s1/run.json
infini diff runs/latest/run.json runs/replay-s1/run.json
```

The CLI prints `outcome: verified` here, and `verify-trace` below prints `VALID`. "verified" is infini's internal outcome label, not an independent check.

`--step` takes a step ID that exists in the trace; `quickstart.yaml` has one step, `s1`. A missing step ID prints `Step <id> not found in trace` (currently with exit code 0).

To sign a trace and check the signature offline:

```bash
infini run loop.yaml --mock --sign -o runs/signed
infini verify-trace runs/signed/run.json
```

`verify-trace` checks the Ed25519 signature against the public key embedded in the trace, or against `--key` if you pass one. Only `--key` ties the trace to a key you already trust.

PyPI's latest `infini-cli` release (1.1.0) differs from this repository's version (0.2.0). The commands above were checked against this repository.

### What mock mode does and does not do

`--mock` is the default and needs no API key. It simulates step results, costs and times; the dollar and minute figures in its output are not real spend. Mock file checks such as `report.md:exists` pass whether or not the file exists, and mock runs do not write the declared artifacts. Use `--live` (with the `live` extra and an Anthropic or OpenAI key) to call a real model.

## Budget limits and the stagnation stop

Limits come from the Loopfile's `BUDGET` block, `STOP_WHEN` predicates and the `--max-iterations` flag (default 5):

```yaml
BUDGET:
  dollars: 1        # stop when spend reaches this
  minutes: 5        # stop when elapsed time reaches this
  tokens: 50000     # optional token ceiling
STOP_WHEN:
  - all_verify_passed
  - iterations>=5   # also: tokens>=N, dollars>=N, stagnation>=N
```

- **Budget:** when spend, time or tokens reach the limit, the run stops with outcome `budget_exceeded` and exits 1. Setting `dollars: 0.01` on the quickstart Loopfile stops iteration 1 this way.
- **Stagnation stop:** a round makes progress when its set of artifacts or passing checks changes. After `stagnation_limit` consecutive rounds without progress (default 2; set with `stagnation>=N`), the run stops with outcome `stagnation_halted` and exits 1. Mock runs eventually pass verification, so a mock CLI run does not reach this stop; `cli/tests/test_loop_brakes.py` exercises it by forcing verification to fail.

Any outcome other than `verified` exits with status 1. The limit that stopped a run is recorded under `extensions.loop_brakes.tripped` in `run.json`.

## Trace format

`run.json` holds the Loopfile metadata, each step's status, cost, time and artifacts, the verification results, the budget totals, the loop-limit settings and, with `--sign`, the trace hash and signature. `infini inspect` renders it; any JSON tool can read it.

## Other commands

`infini --help` lists everything. `task` and `skill` use a local SQLite database at `~/.infini/infini.db`. `conformance` and `certify` run the suite in `tests/conformance/`. `infini ui` expects the Next.js app in `observatory-ui/` and does not currently start from a plain install.

## Limits

- Concurrent use of the SQLite database by several agent processes is not measured, and earlier versions hit `database is locked` errors. Interrupted runs may not resume.
- The mock engine is for trying the CLI. Its costs, times and file checks are simulated.

## Repository layout

```
infini/
├── cli/src/infini/   # CLI and reference engine
├── cli/tests/        # pytest suite, including the loop-limit tests
├── examples/         # example Loopfiles
├── spec/             # Loopfile specification, RFCs and schema
└── tests/            # conformance cases and corpus
```

## License

MIT © [Nick Altstein](https://github.com/NickAltstein)

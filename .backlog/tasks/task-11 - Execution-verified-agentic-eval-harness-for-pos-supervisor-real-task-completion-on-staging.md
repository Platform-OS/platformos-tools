---
id: TASK-11
title: >-
  Execution-verified agentic eval harness for pos-supervisor (real task
  completion on staging)
status: To Do
assignee: []
created_date: '2026-07-09 10:59'
updated_date: '2026-07-09 11:16'
labels:
  - eval
  - pos-supervisor
  - quality
  - epic
dependencies: []
references:
  - 'https://arxiv.org/pdf/2509.24002'
  - 'https://github.com/eval-sys/mcpmark'
  - 'https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents'
  - 'https://arxiv.org/pdf/2508.20453'
  - 'https://arxiv.org/abs/2602.00933'
  - 'https://github.com/lastmile-ai/mcp-eval'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
EPIC. Build an execution-verified eval that grades pos-supervisor by REAL platformOS task completion on a staging instance — not by transcript claims. Umbrella; each child is an independently shippable PR. Child 11.1 is a runnable-today vertical slice against staging.

## Why (the thing we are actually measuring)
pos-supervisor's job is to enhance an LLM's ability to generate VALID platformOS code. The only honest measure of that is: does an agent, with the supervisor connected, actually complete real platformOS build tasks — with the result verified against live instance state (a record exists, a page renders 200, a model/field exists) rather than the agent's "done!" claim. Per Anthropic's agent-eval guidance, you always evaluate "harness + model together", so the supervisor's own contribution is isolated by an A/B ABLATION (see 11.6): same model + brief + graders, run once WITH the supervisor and once WITHOUT, and report the delta in completion rate / lint-clean rate / iterations-to-green. That delta is the headline number that justifies the tool.

## State of the art (grounding — see references)
- MCPMark / MCP-Universe / MCP-SafetyBench: fully-automated, execution-based grading against REAL running MCP servers; per-task lifecycle = well-defined initial state → agent execution → `verify.py`-style script that programmatically checks final environment state → isolation/cleanup between tasks.
- MCP-Atlas: reference trajectory + graders proven against it (a task must be solvable and its grader must pass on a reference solution).
- Anthropic "Demystifying evals": grade OUTCOMES not paths (brittle to check tool-call order); verify final ENVIRONMENT STATE, not transcript claims ("agent says booked" vs "reservation exists in the DB"); code-based graders where possible, LLM-judge only where necessary; pass@k (≥1 of k succeeds) and pass^k (all k succeed) for variance; multi-assertion graders with partial credit.

## Two tiers
- Tier A — deterministic tool-contract eval (child 11.7): fast, hermetic golden-fixture assertions on `validate_code` output over a labeled corpus of known-good/known-bad platformOS buffers (precision/recall of the must-fix gate; blast-radius correctness). No instance. Cheap regression gate that runs in CI and gates Tier B.
- Tier B — execution-verified agentic task eval (children 11.1–11.6): real agent + real staging + programmatic final-state verification. THIS is the ask.

## Tier B lifecycle (per task, MCPMark-grounded)
1. setup/snapshot: seed fixtures; snapshot instance data (`data-export`) + record a log cursor.
2. drive the model-under-test with the brief; the agent's MCP config connects it to the pos-supervisor (system under test) AND pos-cli (to deploy/act). Filesystem is the workspace.
3. deploy the agent's output to a task-scoped staging namespace (`deploy` / `sync-file`).
4. assert final state with the code-based grader engine (child 11.2) over pos-cli + HTTP.
5. teardown: remove the namespace, restore data (`data-import`/`data-clean`), advance the row.
6. record the row (pass/fail per assertion, score, artifacts, transcript, timings).

## Assertion engine = code-based graders over live staging (child 11.2)
Every `expect.*` in tasks.yaml is one deterministic assertion, verified against real instance state (outcome, never claim):
- `renders: [slug,…]` — `endpoints-list` shows the route AND an authenticated HTTP GET returns 200 with an expected content marker (not a 5xx/error page).
- `model: {name, fields:[…]}` — GraphQL introspection / `graphql-exec` confirms the custom model + each field exists with the right type.
- `form_persists: <slug>` — submit the form (HTTP POST), then `graphql-exec` the records table for a row carrying the posted values (the claim-vs-outcome check).
- `no_runtime_errors` — `logs-fetch` over the run window shows no new errors.
- `lint_clean` — `check-run` on the deployed files is clean (ties Tier B back to the linter the supervisor wraps).
- `isolated` — the artifacts live only under the task's namespace/slug; teardown fully removes them.
Task score = fraction of its assertions that pass (partial credit). LLM-judge is reserved for optional subjective dimensions only, isolated per rubric dimension.

## Isolation (child 11.3)
Per-task namespace (module/slug prefix); `data-export` snapshot before + `data-import`/`data-clean` restore after; unique slugs; serialize task runs (no cross-task interference); a guaranteed teardown even on failure. Never mutate shared/global state that another task reads.

## Drivers (child 11.4)
A shared `AgentDriver` interface (`run(brief, workspace, mcpConfig) → transcript+artifacts`) with two implementations, same assertion engine for both:
- opencode headless: shell out to `opencode run "<brief>"` with the supervisor + pos-cli in its MCP config (already the local dev shape).
- Anthropic MCP connector: hit the Anthropic API with the MCP connector for Claude-as-agent runs.

## Metrics & reporting (child 11.6)
Per task, per arm (supervisor / control), per driver: pass@1, pass@k, pass^k; task score (partial credit); aggregate completion rate; and the SUPERVISOR LIFT (Δ completion, Δ lint-clean, Δ iterations-to-green between arms). JSONL rows + a human summary. A single `run-evals` command runnable against staging with env (MPKIT_URL, ANTHROPIC_API_KEY / opencode). Fully automatable, no CI required to run.

## Deliverable shape
`evals/` (co-located with the supervisor package or repo-root, decided in 11.1): `tasks.yaml`, `run_agent_evals.(py|ts)`, a graders module, driver adapters, per-task fixtures + reference solutions, and a results dir. Language (Python per the user's sketch vs TS to reuse check-node graders) is decided in 11.1.

## Non-goals (v1)
Not a public leaderboard; not multi-provider breadth (MCP-Bench scale); not fuzzing/safety (MCP-SafetyBench). Just: can an agent+supervisor build real platformOS features on staging, verified, and does the supervisor measurably help.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All Tier-B children (11.1–11.6) are Done and a single command runs the suite against a staging instance end-to-end, unattended
- [ ] #2 Every task is graded by execution-verified final STATE (pos-cli/HTTP), never by transcript claims; each expect.* is a deterministic assertion with partial credit
- [ ] #3 Each task ships a reference solution that passes its own graders (task solvability + grader correctness proven)
- [ ] #4 Runs are isolated: per-task namespace + data snapshot/restore + guaranteed teardown; no cross-task or shared-state interference
- [ ] #5 Two drivers (opencode headless, Anthropic MCP connector) run behind one AgentDriver interface against the same assertion engine
- [ ] #6 The ablation report emits the supervisor LIFT (Δ completion / Δ lint-clean between supervisor vs control arms) with pass@k and pass^k
- [ ] #7 Tier A (11.7) deterministic validate_code fixture gate runs hermetically in CI and gates Tier B
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed decisions (2026-07-09): (1) Harness language = TypeScript (reuse check-node/graph graders; drop the Python sketch). (2) A DEDICATED, disposable eval instance is provided by the user — safe to `data clean` freely; the suite never runs against a shared/real instance. (3) Isolation = RESET-TO-BASELINE (data clean + full deploy of the task baseline + optional data import) instead of per-task namespacing — simpler and fully hermetic on a dedicated instance (see revised 11.3). (4) The HARNESS does the authoritative final deploy of the agent's workspace and grades that — grading never depends on the agent's own deploy discipline. The agent still has pos-cli connected (may deploy/test during the run), but the graded instance state is a pure function of the agent's final files.
<!-- SECTION:NOTES:END -->

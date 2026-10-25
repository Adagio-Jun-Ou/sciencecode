---
name: hypothesis-testing
description: Use for designing or evaluating experiments, causal hypotheses, confirmatory tests, and falsification plans.
---
# Hypothesis-testing protocol

State H1 and a meaningful null/alternative explanation. Define measurable outcomes, units, directionality, decision criteria, confounders, controls, sample-size/power rationale where applicable, and stopping rules before observing outcomes. Prefer tests capable of falsifying the favored hypothesis. Correct or otherwise account for multiple comparisons. Distinguish association, prediction, intervention effects, and causality.

For a multi-step investigation, use a version-2 ScienceCode campaign rather
than an informal autonomous loop. Freeze an ordered hypothesis tree with one or
more roots and explicit alternative, refinement, mechanism, or rebuttal
relations. Give every branch its own task-attempt, GPU-task, and NPU-task
ceiling inside the global wall-clock and accelerator budget. Tasks must name
the branches they test, dependencies, expected outputs, compute target, risk,
attempt limit, and any required checkpoint. Keep network access explicit;
ScienceCode's network rule is prompt policy, not OS containment.

Run exactly one actionable task at a time through `sciencecode campaign
advance`, preserve its normal recorded-run evidence, and stop when the ledger
returns a checkpoint, exhausted budget, paused/pruned branch, failure, or human
assessment gate. Never automatically prune or promote a branch. You may
recommend a verdict and branch decision with exact completed task IDs, but you
must never invoke `sciencecode campaign assess`, call the Lab assessment route,
or otherwise submit a local-user assessment. New completed or skipped branch
work makes an earlier verdict stale and requires a fresh human checkpoint.
Report integrity, task outcome, scientific interpretation, and branch decision
as separate concepts.

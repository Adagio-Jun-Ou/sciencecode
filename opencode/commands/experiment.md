---
description: Run a hypothesis-driven, auditable CPU/GPU parameter and seed matrix
agent: simulation-engineer
subtask: true
---
Design and run a reproducible experiment matrix for: $ARGUMENTS

State the hypothesis, primary numerical outputs, fixed parameters, varied
parameters, deterministic seeds, and stopping or failure conditions before
execution. Inspect ScienceCode compute status and current GPU memory, validate
one small branch first, then run the final matrix through sciencecode
experiment run. Keep the matrix within the 64-branch safety limit.

If the request is confirmatory, freeze and verify an analysis contract before
the final run and bind it with --analysis-contract. Never derive its primary
threshold from observed branch results.

After execution, run sciencecode experiment verify on the parent record. Report
the deterministic reviewer verdict, aggregate statistics, branch-level
exceptions, exact experiment ID, generated CSV/review artifacts, and scientific
limitations. Ask the experiment-reviewer agent for an independent challenge
when a conclusion depends on small effects or failed branches.

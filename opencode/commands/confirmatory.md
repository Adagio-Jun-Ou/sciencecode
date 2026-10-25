---
description: Plan and execute a preregistered, contract-bound computational experiment
agent: scientist
---
Build a confirmatory computational workflow for: $ARGUMENTS

Use the confirmatory-analysis skill. First state the estimand or operational
question and distinguish confirmatory from exploratory objectives. Create a
human-readable nine-section preregistration, freeze it through the Lab or CLI,
create and verify an analysis contract from templates/analysis-contract.json,
and show the exact primary decision rules before inspecting outcomes. Do not
require a chat binding for any scientific record; use one only when the user
wants the separate handoff recorded for a later AI turn.

Run the prespecified seed and parameter matrix through sciencecode experiment
run with --analysis-contract. Verify the experiment, create and verify the
confirmatory assessment, and ask the read-only confirmatory-reviewer for an
independent challenge. Report contract, experiment, and assessment IDs;
registration status; primary verdict; deviations; missing branches; limits on
inference; and reproducibility commands.

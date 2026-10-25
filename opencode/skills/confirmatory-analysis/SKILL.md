---
name: confirmatory-analysis
description: Use when planning, running, assessing, or auditing preregistered confirmatory computational experiments with frozen outcomes and decision rules.
---
# Confirmatory-analysis protocol

Keep integrity, outcome, and inference as separate questions. A verified record
can contain a failed, indeterminate, or deviated scientific result.

Before inspecting experiment outcomes:

1. Write and freeze a preregistration with all nine ScienceCode sections:
   research question; hypotheses; design and population; primary outcomes;
   sample size and stopping; inclusion, exclusion, and missing data; analysis
   and decision rules; multiplicity and sensitivity analyses; and deviations,
   risks, and limitations. Use the Confirmatory Lab's structured editor or a
   completed project Markdown file. Do not inspect outcomes first.
2. Define every outcome's variable, unit, timepoint, summary measure,
   intercurrent-event strategy, experiment-branch filter, aggregation, minimum
   observation count, and numeric decision rule.
3. Freeze the JSON contract with
   `sciencecode analysis contract create SPEC.json`. Add `--chat CHAT_ID` only
   when an optional separate AI handoff is wanted.
4. Verify the contract, then run the exact frozen Python script with
   sciencecode experiment run ... --analysis-contract ANALYSIS_CONTRACT_ID.

After execution, verify the experiment and create an immutable assessment with
`sciencecode analysis assess ANALYSIS_CONTRACT_ID EXPERIMENT_ID`. Add
`--chat CHAT_ID` only for an optional separate AI handoff.
Disclose any departure with --deviation; never silently relabel a post-hoc
analysis as prospective. Verify the assessment and ask the
confirmatory-reviewer to challenge the links, branch coverage, calculations,
and interpretation.

ScienceCode's deterministic threshold engine does not calculate p-values,
confidence intervals, causal effects, clinical benefit, or regulatory
validity. Use an appropriate, prespecified statistical method when those
quantities are scientifically required, and keep exploratory findings labeled
exploratory.

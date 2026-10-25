---
name: reproducibility
description: Use when reproducing, verifying, auditing, benchmarking, or validating scientific results and computational artifacts.
---
# Reproducibility protocol

Reproduce from the earliest available source artifact rather than from derived outputs. Record exact commands, versions, environment, data hashes, seeds, and parameters. Compare expected and observed outputs numerically. If exact reproduction is impossible, classify why: missing input, unavailable dependency, nondeterminism, ambiguous method, environment drift, or contradictory result. Never tune parameters merely to recover the expected conclusion.

For a load-bearing PNG figure:

1. Resolve the baseline and rerun as distinct verified ScienceCode artifact URLs or immutable `revision:ID` selectors.
2. Before viewing the rerun difference, freeze and justify the integer RGBA channel tolerance and maximum changed-pixel fraction. If that was not prospective, label the check exploratory.
3. Run `sciencecode figure compare BASELINE CANDIDATE --pixel-tolerance N --max-changed-fraction F`, optionally adding a prospectively justified `--min-structural-similarity S` and linking `--chat CHAT_ID`. When the SSIM floor is configured, require both frozen rules to pass and never describe the score as registration, semantic equivalence, or scientific validation.
4. Run `sciencecode figure verify FIGURE_COMPARISON_ID`; inspect dimensions, exact and thresholded changed pixels, changed fraction, MAE/RMSE, per-channel deltas, bounding box, and the immutable difference PNG.
5. Report exact, within-tolerance, different, or incompatible-dimensions status. Separately verify the data, code, environment, parameters, labels, and scientific meaning; decoded-pixel or fixed-block SSIM agreement proves none of those.

Before declaring a project reproducible, run `sciencecode gate` or open the
Lab's **Verification** workspace. Start with strict policy. Integrity findings
are never waivable; an explicit failed-outcome allowance only acknowledges the
selected recorded outcome class and must be reported with its retained count.

---
description: Compare an immutable baseline figure with a recorded rerun
agent: reproducibility-reviewer
subtask: true
---
Independently compare the baseline and rerun figure for: $ARGUMENTS

Resolve two distinct manifest-verified PNG artifacts or immutable PNG revisions. Freeze and justify the RGBA channel tolerance, accepted changed-pixel fraction, and any optional minimum block-luminance structural similarity before inspecting the rerun; otherwise label the check exploratory. Use `sciencecode figure compare`, verify the resulting ID, inspect the deterministic pixel, SSIM, luminance, worst-block, and difference evidence, and report exact, within-tolerance, different, or incompatible-dimensions status. A configured pixel rule and structural rule must both pass. Then separately audit the source data, code, parameters, seed, runtime, labels, and interpretation. Pixel or SSIM agreement is a mechanical check, not semantic equivalence or scientific validation.

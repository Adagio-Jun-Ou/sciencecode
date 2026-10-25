---
description: Independently reproduce a reported result
agent: reproducibility-reviewer
subtask: true
---
Independently reproduce and audit: $ARGUMENTS

Do not assume the reported result is correct. Re-run from source inputs where possible and report exact discrepancies. If the result includes a load-bearing PNG, freeze the pixel rule and any optional minimum structural similarity first, record the baseline/rerun with `sciencecode figure compare`, verify the comparison ID, inspect the exact pixel, block-luminance SSIM, and difference evidence, and keep both mechanical checks separate from semantic equivalence and scientific validity.

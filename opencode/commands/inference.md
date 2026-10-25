---
description: Run and verify an auditable ONNX inference on the local AMD NPU
agent: data-analyst
subtask: true
---
Use the npu-inference and data-analysis skills for: $ARGUMENTS

State the model source, context of use, input schema, preprocessing, expected
outputs, applicability domain, acceptance criteria, and numeric tolerance.
Inspect ScienceCode compute status, run the deterministic strict-NPU smoke if
this machine has not been verified, then run the project model through
`sciencecode inference run` with project-relative inputs.

Do not silently permit CPU fallback. If fallback is scientifically acceptable,
make that choice explicit and report it. Verify the resulting inference ID,
inspect provider-profile attribution and hashes, and report latency, outputs,
limitations, and whether a separately recorded CPU comparison is required.

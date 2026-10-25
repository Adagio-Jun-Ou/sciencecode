---
name: npu-inference
description: Use for recorded ONNX model inference, AMD NPU execution, accelerator benchmarking, provider attribution, or CPU/NPU output comparison.
---
# Recorded NPU inference protocol

Treat model inference as a scientific computation, not a model-name claim.
Define the context of use, model source and version, input schema, preprocessing,
expected outputs, applicability domain, acceptance criteria, numeric tolerance,
and the decision the output may inform before execution.

Inspect `sciencecode compute status` first. Run the deterministic smoke on a new
machine before a project model. A strict NPU claim requires `--device npu`
without `--allow-fallback`; ScienceCode only accepts that claim when the
ONNX Runtime profile records a VitisAIExecutionProvider execution event.
Registered providers or successful session creation alone are not execution
evidence. Use `auto` or `--allow-fallback` only when fallback is explicitly
acceptable, and label the result as fallback when it occurs.

Keep the ONNX model and input JSON inside the project. Preserve the exact model
and input bytes, input tensor names and shapes, runtime and driver state,
warmup count, measured iteration count, latency distribution, outputs, logs,
provider profile, and hashes. Do not download execution providers during a
recorded run. Never treat a cancelled record or partial output as complete.

For a hardware check, run:

    sciencecode inference smoke --device npu --warmup 1 --iterations 5

For a project model, run:

    sciencecode inference run MODEL.onnx --input INPUT.json --device npu

Then run `sciencecode inference verify INFERENCE_ID`. When numerical agreement
matters, create a separate CPU record and compare outputs using a declared
tolerance; do not infer equivalence from similar previews. Report the exact
inference IDs, verification result, provider attribution, fallback status,
model and input hashes, latency, output interpretation, and limitations.

The NPU path is bounded ONNX inference. Use the recorded simulation or
experiment workflow on the NVIDIA GPU for CUDA simulation, training, parameter
sweeps, or arbitrary Python. In ScienceCode Lab, share the immutable inference
with the selected conversation when the AI should incorporate it; user
workspace actions remain separate, attributable interaction records.

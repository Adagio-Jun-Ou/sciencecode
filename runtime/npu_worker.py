"""ScienceCode Windows ML worker.

The worker is intentionally process-isolated from the CUDA runtime. It discovers
the AMD execution provider through Windows ML, registers that exact provider
with ONNX Runtime, and records provider execution-event attribution from an
ONNX Runtime profile. Provider registration alone is never treated as NPU
execution, and profile-event counts are not represented as unique graph nodes.
"""

from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
import time
import traceback
from typing import Any


RESULT_PREFIX = "SCIENCECODE_RESULT_JSON="
TARGET_PROVIDER = "VitisAIExecutionProvider"
MAX_ITERATIONS = 1000
MAX_PREVIEW_VALUES = 16
PROVIDER_PACKAGE_PATTERN = re.compile(
    r"Microsoft\.WinML\.AMD\.NPU\.EP\.2_\d+(?:\.\d+){3}_"
    r"(?:x64|arm64|x86)__8wekyb3d8bbwe",
    re.IGNORECASE,
)


def json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    return value


def package_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def emit(payload: dict[str, Any]) -> None:
    print(RESULT_PREFIX + json.dumps(payload, sort_keys=True, separators=(",", ":")))


def ready_state_name(state: Any, winml: Any) -> str:
    mapping = (
        (winml.ExecutionProviderReadyState.READY, "ready"),
        (winml.ExecutionProviderReadyState.NOT_READY, "not_ready"),
        (winml.ExecutionProviderReadyState.NOT_PRESENT, "not_present"),
    )
    for expected, label in mapping:
        if state == expected:
            return label
    return str(state).rsplit(".", 1)[-1].lower()


def validated_provider_library(value: str | None) -> Path | None:
    if value is None:
        return None
    if sys.platform != "win32":
        raise ValueError("A recorded NPU provider library is supported only on Windows.")
    candidate = Path(value)
    if not candidate.is_absolute():
        raise ValueError("The recorded NPU provider library path must be absolute.")
    resolved = candidate.resolve(strict=True)
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    if not system_root.drive:
        raise ValueError("The Windows system drive could not be resolved.")
    windows_apps = Path(system_root.drive + "\\") / "Program Files" / "WindowsApps"
    try:
        relative = resolved.relative_to(windows_apps)
    except ValueError as exc:
        raise ValueError(
            "The recorded NPU provider library is outside protected WindowsApps storage."
        ) from exc
    parts = relative.parts
    if (
        len(parts) != 3
        or PROVIDER_PACKAGE_PATTERN.fullmatch(parts[0]) is None
        or parts[1].lower() != "executionprovider"
        or parts[2].lower() != "onnxruntime_vitisai_ep.dll"
        or not resolved.is_file()
    ):
        raise ValueError("The recorded NPU provider library path is not an allowed AMD package DLL.")
    return resolved


class WindowsMlSession:
    def __init__(
        self,
        allow_provider_download: bool = False,
        provider_library: str | None = None,
    ) -> None:
        self.allow_provider_download = allow_provider_download
        self.provider_library = validated_provider_library(provider_library)
        self.bootstrap = None
        self.ort = None
        self.details: dict[str, Any] = {
            "schema_version": 1,
            "ok": False,
            "platform": sys.platform,
            "python": sys.version.split()[0],
            "python_executable": sys.executable,
            "packages": {
                "onnxruntime-windowsml": package_version("onnxruntime-windowsml"),
                "wasdk-Microsoft.Windows.AI.MachineLearning": package_version(
                    "wasdk-Microsoft.Windows.AI.MachineLearning"
                ),
                "wasdk-Microsoft.Windows.ApplicationModel.DynamicDependency.Bootstrap": package_version(
                    "wasdk-Microsoft.Windows.ApplicationModel.DynamicDependency.Bootstrap"
                ),
                "numpy": package_version("numpy"),
                "onnx": package_version("onnx"),
            },
            "providers": [],
            "registered_providers": [],
            "recorded_provider_library": (
                str(self.provider_library) if self.provider_library else None
            ),
            "error": None,
        }

    def __enter__(self) -> "WindowsMlSession":
        if sys.platform != "win32":
            raise RuntimeError("Windows ML NPU execution requires Windows.")
        from winui3.microsoft.windows.applicationmodel.dynamicdependency.bootstrap import (
            InitializeOptions,
            initialize,
        )
        import winui3.microsoft.windows.ai.machinelearning as winml
        import onnxruntime as ort

        self.bootstrap = initialize(options=InitializeOptions.ON_NO_MATCH_SHOW_UI)
        self.bootstrap.__enter__()
        self.ort = ort
        target = None
        for provider in self._catalog_providers(winml):
            record = {
                "name": provider.name,
                "ready_state": ready_state_name(provider.ready_state, winml),
                "catalog_ready_state": ready_state_name(provider.ready_state, winml),
                "library_path": None,
                "registration_source": None,
                "ensure_attempted": False,
                "ensure_status": None,
                "registered": False,
                "error": None,
            }
            if provider.name == TARGET_PROVIDER:
                target = (provider, record)
            self.details["providers"].append(record)

        if target is None and self.provider_library is None:
            self.details["error"] = "vitisai_execution_provider_not_catalogued"
            return self

        if target is None:
            provider = None
            record = {
                "name": TARGET_PROVIDER,
                "ready_state": "not_catalogued",
                "catalog_ready_state": "not_catalogued",
                "library_path": None,
                "registration_source": None,
                "ensure_attempted": False,
                "ensure_status": None,
                "registered": False,
                "error": None,
            }
            self.details["providers"].append(record)
            state = "not_catalogued"
        else:
            provider, record = target
            state = ready_state_name(provider.ready_state, winml)
            should_ensure = state == "not_ready" or (
                state == "not_present" and self.allow_provider_download
            )
            if should_ensure:
                record["ensure_attempted"] = True
                try:
                    result = provider.ensure_ready_async().get()
                    record["ensure_status"] = str(result.status).rsplit(".", 1)[-1].lower()
                    if result.status != winml.ExecutionProviderReadyResultState.SUCCESS:
                        record["error"] = (
                            "ensure_ready_failed: "
                            + str(getattr(result, "diagnostic_text", "") or result.status)
                        )
                except Exception as exc:
                    record["error"] = "ensure_ready_failed: " + type(exc).__name__ + ": " + str(exc)
            state = ready_state_name(provider.ready_state, winml)
            record["ready_state"] = state
            record["catalog_ready_state"] = state

        library_path = None
        registration_source = None
        if state == "ready" and provider is not None:
            library_path = Path(str(provider.library_path))
            registration_source = "windows_ml_catalog"
        elif self.provider_library is not None:
            library_path = self.provider_library
            registration_source = "recorded_windowsapps_library"
        elif state == "not_present" and not self.allow_provider_download:
            record["error"] = "provider_download_not_authorized"

        if library_path is not None:
            try:
                record["library_path"] = str(library_path)
                ort.register_execution_provider_library(
                    TARGET_PROVIDER, record["library_path"]
                )
                record["registered"] = True
                record["registration_source"] = registration_source
                record["ready_state"] = "ready"
                record["error"] = None
            except Exception as exc:
                record["error"] = type(exc).__name__ + ": " + str(exc)

        self.details["onnxruntime_version"] = getattr(ort, "__version__", None)
        self.details["registered_providers"] = list(ort.get_available_providers())
        self.details["ok"] = (
            record["ready_state"] == "ready"
            and record["registered"]
            and TARGET_PROVIDER in self.details["registered_providers"]
        )
        if not self.details["ok"] and not self.details["error"]:
            self.details["error"] = record["error"] or "vitisai_registration_failed"
        return self

    @staticmethod
    def _catalog_providers(winml: Any) -> list[Any]:
        catalog = winml.ExecutionProviderCatalog.get_default()
        return list(catalog.find_all_providers())

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.bootstrap is not None:
            self.bootstrap.__exit__(exc_type, exc, tb)


def numpy_dtype(type_name: str) -> Any:
    import numpy as np

    mapping = {
        "tensor(float)": np.float32,
        "tensor(double)": np.float64,
        "tensor(float16)": np.float16,
        "tensor(int64)": np.int64,
        "tensor(int32)": np.int32,
        "tensor(int16)": np.int16,
        "tensor(int8)": np.int8,
        "tensor(uint64)": np.uint64,
        "tensor(uint32)": np.uint32,
        "tensor(uint16)": np.uint16,
        "tensor(uint8)": np.uint8,
        "tensor(bool)": np.bool_,
        "tensor(string)": np.str_,
    }
    if type_name not in mapping:
        raise ValueError("Unsupported ONNX input type: " + type_name)
    return mapping[type_name]


def load_inputs(session: Any, input_path: Path) -> dict[str, Any]:
    import numpy as np

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    values = payload.get("inputs", payload) if isinstance(payload, dict) else payload
    if not isinstance(values, dict):
        raise ValueError("Inference input JSON must be an object keyed by model input name.")
    expected = {item.name: item for item in session.get_inputs()}
    unknown = sorted(set(values) - set(expected))
    missing = sorted(set(expected) - set(values))
    if unknown:
        raise ValueError("Unknown model inputs: " + ", ".join(unknown))
    if missing:
        raise ValueError("Missing model inputs: " + ", ".join(missing))
    return {
        name: np.asarray(values[name], dtype=numpy_dtype(descriptor.type))
        for name, descriptor in expected.items()
    }


def provider_counts(profile_path: Path) -> dict[str, int]:
    events = json.loads(profile_path.read_text(encoding="utf-8"))
    counts: dict[str, int] = {}
    for event in events if isinstance(events, list) else []:
        args = event.get("args") if isinstance(event, dict) else None
        provider = args.get("provider") if isinstance(args, dict) else None
        if isinstance(provider, str) and provider:
            counts[provider] = counts.get(provider, 0) + 1
    return dict(sorted(counts.items()))


def output_summary(value: Any, output_file: Path) -> dict[str, Any]:
    import numpy as np

    array = np.asarray(value)
    np.save(output_file, array, allow_pickle=False)
    flattened = array.reshape(-1)
    preview = json_safe(flattened[:MAX_PREVIEW_VALUES].tolist())
    result: dict[str, Any] = {
        "file": output_file.name,
        "dtype": str(array.dtype),
        "shape": list(array.shape),
        "elements": int(array.size),
        "preview": preview,
    }
    if np.issubdtype(array.dtype, np.number) and array.size:
        numeric = array.astype(np.float64, copy=False)
        finite = numeric[np.isfinite(numeric)]
        result["finite_elements"] = int(finite.size)
        result["nonfinite_elements"] = int(array.size - finite.size)
        if finite.size:
            result["minimum"] = float(finite.min())
            result["maximum"] = float(finite.max())
            result["mean"] = float(finite.mean())
    return result


def session_policy(ort: Any, device: str) -> Any:
    policy = ort.OrtExecutionProviderDevicePolicy
    if device in {"npu", "auto"}:
        return policy.PREFER_NPU
    if device == "cpu":
        return policy.PREFER_CPU
    raise ValueError("Device must be npu, cpu, or auto.")


def run_model(
    windows_ml: WindowsMlSession,
    model_path: Path,
    input_path: Path,
    output_directory: Path,
    device: str,
    allow_fallback: bool,
    warmup: int,
    iterations: int,
) -> dict[str, Any]:
    if iterations < 1 or iterations > MAX_ITERATIONS:
        raise ValueError("Iterations must be between 1 and 1000.")
    if warmup < 0 or warmup > MAX_ITERATIONS:
        raise ValueError("Warmup iterations must be between 0 and 1000.")
    if device in {"npu", "auto"} and not windows_ml.details["ok"]:
        raise RuntimeError(
            windows_ml.details.get("error") or "Vitis AI execution provider is unavailable."
        )

    ort = windows_ml.ort
    output_directory.mkdir(parents=True, exist_ok=True)
    options = ort.SessionOptions()
    options.enable_profiling = True
    options.profile_file_prefix = str(output_directory / "onnxruntime-profile")
    options.set_provider_selection_policy(session_policy(ort, device))

    session_started = time.perf_counter()
    session = ort.InferenceSession(str(model_path), sess_options=options)
    session_creation_ms = (time.perf_counter() - session_started) * 1000.0
    inputs = load_inputs(session, input_path)
    output_names = [item.name for item in session.get_outputs()]

    for _ in range(warmup):
        session.run(output_names, inputs)
    timings: list[float] = []
    outputs = None
    for _ in range(iterations):
        started = time.perf_counter()
        outputs = session.run(output_names, inputs)
        timings.append((time.perf_counter() - started) * 1000.0)
    profile_path = Path(session.end_profiling())
    counts = provider_counts(profile_path)
    npu_profile_events = counts.get(TARGET_PROVIDER, 0)
    fallback_detected = device == "npu" and npu_profile_events == 0

    output_records = []
    for index, (name, value) in enumerate(zip(output_names, outputs or [])):
        descriptor = output_summary(
            value, output_directory / ("output-" + str(index).zfill(3) + ".npy")
        )
        descriptor["name"] = name
        output_records.append(descriptor)
    (output_directory / "outputs.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "device_request": device,
                "provider_profile_event_counts": counts,
                "outputs": output_records,
            },
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    result = {
        "schema_version": 2,
        "ok": not fallback_detected or allow_fallback,
        "device_request": device,
        "selection_policy": (
            "prefer_npu" if device in {"npu", "auto"} else "prefer_cpu"
        ),
        "fallback_allowed": allow_fallback,
        "fallback_detected": fallback_detected,
        "provider_claim": (
            "verified_profiled_provider_execution"
            if counts
            else "provider_attribution_unavailable"
        ),
        "provider_attribution_method": "onnxruntime_profile_provider_event",
        "provider_profile_event_counts": counts,
        "npu_profile_event_count": npu_profile_events,
        "active_providers": list(session.get_providers()),
        "session_creation_ms": session_creation_ms,
        "warmup_iterations": warmup,
        "iterations": iterations,
        "latency_ms": {
            "minimum": min(timings),
            "maximum": max(timings),
            "mean": statistics.fmean(timings),
            "median": statistics.median(timings),
        },
        "model_inputs": [
            {"name": item.name, "type": item.type, "shape": item.shape}
            for item in session.get_inputs()
        ],
        "model_outputs": [
            {"name": item.name, "type": item.type, "shape": item.shape}
            for item in session.get_outputs()
        ],
        "outputs": output_records,
        "profile_file": profile_path.name,
        "runtime": windows_ml.details,
        "error": (
            "npu_execution_not_verified"
            if fallback_detected and not allow_fallback
            else None
        ),
    }
    return result


def create_smoke_fixture(output_directory: Path) -> tuple[Path, Path]:
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    output_directory.mkdir(parents=True, exist_ok=True)
    model_path = output_directory / "smoke-model.onnx"
    input_path = output_directory / "smoke-input.json"
    rng = np.random.default_rng(20260810)
    width = 256
    layers = 4
    nodes = []
    initializers = []
    previous = "input"
    for index in range(layers):
        weight_name = "weight_" + str(index)
        bias_name = "bias_" + str(index)
        matmul_name = "matmul_" + str(index)
        output_name = "output" if index == layers - 1 else "hidden_" + str(index)
        weights = (rng.standard_normal((width, width)) / math.sqrt(width)).astype(
            np.float32
        )
        bias = (rng.standard_normal((width,)) * 0.01).astype(np.float32)
        initializers.extend(
            [
                numpy_helper.from_array(weights, weight_name),
                numpy_helper.from_array(bias, bias_name),
            ]
        )
        nodes.append(helper.make_node("MatMul", [previous, weight_name], [matmul_name]))
        added_name = output_name if index == layers - 1 else "added_" + str(index)
        nodes.append(helper.make_node("Add", [matmul_name, bias_name], [added_name]))
        if index != layers - 1:
            nodes.append(helper.make_node("Relu", [added_name], [output_name]))
        previous = output_name
    graph = helper.make_graph(
        nodes,
        "sciencecode-npu-smoke",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, width])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, width])],
        initializer=initializers,
    )
    model = helper.make_model(
        graph,
        producer_name="ScienceCode",
        opset_imports=[helper.make_opsetid("", 21)],
    )
    onnx.checker.check_model(model)
    onnx.save(model, model_path)
    values = rng.standard_normal((1, width)).astype(np.float32).tolist()
    input_path.write_text(
        json.dumps({"inputs": {"input": values}}, separators=(",", ":")),
        encoding="utf-8",
    )
    return model_path, input_path


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    subparsers = result.add_subparsers(dest="action", required=True)
    probe = subparsers.add_parser("probe")
    probe.add_argument("--json", action="store_true")
    probe.add_argument("--allow-provider-download", action="store_true")
    probe.add_argument("--provider-library")
    run = subparsers.add_parser("run")
    run.add_argument("--model", required=True)
    run.add_argument("--input-json", required=True)
    run.add_argument("--output-dir", required=True)
    run.add_argument("--device", choices=("npu", "cpu", "auto"), default="npu")
    run.add_argument("--allow-fallback", action="store_true")
    run.add_argument("--allow-provider-download", action="store_true")
    run.add_argument("--provider-library")
    run.add_argument("--warmup", type=int, default=1)
    run.add_argument("--iterations", type=int, default=3)
    smoke = subparsers.add_parser("smoke")
    smoke.add_argument("--output-dir", required=True)
    smoke.add_argument("--device", choices=("npu", "cpu", "auto"), default="npu")
    smoke.add_argument("--allow-fallback", action="store_true")
    smoke.add_argument("--allow-provider-download", action="store_true")
    smoke.add_argument("--provider-library")
    smoke.add_argument("--warmup", type=int, default=1)
    smoke.add_argument("--iterations", type=int, default=3)
    return result


def main() -> int:
    arguments = parser().parse_args()
    try:
        model_path = None
        input_path = None
        if arguments.action == "smoke":
            output_directory = Path(arguments.output_dir).resolve()
            model_path, input_path = create_smoke_fixture(output_directory)
        elif arguments.action == "run":
            output_directory = Path(arguments.output_dir).resolve()
            model_path = Path(arguments.model).resolve()
            input_path = Path(arguments.input_json).resolve()
        with WindowsMlSession(
            allow_provider_download=arguments.allow_provider_download,
            provider_library=arguments.provider_library,
        ) as windows_ml:
            if arguments.action == "probe":
                emit(windows_ml.details)
                return 0 if windows_ml.details["ok"] else 1
            result = run_model(
                windows_ml,
                model_path,
                input_path,
                output_directory,
                arguments.device,
                arguments.allow_fallback,
                arguments.warmup,
                arguments.iterations,
            )
            result["model_path"] = str(model_path)
            result["input_path"] = str(input_path)
            emit(result)
            return 0 if result["ok"] else 3
    except Exception as exc:
        emit(
            {
                "schema_version": 1,
                "ok": False,
                "error": type(exc).__name__ + ": " + str(exc),
                "traceback": traceback.format_exc(limit=12),
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

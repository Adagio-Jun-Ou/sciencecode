"""Deterministic launcher used by ScienceCode recorded simulations."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import runpy
import sys
import time
import traceback


PACKAGE_NAMES = ("torch", "numpy", "scipy", "matplotlib", "pandas")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ScienceCode simulation launcher")
    parser.add_argument("--script", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--parameters-json", default="{}")
    parser.add_argument("script_args", nargs=argparse.REMAINDER)
    result = parser.parse_args()
    if result.script_args[:1] == ["--"]:
        result.script_args = result.script_args[1:]
    return result


def write_json_atomic(target: Path, value: dict) -> None:
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, target)


def package_versions() -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for name in PACKAGE_NAMES:
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = None
    return result


def choose_device(torch_module, requested: str) -> str:
    if requested == "auto":
        return "cuda:0" if torch_module.cuda.is_available() else "cpu"
    if requested == "cpu":
        return "cpu"
    if requested == "cuda":
        requested = "cuda:0"
    if requested.startswith("cuda:"):
        if not torch_module.cuda.is_available():
            raise RuntimeError("CUDA was requested but PyTorch cannot access an NVIDIA GPU")
        try:
            index = int(requested.split(":", 1)[1])
        except ValueError as error:
            raise RuntimeError("CUDA device must use the form cuda:N") from error
        if index < 0 or index >= torch_module.cuda.device_count():
            raise RuntimeError(
                f"CUDA device {index} is unavailable; detected {torch_module.cuda.device_count()} device(s)"
            )
        return f"cuda:{index}"
    raise RuntimeError("Device must be auto, cpu, cuda, or cuda:N")


def main() -> int:
    arguments = parse_arguments()
    output_directory = Path(arguments.output_dir).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    context_file = output_directory / "simulation-context.json"
    script = Path(arguments.script).resolve()
    parameters = json.loads(arguments.parameters_json)
    if not isinstance(parameters, dict):
        raise RuntimeError("Simulation parameters must decode to a JSON object")

    context: dict = {
        "schema_version": 1,
        "status": "starting",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "script": str(script),
        "seed": arguments.seed,
        "device_request": arguments.device,
        "parameters": parameters,
        "platform": {
            "python": sys.version.split()[0],
            "implementation": platform.python_implementation(),
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "packages": package_versions(),
    }
    write_json_atomic(context_file, context)
    started = time.perf_counter()

    try:
        import numpy
        import torch

        device = choose_device(torch, arguments.device)
        random.seed(arguments.seed)
        numpy.random.seed(arguments.seed % (2**32))
        torch.manual_seed(arguments.seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(arguments.seed)
        torch.use_deterministic_algorithms(True, warn_only=True)
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.benchmark = False
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.allow_tf32 = False
        if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
            torch.backends.cuda.matmul.allow_tf32 = False

        device_metadata = {"selected": device, "cuda_available": torch.cuda.is_available()}
        if device.startswith("cuda"):
            index = int(device.split(":", 1)[1])
            properties = torch.cuda.get_device_properties(index)
            torch.cuda.reset_peak_memory_stats(index)
            device_metadata.update(
                {
                    "index": index,
                    "name": torch.cuda.get_device_name(index),
                    "compute_capability": ".".join(map(str, torch.cuda.get_device_capability(index))),
                    "total_memory_bytes": properties.total_memory,
                    "cuda_runtime": torch.version.cuda,
                }
            )

        context.update(
            {
                "status": "running",
                "device": device_metadata,
                "determinism": {
                    "python_random_seeded": True,
                    "numpy_seeded": True,
                    "torch_seeded": True,
                    "deterministic_algorithms": True,
                    "cudnn_benchmark": False,
                    "tf32": False,
                    "cublas_workspace_config": os.environ.get("CUBLAS_WORKSPACE_CONFIG"),
                },
            }
        )
        write_json_atomic(context_file, context)

        os.environ["SCIENCECODE_OUTPUT_DIR"] = str(output_directory)
        os.environ["SCIENCECODE_DEVICE"] = device
        os.environ["SCIENCECODE_SEED"] = str(arguments.seed)
        os.environ["SCIENCECODE_PARAMETERS_JSON"] = json.dumps(parameters, sort_keys=True)
        sys.path.insert(0, str(script.parent))
        sys.argv = [str(script), *arguments.script_args]
        runpy.run_path(str(script), run_name="__main__")

        if device.startswith("cuda"):
            index = int(device.split(":", 1)[1])
            torch.cuda.synchronize(index)
            context["device"]["peak_memory_bytes"] = torch.cuda.max_memory_allocated(index)
        context["status"] = "completed"
        return 0
    except BaseException as error:
        context["status"] = "failed"
        context["error"] = {
            "type": type(error).__name__,
            "message": str(error),
        }
        traceback.print_exc()
        return 1
    finally:
        context["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        context["duration_seconds"] = round(time.perf_counter() - started, 6)
        write_json_atomic(context_file, context)


if __name__ == "__main__":
    raise SystemExit(main())

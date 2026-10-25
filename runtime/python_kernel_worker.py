#!/usr/bin/env python3
"""Persistent, file-protocol Python worker for ScienceCode project kernels."""

from __future__ import annotations

import ast
import builtins
import contextlib
import importlib.metadata
import io
import json
import os
import platform
import sys
import time
import traceback
import types


MAX_STREAM_CHARACTERS = 1_048_576
MAX_REPR_CHARACTERS = 2_000
MAX_VARIABLES = 128
MAX_DEPENDENCIES = 128
MAX_FIGURES = 12
PROTOCOL = sys.stdout
NAMESPACE = {
    "__name__": "__sciencecode_kernel__",
    "__package__": None,
    "__builtins__": builtins,
}
_PACKAGE_DISTRIBUTIONS = None


class BoundedText(io.TextIOBase):
    def __init__(self, limit: int = MAX_STREAM_CHARACTERS):
        super().__init__()
        self.limit = limit
        self.parts: list[str] = []
        self.characters = 0
        self.truncated = False

    @property
    def encoding(self):
        return "utf-8"

    def writable(self):
        return True

    def write(self, value):
        text = str(value)
        remaining = max(0, self.limit - self.characters)
        if remaining:
            self.parts.append(text[:remaining])
            self.characters += min(len(text), remaining)
        if len(text) > remaining:
            self.truncated = True
        return len(text)

    def flush(self):
        return None

    def value(self):
        text = "".join(self.parts)
        if self.truncated:
            text += "\n[ScienceCode output truncated]\n"
        return text


def emit(*parts):
    PROTOCOL.write("\t".join(str(part).replace("\t", " ").replace("\r", " ").replace("\n", " ") for part in parts) + "\n")
    PROTOCOL.flush()


def clipped(value, limit=MAX_REPR_CHARACTERS):
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def safe_repr(value):
    try:
        return clipped(repr(value))
    except BaseException as exc:  # User-defined repr can raise arbitrary exceptions.
        return "<repr failed: " + type(exc).__name__ + ">"


def variable_shape(value):
    try:
        shape = getattr(value, "shape", None)
        if shape is not None:
            return [int(item) for item in tuple(shape)[:8]]
    except BaseException:
        pass
    try:
        if isinstance(value, (str, bytes, bytearray, list, tuple, dict, set, frozenset)):
            return [len(value)]
    except BaseException:
        pass
    return None


def variable_bytes(value):
    try:
        size = getattr(value, "nbytes", None)
        if size is not None:
            return max(0, int(size))
    except BaseException:
        pass
    return None


def inspect_variables():
    records = []
    names = [name for name in sorted(NAMESPACE) if not name.startswith("_")]
    for name in names[:MAX_VARIABLES]:
        value = NAMESPACE[name]
        value_type = type(value)
        records.append({
            "name": clipped(name, 160),
            "type": clipped(value_type.__module__ + "." + value_type.__qualname__, 240),
            "repr": safe_repr(value),
            "shape": variable_shape(value),
            "bytes": variable_bytes(value),
        })
    return records, len(names) > MAX_VARIABLES


def imported_roots(tree):
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            roots.add(node.module.split(".", 1)[0])
    return sorted(roots)


def dependency_records(names):
    global _PACKAGE_DISTRIBUTIONS
    if not names:
        return []
    if _PACKAGE_DISTRIBUTIONS is None:
        try:
            _PACKAGE_DISTRIBUTIONS = importlib.metadata.packages_distributions()
        except BaseException:
            _PACKAGE_DISTRIBUTIONS = {}
    records = []
    for name in names[:MAX_DEPENDENCIES]:
        distributions = _PACKAGE_DISTRIBUTIONS.get(name, [])
        version = None
        distribution = None
        for candidate in distributions:
            try:
                version = importlib.metadata.version(candidate)
                distribution = candidate
                break
            except importlib.metadata.PackageNotFoundError:
                continue
        if version is None:
            module = sys.modules.get(name)
            version = getattr(module, "__version__", None) if module else None
        records.append({
            "name": clipped(name, 160),
            "distribution": clipped(distribution, 160) if distribution else None,
            "version": clipped(version, 160) if version is not None else None,
        })
    return records


def capture_figures(directory, errors):
    artifacts = []
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return artifacts
    try:
        numbers = list(pyplot.get_fignums())
    except BaseException as exc:
        errors.write("ScienceCode could not inspect matplotlib figures: " + str(exc) + "\n")
        return artifacts
    os.makedirs(directory, exist_ok=True)
    for index, number in enumerate(numbers[:MAX_FIGURES], start=1):
        filename = "figure-" + str(index).zfill(2) + ".png"
        target = os.path.join(directory, filename)
        try:
            figure = pyplot.figure(number)
            figure.savefig(target, format="png", dpi=120, bbox_inches="tight")
            artifacts.append({"name": filename, "media_type": "image/png"})
        except BaseException as exc:
            errors.write("ScienceCode could not capture figure " + str(number) + ": " + str(exc) + "\n")
        finally:
            try:
                pyplot.close(number)
            except BaseException:
                pass
    if len(numbers) > MAX_FIGURES:
        errors.write("ScienceCode captured the first " + str(MAX_FIGURES) + " figures; additional figures were omitted.\n")
    return artifacts


def evaluate(code, filename):
    tree = ast.parse(code, filename=filename, mode="exec")
    body = list(tree.body)
    result = None
    visible = False
    if body and isinstance(body[-1], ast.Expr):
        prefix = ast.Module(body=body[:-1], type_ignores=tree.type_ignores)
        if prefix.body:
            exec(compile(prefix, filename, "exec"), NAMESPACE, NAMESPACE)
        expression = ast.Expression(body=body[-1].value)
        result = eval(compile(expression, filename, "eval"), NAMESPACE, NAMESPACE)
        visible = result is not None
    else:
        exec(compile(tree, filename, "exec"), NAMESPACE, NAMESPACE)
    return result, visible, tree


def execute(request_directory):
    source_file = os.path.join(request_directory, "source.py")
    artifacts_directory = os.path.join(request_directory, "artifacts")
    result_file = os.path.join(request_directory, "result.json")
    stdout_file = os.path.join(request_directory, "stdout.txt")
    stderr_file = os.path.join(request_directory, "stderr.txt")
    with open(source_file, "r", encoding="utf-8") as handle:
        code = handle.read()
    output = BoundedText()
    errors = BoundedText()
    started = time.perf_counter()
    status = "completed"
    result_value = None
    result_visible = False
    result_type = None
    result_repr = None
    error = None
    tree = None
    original_input = builtins.input

    def disabled_input(*_args, **_kwargs):
        raise RuntimeError("Interactive stdin is disabled in ScienceCode project kernels.")

    try:
        builtins.input = disabled_input
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            result_value, result_visible, tree = evaluate(code, source_file)
        if result_visible:
            result_type = type(result_value).__module__ + "." + type(result_value).__qualname__
            result_repr = safe_repr(result_value)
    except BaseException as exc:
        status = "error"
        error = {
            "type": clipped(type(exc).__module__ + "." + type(exc).__qualname__, 240),
            "message": clipped(str(exc), 4_000),
            "traceback": clipped("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)), 32_000),
        }
    finally:
        builtins.input = original_input

    artifacts = capture_figures(artifacts_directory, errors)
    variables, variables_truncated = inspect_variables()
    dependencies = dependency_records(imported_roots(tree)) if tree is not None else []
    response = {
        "protocol_version": 1,
        "language": "python",
        "language_version": platform.python_version(),
        "implementation": platform.python_implementation(),
        "status": status,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "stdout_truncated": output.truncated,
        "stderr_truncated": errors.truncated,
        "result": {
            "visible": result_visible,
            "type": clipped(result_type, 240) if result_type else None,
            "repr": result_repr,
        },
        "error": error,
        "variables": variables,
        "variables_truncated": variables_truncated,
        "dependencies": dependencies,
        "artifacts": artifacts,
    }
    with open(stdout_file, "w", encoding="utf-8", newline="") as handle:
        handle.write(output.value())
    with open(stderr_file, "w", encoding="utf-8", newline="") as handle:
        handle.write(errors.value())
    with open(result_file, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(response, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main():
    emit("READY", "python", platform.python_version(), os.getpid())
    for raw_line in sys.stdin:
        line = raw_line.rstrip("\r\n")
        if line == "SHUTDOWN":
            emit("BYE")
            return 0
        parts = line.split("\t", 2)
        if len(parts) != 3 or parts[0] != "EXEC":
            emit("PROTOCOL_ERROR", "invalid_request")
            continue
        request_id, request_directory = parts[1], parts[2]
        try:
            execute(request_directory)
            emit("DONE", request_id)
        except BaseException as exc:
            try:
                with open(os.path.join(request_directory, "worker-error.txt"), "w", encoding="utf-8") as handle:
                    handle.write(type(exc).__name__ + ": " + str(exc) + "\n")
                    handle.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
            except BaseException:
                pass
            emit("FAILED", request_id, type(exc).__name__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

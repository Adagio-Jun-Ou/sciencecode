"""ScienceCode's bounded CadQuery probe and build adapter.

The adapter intentionally does not claim to sandbox user Python. The Node runtime
executes it against an immutable declared-source snapshot with a wall-clock limit
and records every generated artifact and tool output.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import re
import runpy
import sys
from typing import Any

sys.dont_write_bytecode = True

RESULT_PREFIX = "SCIENCECODE_CADQUERY_RESULT_JSON="


def _version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _emit(payload: dict[str, Any]) -> None:
    print(RESULT_PREFIX + json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _probe() -> int:
    import cadquery as cq

    sample = cq.Workplane("XY").box(1, 2, 3)
    shape = sample.val()
    payload = {
        "ok": bool(shape.isValid()),
        "python": sys.version.split()[0],
        "cadquery_version": _version("cadquery"),
        "cadquery_ocp_version": _version("cadquery-ocp"),
        "vtk_version": _version("vtk"),
        "sample_valid": bool(shape.isValid()),
        "sample_volume_mm3": float(shape.Volume()),
    }
    _emit(payload)
    return 0 if payload["ok"] else 1


def _inside(root: Path, candidate: Path, label: str) -> Path:
    root = root.resolve(strict=True)
    candidate = candidate.resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{label} escapes the declared source snapshot") from exc
    return candidate


def _shape_for_export(cq: Any, model: Any) -> tuple[Any, str, int]:
    if isinstance(model, cq.Assembly):
        shape = model.toCompound()
        return shape, "Assembly", len(model.objects)
    if isinstance(model, cq.Workplane):
        values = [value for value in model.vals() if isinstance(value, cq.Shape)]
        if not values:
            raise TypeError("CadQuery Workplane contains no exportable shapes")
        shape = values[0] if len(values) == 1 else cq.Compound.makeCompound(values)
        return shape, "Workplane", len(values)
    if isinstance(model, cq.Shape):
        return model, type(model).__name__, 1
    raise TypeError(
        "CadQuery build result must be a Workplane, Shape, or Assembly; got "
        + type(model).__name__
    )


def _local_modules(root: Path) -> list[str]:
    records: list[str] = []
    root = root.resolve()
    for name, module in sorted(sys.modules.items()):
        location = getattr(module, "__file__", None)
        if not location:
            continue
        try:
            relative = Path(location).resolve().relative_to(root)
        except (OSError, ValueError):
            continue
        records.append(name + ":" + relative.as_posix())
    return records


def _canonicalize_step_header(step: Path) -> None:
    text = step.read_text(encoding="utf-8")
    pattern = r"(FILE_NAME\s*\(\s*'(?:''|[^'])*'\s*,\s*)'(?:''|[^'])*'"
    canonical, count = re.subn(
        pattern, r"\1'1970-01-01T00:00:00'", text, count=1, flags=re.IGNORECASE
    )
    if count != 1:
        raise ValueError("STEP export is missing a canonicalizable FILE_NAME timestamp")
    step.write_text(canonical, encoding="utf-8", newline="\n")


def _build(args: argparse.Namespace) -> int:
    import cadquery as cq

    source_root = Path(args.source_root).resolve(strict=True)
    entry = _inside(source_root, source_root / args.entry, "entry")
    if not entry.is_file() or entry.suffix.lower() != ".py":
        raise ValueError("CadQuery entry must be a regular .py file")
    stl = _inside(Path(args.output_root), Path(args.stl), "STL output")
    step = _inside(Path(args.output_root), Path(args.step), "STEP output")
    stl.parent.mkdir(parents=True, exist_ok=True)
    step.parent.mkdir(parents=True, exist_ok=True)
    parameters_file = _inside(Path(args.output_root), Path(args.parameters_file), "parameters file")
    parameters = json.loads(parameters_file.read_text(encoding="utf-8"))
    if not isinstance(parameters, dict):
        raise TypeError("CadQuery parameters must decode to a JSON object")

    os.chdir(source_root)
    sys.path.insert(0, str(source_root))
    namespace = runpy.run_path(
        str(entry),
        init_globals={
            "SCIENCECODE_PARAMETERS": parameters,
            "SCIENCECODE_SOURCE_ROOT": str(source_root),
        },
        run_name="__sciencecode_cadquery__",
    )
    builder = namespace.get("build")
    model = builder(parameters) if callable(builder) else namespace.get("result")
    if model is None:
        raise ValueError("CadQuery entry must define build(parameters) or result")
    shape, object_type, object_count = _shape_for_export(cq, model)
    if not shape.isValid():
        raise ValueError("CadQuery produced an invalid OpenCascade shape")

    # Export the validated compound directly. Assembly color-style records are
    # emitted in nondeterministic order by OCCT, while compound STEP geometry is
    # stable and still preserves separate solids. Names are recorded below.
    cq.exporters.export(shape, str(step), exportType="STEP")
    _canonicalize_step_header(step)
    exported = shape.exportStl(
        str(stl),
        tolerance=args.linear_tolerance,
        angularTolerance=args.angular_tolerance,
        ascii=True,
        relative=False,
        parallel=False,
    )
    if exported is False or not stl.is_file() or not step.is_file():
        raise RuntimeError("CadQuery did not produce both STL and STEP outputs")

    solids = list(shape.Solids())
    faces = list(shape.Faces())
    payload = {
        "ok": True,
        "python": sys.version.split()[0],
        "cadquery_version": _version("cadquery"),
        "cadquery_ocp_version": _version("cadquery-ocp"),
        "object_type": object_type,
        "object_count": object_count,
        "assembly_object_names": sorted(model.objects) if isinstance(model, cq.Assembly) else [],
        "step_semantics": "compound_geometry_with_separate_solids_names_recorded_in_report",
        "shape_valid": bool(shape.isValid()),
        "solid_count": len(solids),
        "face_count": len(faces),
        "volume_mm3": float(shape.Volume()),
        "area_mm2": float(shape.Area()),
        "linear_tolerance_mm": args.linear_tolerance,
        "angular_tolerance_rad": args.angular_tolerance,
        "step_header_timestamp": "1970-01-01T00:00:00",
        "local_modules": _local_modules(source_root),
        "outputs": {
            "stl": stl.name,
            "step": step.name,
            "stl_bytes": stl.stat().st_size,
            "step_bytes": step.stat().st_size,
        },
    }
    _emit(payload)
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sciencecode-cadquery-adapter")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("probe")
    build = subparsers.add_parser("build")
    build.add_argument("--source-root", required=True)
    build.add_argument("--output-root", required=True)
    build.add_argument("--entry", required=True)
    build.add_argument("--stl", required=True)
    build.add_argument("--step", required=True)
    build.add_argument("--parameters-file", required=True)
    build.add_argument("--linear-tolerance", type=float, default=0.05)
    build.add_argument("--angular-tolerance", type=float, default=0.1)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "probe":
            return _probe()
        return _build(args)
    except Exception as exc:  # The Node caller records the bounded stderr and status.
        _emit({
            "ok": False,
            "error": type(exc).__name__ + ": " + str(exc),
            "python": sys.version.split()[0],
            "cadquery_version": _version("cadquery"),
            "cadquery_ocp_version": _version("cadquery-ocp"),
        })
        print(type(exc).__name__ + ": " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Spectral estimation on a known synthetic signal with SciPy cross-checks.

A seeded multi-tone signal with additive Gaussian noise is analyzed with a
Welch power spectral density and a windowed periodogram. Fidelity is bounded
against ground truth the script itself constructed: recovered tone
frequencies vs the true tones, and a Parseval residual between time-domain
power and integrated PSD. This validates the estimation pipeline on a signal
whose answer is known; it makes no claim about any real measurement.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time

import numpy as np
from scipy import signal as sig


def bounded_float(parameters: dict, name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(parameters.get(name, default))
    if not np.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    sample_rate = bounded_float(parameters, "sample_rate_hz", 1_000.0, 10.0, 1e6)
    duration = bounded_float(parameters, "duration_s", 8.0, 0.5, 600.0)
    noise_sigma = bounded_float(parameters, "noise_sigma", 0.5, 0.0, 10.0)
    tone1 = bounded_float(parameters, "tone1_hz", 50.0, 0.1, sample_rate / 2.5)
    tone2 = bounded_float(parameters, "tone2_hz", 120.0, 0.1, sample_rate / 2.5)
    amplitude1 = bounded_float(parameters, "amplitude1", 1.0, 0.01, 100.0)
    amplitude2 = bounded_float(parameters, "amplitude2", 0.5, 0.01, 100.0)
    segment = int(bounded_float(parameters, "welch_segment", 2_048, 64, 65_536))
    rng = np.random.default_rng(seed)
    count = int(sample_rate * duration)
    if count > 20_000_000:
        raise ValueError(
            "sample_rate_hz * duration_s must stay at or below 20e6 samples"
        )
    # Validate against the effective segment the estimator will actually use.
    effective_segment = min(segment, count)
    if abs(tone1 - tone2) < 2.0 * sample_rate / effective_segment:
        raise ValueError(
            "tones must be separated by at least two Welch frequency bins "
            f"({2.0 * sample_rate / effective_segment:.4g} Hz at nperseg={effective_segment})"
        )
    times = np.arange(count) / sample_rate
    clean = (amplitude1 * np.sin(2.0 * np.pi * tone1 * times) +
             amplitude2 * np.sin(2.0 * np.pi * tone2 * times))
    noisy = clean + rng.normal(0.0, noise_sigma, size=count)

    started = time.perf_counter()
    frequencies, psd = sig.welch(
        noisy, fs=sample_rate, window="hann",
        nperseg=min(segment, count), detrend="constant", scaling="density",
    )
    perio_frequencies, periodogram = sig.periodogram(
        noisy, fs=sample_rate, window="hann", detrend="constant", scaling="density",
    )
    elapsed_seconds = time.perf_counter() - started

    def recovered_peaks(freqs: np.ndarray, density: np.ndarray, label: str) -> list[float]:
        peaks, _ = sig.find_peaks(density, height=float(np.max(density)) * 0.05)
        ranked = peaks[np.argsort(density[peaks])[::-1]][:2]
        if len(ranked) != 2:
            raise RuntimeError(
                f"{label} recovered {len(ranked)} peak(s) instead of 2; the "
                "estimation pipeline failed on this parameterisation"
            )
        return sorted(float(freqs[index]) for index in ranked)

    welch_peaks = recovered_peaks(frequencies, psd, "Welch")
    perio_peaks = recovered_peaks(perio_frequencies, periodogram, "periodogram")
    truth = sorted([tone1, tone2])
    welch_error = float(max(abs(estimate - exact)
                            for estimate, exact in zip(welch_peaks, truth)))
    perio_error = float(max(abs(estimate - exact)
                            for estimate, exact in zip(perio_peaks, truth)))

    time_power = float(np.mean(noisy * noisy))
    # Trapezoidal integral written out so it works on any numpy 1.x/2.x.
    psd_power = float(np.sum((psd[1:] + psd[:-1]) / 2.0 * np.diff(frequencies)))
    parseval_residual = abs(time_power - psd_power) / time_power

    # Archive the spectral estimate and a bounded signal preview, not the full
    # time series: at the sample cap the raw series would be ~250 MB of
    # immutably hashed artifact per branch while adding nothing the
    # diagnostics need.
    preview = min(count, 16_384)
    np.savez_compressed(
        output_directory / "signal-analysis.npz",
        times_preview=times[:preview], noisy_preview=noisy[:preview],
        frequencies=frequencies, psd=psd,
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axes = plt.subplots(1, 2, figsize=(11, 4.5))
    axes[0].plot(times[:int(sample_rate / 10)], noisy[:int(sample_rate / 10)], linewidth=0.7)
    axes[0].set_xlabel("time [s]")
    axes[0].set_ylabel("amplitude")
    axes[0].set_title("first 100 ms of the noisy signal")
    axes[1].semilogy(frequencies, psd)
    for tone in truth:
        axes[1].axvline(tone, linestyle="--", linewidth=0.8)
    axes[1].set_xlabel("frequency [Hz]")
    axes[1].set_ylabel("PSD [V^2/Hz]")
    axes[1].set_title("Welch PSD vs true tones (dashed)")
    figure.tight_layout()
    figure.savefig(output_directory / "signal-analysis.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Seeded multi-tone recovery, SciPy Welch vs periodogram vs ground truth",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "sample_rate_hz": sample_rate, "duration_s": duration,
            "noise_sigma": noise_sigma, "tone1_hz": tone1, "tone2_hz": tone2,
            "amplitude1": amplitude1, "amplitude2": amplitude2,
            "welch_segment": segment,
        },
        "final_statistics": {
            "welch_frequency_error": {"value": welch_error, "unit": "Hz"},
            "periodogram_frequency_error": {"value": perio_error, "unit": "Hz"},
            "parseval_residual": {"value": parseval_residual, "unit": "1"},
            "recovered_tone_low": {"value": welch_peaks[0], "unit": "Hz"},
            "recovered_tone_high": {"value": welch_peaks[1], "unit": "Hz"},
            "time_domain_power": {"value": time_power, "unit": "1"},
        },
        "artifacts": ["signal-analysis.png", "signal-analysis.npz", "summary.json"],
        "interpretation": "Estimation pipeline validated on a self-constructed signal with a known answer; no claim about any real measurement.",
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()

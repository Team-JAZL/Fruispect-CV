#!/usr/bin/env python3
"""Display and export Figure 31 as a grouped bar chart of joint accuracy.

Requires only matplotlib: python -m pip install matplotlib
Run from the repository root::

    python scripts/graph-reworks/plot_stress_joint.py
    python scripts/graph-reworks/plot_stress_joint.py --no-show

Defaults resolve relative to this file, so an absolute script path also works
from any working directory. The source is the controlled stress-test CSV in
trained-outputs/tables. Bars retain the source precision; labels show two decimal
places. An interactive window opens by default, and a vector PDF plus a 300 dpi
PNG are saved with a distinct _reworked filename beside the original figure.
No application modules, training code, pandas, or network access are needed.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TABLE = ROOT / "trained-outputs" / "tables" / "table_09_controlled_stress_tests.csv"
DEFAULT_OUTPUT = ROOT / "trained-outputs" / "figures"
OUTPUT_STEM = "fig_31_stress_joint_reworked"
MODELS = ("ResNet-18", "MobileNetV3-Small", "EfficientNet-B0")
COLORS = ("#245E79", "#B4662E", "#347D65")
INK = "#202D3A"
MUTED = "#596878"


@dataclass(frozen=True)
class StressResult:
    model: str
    condition: str
    joint_accuracy: float


def load_results(path: Path) -> list[StressResult]:
    """Require one finite, valid accuracy for every model-condition pair."""
    results = []
    seen = set()
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        required = {"model", "condition", "joint_accuracy"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Table must contain columns: {', '.join(sorted(required))}")
        for line, row in enumerate(reader, start=2):
            model = (row["model"] or "").strip()
            condition = (row["condition"] or "").strip()
            if model not in MODELS or not condition:
                raise ValueError(f"Line {line}: expected a supported model and a condition.")
            key = (model, condition)
            if key in seen:
                raise ValueError(f"Line {line}: duplicate model-condition pair {key}.")
            try:
                accuracy = float(row["joint_accuracy"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Line {line}: joint_accuracy must be numeric.") from exc
            if not math.isfinite(accuracy) or not 0 <= accuracy <= 1:
                raise ValueError(f"Line {line}: joint_accuracy must be between 0 and 1.")
            results.append(StressResult(model, condition, accuracy))
            seen.add(key)
    if not results:
        raise ValueError("The stress-test table is empty.")
    for condition in dict.fromkeys(result.condition for result in results):
        for model in MODELS:
            if (model, condition) not in seen:
                raise ValueError(f"Missing result for {model} under {condition}.")
    return results


def build_figure(results: list[StressResult], source_name: str):
    """Use three separate bars per condition, ordered exactly as in the table."""
    import matplotlib.pyplot as plt
    from matplotlib.ticker import PercentFormatter

    conditions = list(dict.fromkeys(result.condition for result in results))
    lookup = {(result.model, result.condition): result.joint_accuracy for result in results}
    style = {
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "text.color": INK,
        "axes.labelcolor": MUTED,
        "xtick.color": INK,
        "ytick.color": MUTED,
    }
    with plt.rc_context(style):
        fig, ax = plt.subplots(figsize=(max(14.5, len(conditions) * 2.4), 8.4))
        fig.set_facecolor("white")
        fig.subplots_adjust(left=0.085, right=0.975, bottom=0.245, top=0.735)

        fig.text(0.04, 0.955, "FIGURE 31  /  CONTROLLED STRESS TESTS",
                 fontsize=10, fontweight="bold", color=MUTED)
        fig.text(0.04, 0.899, "Joint accuracy under controlled stress",
                 fontsize=23, fontweight="bold")
        fig.text(0.04, 0.852,
                 "Three architectures evaluated on the same held-out images",
                 fontsize=11, color=MUTED)

        for model_index, (model, color) in enumerate(zip(MODELS, COLORS)):
            positions = [index + (model_index - 1) * 0.28 for index in range(len(conditions))]
            percentages = [lookup[(model, condition)] * 100 for condition in conditions]
            bars = ax.bar(positions, percentages, width=0.245, color=color,
                          edgecolor="white", linewidth=0.7, label=model, zorder=3)
            ax.bar_label(bars, labels=[f"{value:.2f}%" for value in percentages],
                         padding=5, fontsize=9, fontweight="bold", color=color)

        # The zero baseline preserves magnitude, while headroom holds bar labels.
        ax.set_ylim(0, 107)
        ax.set_yticks(range(0, 101, 20))
        ax.yaxis.set_major_formatter(PercentFormatter(xmax=100, decimals=0))
        ax.set_ylabel("Joint accuracy", fontsize=12, labelpad=14)
        ax.set_xlim(-0.62, len(conditions) - 0.38)
        ax.set_xticks(range(len(conditions)), labels=conditions, fontsize=11)
        ax.set_xlabel("Stress condition", fontsize=11, labelpad=14)
        ax.tick_params(axis="x", length=0, pad=12)
        ax.tick_params(axis="y", length=0, pad=9)
        ax.set_axisbelow(True)
        ax.yaxis.grid(True, color="#E5EAF0", linewidth=0.8)
        for spine in ("top", "right", "left"):
            ax.spines[spine].set_visible(False)
        ax.spines["bottom"].set_color("#CED6DE")

        handles, labels = ax.get_legend_handles_labels()
        fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.035, 0.811),
                   ncol=3, frameon=False, fontsize=11, handlelength=1.5,
                   handleheight=1.0, columnspacing=3.2, borderaxespad=0)

        fig.text(0.04, 0.132,
                 "Joint accuracy requires both fruit and quality predictions to be correct.",
                 fontsize=10, color=MUTED)
        fig.text(0.04, 0.095,
                 "Bar heights retain source precision; percentage labels are rounded to two decimal places.",
                 fontsize=10, color=MUTED)
        fig.text(0.04, 0.04, f"Source: {source_name}", fontsize=9, color=MUTED)
    return fig


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", type=Path, default=DEFAULT_TABLE, help="Source stress-test CSV.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT,
                        help="Directory for the reworked PDF and PNG.")
    parser.add_argument("--dpi", type=int, default=300, help="PNG resolution (default: 300).")
    parser.add_argument("--no-show", action="store_true", help="Export without opening a window.")
    args = parser.parse_args(argv)
    if args.dpi < 72:
        parser.error("--dpi must be at least 72.")
    try:
        results = load_results(args.table)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    import matplotlib
    if args.no_show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        source_name = args.table.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        source_name = args.table.name
    fig = build_figure(results, source_name)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for extension in ("pdf", "png"):
        destination = args.output_dir / f"{OUTPUT_STEM}.{extension}"
        options = {"dpi": args.dpi} if extension == "png" else {
            "metadata": {"Title": "Figure 31 - Controlled stress-test joint accuracy",
                         "Subject": f"Grouped bars from {source_name}"}
        }
        with matplotlib.rc_context({"pdf.fonttype": 42, "ps.fonttype": 42}):
            fig.savefig(destination, facecolor="white", **options)
        print(f"Saved: {destination.resolve()}")
    if not args.no_show:
        plt.show()
    plt.close(fig)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

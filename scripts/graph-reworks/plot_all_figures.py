#!/usr/bin/env python3
"""Rebuild all 31 training figures from CSVs with one consistent design.

Install: python -m pip install matplotlib numpy
Run from the repository root (absolute script paths work from any directory)::

    python scripts/graph-reworks/plot_all_figures.py --no-show
    python scripts/graph-reworks/plot_all_figures.py --figures 2 13 31
    python scripts/graph-reworks/plot_all_figures.py --list

Without --no-show, each chart opens in turn; close its window to continue.
Default output: trained-outputs/figures/reworked. Exports a vector PDF and a
300 dpi PNG per figure, an all_figures_reworked.pdf review book, and a JSON
catalog with source hashes, plotted values, derivations and layout checks.
--figures selects a subset; its review book and catalog contain only that subset.

Categorical comparisons use grouped bars with zero baselines. Confusion matrices
retain all cells; learning curves retain every epoch; reliability diagrams retain
confidence/accuracy coordinates and bin support. Bar heights are never rounded.
Only display labels are rounded. No smoothing, new training, downloads, pandas,
application modules, or imports from the other rework scripts are required.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import textwrap


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "trained-outputs"
MODELS = ("ResNet-18", "MobileNetV3-Small", "EfficientNet-B0")
ARCHITECTURES = ("resnet18", "mobilenet_v3_small", "efficientnet_b0")
FRUITS = ("Apple", "Banana", "Guava", "Lime", "Orange", "Pomegranate")
COLORS = ("#245E79", "#B4662E", "#347D65")
SPLIT_COLORS = (COLORS[0], "#9DD5D3", "#A95C2B")
INK, MUTED, GRID = "#202D3A", "#596878", "#E5EAF0"
STYLE = {
    "font.family": "DejaVu Sans", "font.size": 11, "text.color": INK,
    "axes.labelcolor": MUTED, "xtick.color": INK, "ytick.color": MUTED,
    "pdf.fonttype": 42, "ps.fonttype": 42, "figure.facecolor": "white",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.spines.left": False, "axes.edgecolor": "#CED6DE",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(row, key, *, probability=False, integer=False):
    try:
        value = float(row[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Missing/invalid numeric field {key!r}: {row}") from exc
    require(math.isfinite(value), f"Nonfinite {key}: {row}")
    if probability:
        require(0 <= value <= 1, f"Probability outside [0, 1] for {key}: {value}")
    if integer:
        require(value >= 0 and value.is_integer(), f"Expected nonnegative integer {key}")
        return int(value)
    return value


def indexed(rows, *keys):
    result = {}
    for row in rows:
        key = tuple(row[k] for k in keys)
        require(key not in result, f"Duplicate record for {keys}: {key}")
        result[key] = row
    return result


class Sources:
    def __init__(self, root):
        self.root = root
        self.used = set()
        self.cache = {}

    def table(self, name):
        relative = name if "/" in name else f"tables/{name}"
        self.used.add(relative)
        if relative not in self.cache:
            with (self.root / relative).open(newline="", encoding="utf-8-sig") as stream:
                rows = list(csv.DictReader(stream))
            require(bool(rows), f"Empty source table: {relative}")
            self.cache[relative] = rows
        return self.cache[relative]

    def primary(self):
        rows = indexed(self.table("table_01_primary_model_comparison.csv"), "model")
        require(set(rows) == {(m,) for m in MODELS}, "Expected the three primary models")
        return [rows[(model,)] for model in MODELS]

    def history(self, model_index):
        selected = self.primary()[model_index]
        seed = number(selected, "selected_seed", integer=True)
        rows = self.table(f"runs/{ARCHITECTURES[model_index]}_seed{seed}_history.csv")
        epochs = [number(row, "epoch", integer=True) for row in rows]
        require(epochs == sorted(set(epochs)) and min(epochs) > 0,
                "History epochs must be positive, unique and ordered")
        best = number(selected, "best_epoch", integer=True)
        require(best in epochs, f"Selected epoch {best} absent from history")
        return rows, best, seed


def shell(n, title, subtitle, *, size=(15.5, 8.4), rows=1, cols=1,
          left=0.085, bottom=0.245, top=0.735, wspace=0.30, hspace=0.65,
          note="", legend=None):
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    fig, axes = plt.subplots(rows, cols, figsize=size, squeeze=False)
    fig.subplots_adjust(left=left, right=0.975, bottom=bottom, top=top,
                        wspace=wspace, hspace=hspace)
    fig.text(0.04, 0.955, f"FIGURE {n:02d}  /  FRUISPECT EVALUATION",
             fontsize=10, fontweight="bold", color=MUTED)
    fig.text(0.04, 0.899, title, fontsize=22, fontweight="bold")
    fig.text(0.04, 0.852, subtitle, fontsize=11, color=MUTED)
    if legend:
        labels, colors = legend
        fig.legend([Patch(facecolor=c) for c in colors], labels, loc="upper left",
                   bbox_to_anchor=(0.035, 0.811), ncol=min(4, len(labels)),
                   frameon=False, fontsize=11, handlelength=1.5,
                   handleheight=1, columnspacing=2.8, borderaxespad=0)
    if note:
        fig.text(0.04, 0.135, textwrap.fill(note, 132), fontsize=10, color=MUTED,
                 linespacing=1.5, va="top")
    # Sources are filled after chart construction so every loaded CSV is included.
    fig._rework = {"figure": n, "title": title, "data": [], "derivations": []}
    fig._inside_labels = []
    return fig, axes


def audit(fig, label, values, **extra):
    fig._rework["data"].append({"label": label, "values": values, **extra})


def finish_sources(fig, sources):
    paths = sorted(sources.used)
    # CSV names alone are sufficient here; exact relative paths/hashes go in JSON.
    names = "; ".join(Path(path).name for path in paths)
    if len(names) > 155:
        if all("history.csv" in path or "primary_model" in path for path in paths):
            names = "selected-seed history CSVs; table_01_primary_model_comparison.csv"
        elif all("class_report.csv" in path for path in paths):
            task = "fruit" if "fruit" in paths[0] else "quality"
            names = f"{task}_class_report.csv for each architecture (tables/)"
        else:
            names = "; ".join(Path(path).name for path in paths[:2]) + "; full source map in rework_catalog.json"
    fig.text(0.04, 0.035, "Source: " + names, fontsize=9, color=MUTED)
    fig._rework["sources"] = [
        {"path": path, "sha256": hashlib.sha256((sources.root / path).read_bytes()).hexdigest()}
        for path in paths
    ]


def clean_axis(ax, *, percent=False, horizontal=False):
    from matplotlib.ticker import PercentFormatter, MaxNLocator
    ax.set_axisbelow(True)
    axis = ax.xaxis if horizontal else ax.yaxis
    axis.grid(True, color=GRID, linewidth=0.8)
    ax.tick_params(axis="both", length=0, pad=9, labelsize=10)
    if percent:
        axis.set_major_formatter(PercentFormatter(xmax=100, decimals=0))
        if horizontal:
            ax.set_xticks(range(0, 101, 20))
        else:
            ax.set_yticks(range(0, 101, 20))
    else:
        axis.set_major_locator(MaxNLocator(nbins=5))


def grouped(fig, ax, categories, series, *, colors=COLORS, percent=True,
            ylabel="Accuracy", label_size=9, inside=False, errors=None,
            count_labels=None):
    """Plot unrounded values; series is [(name, numeric values), ...]."""
    import numpy as np
    series_count = len(series)
    step = 0.30 if series_count == 3 else 0.34
    width = 0.245 if series_count == 3 else step * 0.875
    high = 0
    for index, (name, values) in enumerate(series):
        require(len(values) == len(categories), f"Length mismatch: {name}")
        positions = np.arange(len(categories)) + (index - (series_count - 1) / 2) * step
        error = None if errors is None else errors[index]
        bars = ax.bar(positions, values, width=width, label=name, color=colors[index],
                      edgecolor="white", linewidth=0.7, zorder=3,
                      yerr=error, error_kw={"ecolor": INK, "capsize": 3, "elinewidth": 1})
        require(all(math.isclose(bar.get_height(), value, abs_tol=1e-12)
                    for bar, value in zip(bars, values)), "Bar height changed during rendering")
        labels = [f"{value:.2f}%" if percent else f"{value:,.0f}" for value in values]
        if count_labels is not None:
            labels = [f"{label}\n(n={count:,})" for label, count in zip(labels, count_labels[index])]
        if inside:
            for bar, label in zip(bars, labels):
                text = ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() - 7,
                               label, ha="center", va="top", color="white", fontsize=label_size,
                               fontweight="bold")
                fig._inside_labels.append((text, bar))
        else:
            ax.bar_label(bars, labels=labels, padding=5, fontsize=label_size,
                         color=colors[index], fontweight="bold", linespacing=1.4)
        audit(fig, name, list(values), categories=list(categories))
        high = max(high, max(values))
    ax.set_xticks(range(len(categories)), labels=categories, fontsize=11)
    ax.set_xlim(-0.62, len(categories) - 0.38)
    ax.set_ylim(0, 112 if count_labels is not None else (107 if percent else high * 1.16))
    ax.set_ylabel(ylabel, labelpad=13, fontsize=11)
    clean_axis(ax, percent=percent)


def inventory(s):
    rows = indexed(s.table("verified_class_inventory.csv"), "fruit", "quality")
    series = [(quality, [number(rows[(fruit, quality)], "usable_unique_images", integer=True)
                         for fruit in FRUITS]) for quality in ("Good", "Bad")]
    fig, axes = shell(1, "Fruit-quality image inventory",
                      "Usable unique photographs after the exact-duplicate audit",
                      legend=(["Good quality", "Bad quality"], [COLORS[2], COLORS[1]]),
                      note="Pre-selection image counts. This inventory is not the balanced final dataset.")
    grouped(fig, axes[0, 0], FRUITS, series, colors=(COLORS[2], COLORS[1]),
            percent=False, ylabel="Photographs")
    return fig


def allocation(s):
    rows = indexed(s.table("actual_split_allocation.csv"), "fruit", "quality")
    keys = ("train", "val", "test")
    for row in rows.values():
        require(sum(number(row, key, integer=True) for key in keys) == number(row, "total", integer=True),
                "Split counts do not sum to stratum total")
    totals = [sum(number(row, key, integer=True) for row in rows.values()) for key in keys]
    total = sum(totals)
    labels = [f"{name}: {count:,} ({count / total:.0%})"
              for name, count in zip(("Training", "Validation", "Testing"), totals)]
    fig, axes = shell(2, "Balanced fruit-quality split allocation",
                      f"{total:,} photographs  |  {len(FRUITS)} fruits  |  {len(rows)} fruit-quality strata",
                      left=0.135, cols=2, top=0.70, wspace=0.49, legend=(labels, SPLIT_COLORS),
                      note="Segment labels give exact photograph counts. Group-aware partitioning keeps every whole near-duplicate group in a single split.")
    high = max(number(row, "total", integer=True) for row in rows.values())
    for ax, quality, letter in zip(axes.flat, ("Good", "Bad"), "AB"):
        ax.set_title(f"{letter}   {quality} quality", loc="left", fontsize=14, fontweight="bold", pad=20)
        for y, fruit in enumerate(FRUITS):
            left = 0
            values = [number(rows[(fruit, quality)], key, integer=True) for key in keys]
            for index, value in enumerate(values):
                ax.barh(y, value, left=left, height=0.55, color=SPLIT_COLORS[index],
                        edgecolor="white", linewidth=0.9)
                if value:
                    ax.text(left + value / 2, y, f"{value:,}", ha="center", va="center",
                            fontsize=10, fontweight="bold", color=INK if index == 1 else "white")
                left += value
            audit(fig, f"{fruit} / {quality}", values, splits=list(keys))
        ax.set_yticks(range(len(FRUITS)), labels=FRUITS, fontsize=11)
        ax.set_ylim(len(FRUITS) - 0.35, -0.65)
        ax.set_xlim(0, high * 1.025)
        clean_axis(ax, horizontal=True)
        ax.set_xlabel("Photographs per fruit-quality stratum", labelpad=13, fontsize=10)
    return fig


def wilson(p, n):
    # Rounded CSV proportions correspond to exact integer correct-image counts.
    successes = round(p * n)
    require(abs(successes / n - p) < 1e-7, "Accuracy does not correspond to an integer image count")
    observed = successes / n
    z = 1.959963984540054
    denominator = 1 + z * z / n
    center = (observed + z * z / (2 * n)) / denominator
    half = z * math.sqrt(observed * (1 - observed) / n + z * z / (4 * n * n)) / denominator
    return max(0, center - half), min(1, center + half)


def intervals(s):
    rows = s.primary()
    tasks = ("fruit", "quality", "joint")
    fig, axes = shell(3, "Test accuracy with 95% Wilson intervals",
                      "Held-out image sampling uncertainty for each classification task",
                      legend=(MODELS, COLORS),
                      note="Intervals describe test-image sampling uncertainty, not across-run variability. Fruit and quality intervals use integer correct counts; joint intervals use the supplied table bounds.")
    series, errors = [], []
    for row, model in zip(rows, MODELS):
        values, lower, upper = [], [], []
        for task in tasks:
            p = number(row, task + "_accuracy", probability=True)
            if task == "joint":
                lo, hi = (number(row, "joint_wilson_" + end, probability=True) for end in ("lo", "hi"))
            else:
                lo, hi = wilson(p, number(row, "test_n", integer=True))
            require(lo <= p <= hi, "Invalid Wilson interval")
            values.append(p * 100); lower.append((p - lo) * 100); upper.append((hi - p) * 100)
            audit(fig, f"{model} / {task} Wilson bounds", [lo * 100, hi * 100])
        series.append((model, values)); errors.append([lower, upper])
    grouped(fig, axes[0, 0], [t.title() for t in tasks], series, inside=True, errors=errors)
    fig._rework["derivations"].append("Wilson score interval, z=1.959963984540054; successes=round(accuracy*test_n)")
    return fig


def confusion(s, n):
    import numpy as np
    from matplotlib.colors import LinearSegmentedColormap
    model_index, task_index = divmod(n - 4, 3)
    task = ("fruit", "quality", "joint")[task_index]
    rows = s.table(f"{ARCHITECTURES[model_index]}_{task}_confusion_counts.csv")
    labels = list(rows[0])[1:]
    require([row[""] for row in rows] == labels, "Confusion matrix row/column order mismatch")
    counts = np.array([[number(row, label, integer=True) for label in labels] for row in rows])
    require(counts.shape == (len(labels), len(labels)), "Confusion matrix must be square")
    require(all(counts.sum(axis=1) > 0), "Cannot normalize a zero-support confusion row")
    normalized = counts / counts.sum(axis=1, keepdims=True) * 100
    primary = s.primary()[model_index]
    require(int(counts.sum()) == number(primary, "test_n", integer=True), "Confusion support mismatch")
    require(abs(np.trace(counts) / counts.sum() - number(primary, task + "_accuracy")) < 1e-7,
            "Confusion matrix accuracy differs from primary table")
    joint = task == "joint"
    note = "Rows are actual labels; columns are predicted labels. All cells, including zeros, are shown."
    if joint:
        note += " App=Apple; Ban=Banana; Gua=Guava; Lim=Lime; Ora=Orange; Pom=Pomegranate. G=Good; B=Bad."
    else:
        note += " Row percentages are derived from the exact count matrix."
    fig, axes = shell(n, f"{MODELS[model_index]} {task} confusion matrix",
                      f"Held-out test set  |  {int(counts.sum()):,} photographs",
                      size=(14.5, 12) if joint else ((15, 11.5) if task == "fruit" else (15, 9.4)),
                      cols=1 if joint else 2, left=0.12,
                      bottom=0.27 if task == "fruit" else 0.22,
                      top=0.74, wspace=0.42, note=note)
    cmap = LinearSegmentedColormap.from_list("fruispect", ["#F4F8FA", "#91BDCB", COLORS[0]])
    for index, ax in enumerate(axes.flat):
        matrix = counts if index == 0 else normalized
        upper = int(counts.max()) if index == 0 else 100
        edges = np.arange(len(labels) + 1) - 0.5
        ax.pcolormesh(edges, edges, matrix, cmap=cmap, vmin=0, vmax=upper,
                      shading="flat", rasterized=False)
        ax.set_xlim(-0.5, len(labels) - 0.5)
        ax.set_ylim(len(labels) - 0.5, -0.5)
        ax.set_aspect("equal")
        # Let the count annotations carry exact scale; colorbars would crowd labels.
        ax.set_xticks(range(len(labels)), labels=labels, fontsize=9 if joint else 10)
        ax.set_yticks(range(len(labels)), labels=labels, fontsize=9 if joint else 10)
        if task == "fruit":
            ax.tick_params(axis="x", labelrotation=45)
            for label in ax.get_xticklabels():
                label.set_ha("right")
        ax.tick_params(axis="both", length=0, pad=8)
        ax.set_xlabel("Predicted label", fontsize=11, labelpad=12)
        ax.set_ylabel("Actual label", fontsize=11, labelpad=12)
        ax.set_title("Photograph counts" if index == 0 else "Within-row percentage",
                     loc="left", pad=16, fontsize=13, fontweight="bold")
        for i in range(len(labels)):
            for j in range(len(labels)):
                value = matrix[i, j]
                text = str(int(value)) if index == 0 else f"{value:.1f}%"
                ax.text(j, i, text, ha="center", va="center",
                        fontsize=9 if joint else 11,
                        color="white" if value > upper * 0.56 else (INK if value else "#758593"))
        ax.set_xticks(np.arange(-0.5, len(labels), 1), minor=True)
        ax.set_yticks(np.arange(-0.5, len(labels), 1), minor=True)
        ax.grid(which="minor", color="white", linewidth=1)
        ax.tick_params(which="minor", length=0)
        ax.spines["bottom"].set_visible(False)
    audit(fig, "Exact confusion counts", counts.tolist(), classes=labels)
    if not joint:
        audit(fig, "Row-normalized percentages", normalized.tolist(), classes=labels)
        fig._rework["derivations"].append("row_percentage=100*cell_count/sum(row_counts)")
    return fig


def class_f1(s, n):
    task = "fruit" if n == 13 else "quality"
    categories = FRUITS if task == "fruit" else ("Good", "Bad")
    series = []
    for model, arch in zip(MODELS, ARCHITECTURES):
        rows = indexed(s.table(f"{arch}_{task}_class_report.csv"), "class")
        series.append((model, [number(rows[(label,)], "f1-score", probability=True) * 100
                               for label in categories]))
    fig, axes = shell(n, f"{task.title()} class F1 by architecture",
                      "Held-out test performance  |  One bar per architecture and class",
                      legend=(MODELS, COLORS),
                      note="Class F1 scores come directly from the per-architecture class reports. Aggregate accuracy, macro-average and weighted-average report rows are excluded.")
    grouped(fig, axes[0, 0], categories, series, ylabel="Class F1 (%)")
    return fig


def per_fruit(s, n):
    rows = indexed(s.table("table_03_quality_by_fruit.csv"), "model", "fruit")
    task = "quality" if n == 15 else "joint"
    series = [(model, [number(rows[(model, fruit)], task + "_accuracy", probability=True) * 100
                       for fruit in FRUITS]) for model in MODELS]
    fig, axes = shell(n, f"{task.title()} accuracy by fruit",
                      "Held-out test performance across the three architectures",
                      legend=(MODELS, COLORS),
                      note="Quality accuracy evaluates the Good/Bad prediction. Joint accuracy requires both fruit identity and quality to be correct.")
    grouped(fig, axes[0, 0], FRUITS, series, ylabel=f"{task.title()} accuracy")
    return fig


def taxonomy(s):
    rows = indexed(s.table("table_05_joint_error_taxonomy.csv"), "model", "outcome")
    outcomes = ("both_correct", "fruit_only_wrong", "quality_only_wrong", "both_wrong")
    categories = ("Both correct", "Fruit error only", "Quality error only", "Both wrong")
    series, counts = [], []
    for model in MODELS:
        values = [number(rows[(model, outcome)], "proportion", probability=True) * 100 for outcome in outcomes]
        images = [number(rows[(model, outcome)], "images", integer=True) for outcome in outcomes]
        require(abs(sum(values) - 100) < 1e-5, f"Outcome shares do not sum to 100%: {model}")
        require(all(abs(count / sum(images) * 100 - value) < 1e-5 for count, value in zip(images, values)),
                "Outcome image counts differ from proportions")
        series.append((model, values)); counts.append(images)
    fig, axes = shell(17, "Joint classification outcome breakdown",
                      "Mutually exclusive outcomes on the held-out test set",
                      legend=(MODELS, COLORS),
                      note="Each architecture's four outcome shares sum to 100%. Labels show percentage and exact image count; zero-count categories remain visible as labels.")
    grouped(fig, axes[0, 0], categories, series, ylabel="Share of held-out photographs",
            count_labels=counts)
    for model, values in zip(MODELS, counts):
        audit(fig, f"{model} image counts", values, categories=list(categories))
    return fig


HISTORY_METRICS = ("loss", "fruit_loss", "quality_loss", "joint_accuracy", "fruit_accuracy", "quality_accuracy")
HISTORY_TITLES = ("Combined cross-entropy loss", "Fruit cross-entropy loss", "Quality cross-entropy loss",
                  "Joint accuracy", "Fruit accuracy", "Quality accuracy")


def history_panel(fig, ax, rows, best, metric, *, high=None):
    from matplotlib.ticker import MaxNLocator
    epochs = [number(row, "epoch", integer=True) for row in rows]
    accuracy = metric.endswith("accuracy")
    for split, name, color in zip(("train", "val"), ("Training", "Validation"), COLORS):
        values = [number(row, f"{split}_{metric}", probability=accuracy) * (100 if accuracy else 1) for row in rows]
        ax.plot(epochs, values, color=color, linewidth=1.9,
                linestyle="-" if split == "train" else "--", label=name)
        audit(fig, f"{ax.get_title()} / {split}_{metric}", values, epochs=epochs)
    ax.axvline(best, color="#8693A0", linestyle=":", linewidth=1.3, zorder=0)
    ax.set_xlabel("Epoch", labelpad=10, fontsize=10)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=5, integer=True))
    ax.set_xlim(1, max(epochs))
    if accuracy:
        ax.set_ylim(0, 104)
    else:
        ax.set_ylim(0, high if high is not None else ax.get_ylim()[1] * 1.03)
    clean_axis(ax, percent=accuracy)


def learning(s, n):
    from matplotlib.lines import Line2D
    metric, title = HISTORY_METRICS[n - 18], HISTORY_TITLES[n - 18]
    histories = [s.history(i) for i in range(3)]
    high = None if metric.endswith("accuracy") else max(
        number(row, split + "_" + metric) for rows, _, _ in histories
        for row in rows for split in ("train", "val")) * 1.08
    fig, axes = shell(n, title + " across training",
                      "Training and validation histories  |  Every recorded epoch is retained",
                      size=(15.5, 8.8), cols=3, top=0.68, wspace=0.27,
                      note="Dotted vertical lines mark selected checkpoints: maximum validation joint accuracy, then mean task macro F1. Curves show recorded epochs without smoothing or interpolation.")
    handles = [Line2D([0], [0], color=COLORS[0], lw=2),
               Line2D([0], [0], color=COLORS[1], lw=2, linestyle="--"),
               Line2D([0], [0], color="#8693A0", lw=1.3, linestyle=":")]
    fig.legend(handles, ["Training", "Validation", "Selected checkpoint"], loc="upper left",
               bbox_to_anchor=(0.035, 0.811), ncol=3, frameon=False, columnspacing=2.8)
    max_epoch = max(number(row, "epoch", integer=True) for rows, _, _ in histories for row in rows)
    for ax, model, (rows, best, seed) in zip(axes.flat, MODELS, histories):
        ax.set_title(f"{model}\nSeed {seed}; selected epoch {best}", loc="left",
                     fontsize=12, fontweight="bold", pad=18, linespacing=1.6)
        history_panel(fig, ax, rows, best, metric, high=high)
        ax.set_xlim(1, max_epoch)
    axes[0, 0].set_ylabel("Accuracy" if metric.endswith("accuracy") else "Cross-entropy loss", labelpad=10)
    return fig


def dashboard(s, n):
    from matplotlib.lines import Line2D
    index = n - 24
    rows, best, seed = s.history(index)
    fig, axes = shell(n, f"{MODELS[index]} training diagnostics",
                      f"Seed {seed}  |  Selected checkpoint: epoch {best}  |  All recorded epochs",
                      size=(14.5, 11.5), rows=2, cols=2, bottom=0.22, top=0.73,
                      hspace=0.68, wspace=0.25,
                      note="Dotted lines mark the validation-selected checkpoint. Loss panels show independent task objectives; joint accuracy requires both predictions to be correct.")
    handles = [Line2D([0], [0], color=COLORS[0], lw=2),
               Line2D([0], [0], color=COLORS[1], lw=2, linestyle="--"),
               Line2D([0], [0], color="#8693A0", lw=1.3, linestyle=":")]
    fig.legend(handles, ["Training", "Validation", "Selected checkpoint"], loc="upper left",
               bbox_to_anchor=(0.035, 0.811), ncol=3, frameon=False, columnspacing=2.8)
    for ax, metric, title in zip(axes.flat, HISTORY_METRICS[:4], HISTORY_TITLES[:4]):
        ax.set_title(title, loc="left", fontsize=12, fontweight="bold", pad=16)
        history_panel(fig, ax, rows, best, metric)
        ax.set_ylabel("Accuracy" if metric.endswith("accuracy") else "Loss", labelpad=10)
    return fig


def performance(s):
    rows = s.primary()
    fig, axes = shell(27, "Classification performance by architecture",
                      "Held-out test set  |  Accuracy, macro precision, macro recall and macro F1",
                      size=(16.5, 12), rows=2, cols=2, bottom=0.22, top=0.73,
                      wspace=0.24, hspace=0.68, legend=(MODELS, COLORS),
                      note="Mean tasks is the arithmetic mean of fruit and quality macro F1; it is not a joint-class F1. Joint accuracy requires both predictions to be correct.")
    panels = [
        ("Accuracy", ["Fruit", "Quality", "Joint"], ["fruit_accuracy", "quality_accuracy", "joint_accuracy"]),
        ("Macro precision", ["Fruit", "Quality"], ["fruit_precision_macro", "quality_precision_macro"]),
        ("Macro recall", ["Fruit", "Quality"], ["fruit_recall_macro", "quality_recall_macro"]),
        ("Macro F1", ["Fruit", "Quality", "Mean tasks"], ["fruit_f1_macro", "quality_f1_macro", "mean"]),
    ]
    for ax, (title, categories, keys) in zip(axes.flat, panels):
        ax.set_title(title, loc="left", fontsize=13, fontweight="bold", pad=18)
        series = []
        for model, row in zip(MODELS, rows):
            values = [(number(row, "fruit_f1_macro") + number(row, "quality_f1_macro")) * 50
                      if key == "mean" else number(row, key, probability=True) * 100 for key in keys]
            series.append((model, values))
        grouped(fig, ax, categories, series, ylabel="Score", label_size=9)
    fig._rework["derivations"].append("mean_task_macro_f1=(fruit_f1_macro+quality_f1_macro)/2")
    return fig


def efficiency(s):
    rows = s.primary()
    panels = [
        ("Mean latency", "latency_mean_ms", "ms / image", 1),
        ("P95 latency", "latency_p95_ms", "ms / image", 1),
        ("Batch throughput", "throughput_images_s", "images / second", 1),
        ("Training duration", "training_minutes", "minutes", 1),
        ("Saved checkpoint size", "model_size_mib", "MiB", 1),
        ("Trainable parameters", "trainable_parameters", "millions of parameters", 1e-6),
    ]
    fig, axes = shell(28, "Computational and deployment comparison",
                      "Measured architecture-level resource use and speed",
                      size=(16, 14.5), rows=3, cols=2, left=0.18, bottom=0.20, top=0.75,
                      wspace=0.65, hspace=0.88,
                      note="Latency is warmed-up, model-only, batch-1 forward time. Throughput uses batch 32. Measurements share the same hardware; each panel uses its own labeled scale.")
    for ax, (title, key, unit, scale) in zip(axes.flat, panels):
        values = [number(row, key) * scale for row in rows]
        require(min(values) >= 0, "Negative efficiency measurement")
        bars = ax.barh(range(3), values, color=COLORS, height=0.55)
        ax.bar_label(bars, labels=[f"{value:,.2f}" for value in values], padding=7,
                     fontsize=10, fontweight="bold", color=INK)
        ax.set_yticks(range(3), labels=MODELS, fontsize=10)
        ax.set_ylim(2.65, -0.65)
        ax.set_xlim(0, max(values) * 1.27)
        ax.set_xlabel(unit, fontsize=10, labelpad=10)
        ax.set_title(title, loc="left", fontsize=12, fontweight="bold", pad=16)
        clean_axis(ax, horizontal=True)
        audit(fig, title, values, models=list(MODELS), unit=unit)
    return fig


def paired(s):
    rows = s.table("table_06_paired_joint_mcnemar.csv")
    require(len(rows) == 3, "Expected three paired architecture comparisons")
    labels = [f"{row['model_A']}\nvs {row['model_B']}" for row in rows]
    values = [number(row, "joint_accuracy_difference_A_minus_B") * 100 for row in rows]
    low = [number(row, "bootstrap_diff_95_lo") * 100 for row in rows]
    high = [number(row, "bootstrap_diff_95_hi") * 100 for row in rows]
    require(all(lo <= value <= hi for lo, value, hi in zip(low, values, high)), "Invalid bootstrap CI")
    fig, axes = shell(29, "Paired joint-accuracy differences",
                      "Architecture A minus architecture B  |  Bootstrap 95% confidence intervals",
                      size=(15, 8.8), cols=2, left=0.23, bottom=0.245,
                      wspace=0.12, note="Differences are percentage points (pp). Bootstrap intervals are exploratory; Holm-adjusted McNemar p-values are supplied alongside each comparison.")
    ax, table = axes[0]
    ax.barh(range(3), values, color=COLORS, height=0.45,
            xerr=[[value - lo for value, lo in zip(values, low)],
                  [hi - value for value, hi in zip(values, high)]],
            error_kw={"ecolor": INK, "capsize": 5, "elinewidth": 1.5})
    ax.set_yticks(range(3), labels=labels, fontsize=11, linespacing=1.6)
    ax.set_ylim(2.7, -0.7)
    ax.set_xlim(min(0, min(low)) - 0.2, max(high) + 0.3)
    ax.axvline(0, color="#8693A0", linewidth=1.2, linestyle=":")
    ax.set_xlabel("Joint accuracy difference (pp)", labelpad=13)
    clean_axis(ax, horizontal=True)
    table.set_axis_off(); table.set_ylim(ax.get_ylim()); table.set_xlim(0, 1)
    table.text(0.04, -0.64, "Difference [95% CI]", fontsize=11, fontweight="bold")
    table.text(0.79, -0.64, "Holm p", fontsize=11, fontweight="bold")
    for y, row, value, lo, hi in zip(range(3), rows, values, low, high):
        table.text(0.04, y, f"{value:+.2f} pp  [{lo:+.2f}, {hi:+.2f}]", va="center", fontsize=10)
        table.text(0.79, y, f"{number(row, 'mcnemar_holm_p', probability=True):.5f}", va="center", fontsize=10)
    audit(fig, "Paired differences", values, lower=low, upper=high, comparisons=labels)
    return fig


def reliability(s):
    from matplotlib.ticker import PercentFormatter
    rows = s.table("table_07_reliability_bins.csv")
    ece = indexed(s.table("table_08_expected_calibration_error.csv"), "model", "task")
    fig, axes = shell(30, "Confidence reliability by task and architecture",
                      "Observed accuracy versus mean predicted confidence in each occupied bin",
                      size=(16, 12), rows=2, cols=3, bottom=0.22, top=0.73,
                      wspace=0.36, hspace=0.68,
                      note="The dotted diagonal denotes perfect calibration. Marker area scales with bin support; empty bins are omitted, not treated as zero accuracy. ECE uses all ten source bins.")
    for task_index, task in enumerate(("fruit", "quality")):
        for model_index, model in enumerate(MODELS):
            ax = axes[task_index, model_index]
            selected = [row for row in rows if row["model"] == model and row["task"] == task]
            require(len(selected) == 10, f"Expected ten bins for {model}/{task}")
            occupied = [row for row in selected if number(row, "support", integer=True) > 0]
            support = [number(row, "support", integer=True) for row in occupied]
            x = [number(row, "mean_confidence", probability=True) * 100 for row in occupied]
            y = [number(row, "empirical_accuracy", probability=True) * 100 for row in occupied]
            error = number(ece[(model, task)], "ECE_10bins", probability=True)
            derived = sum(n * abs(a - b) / 100 for n, a, b in zip(support, x, y)) / sum(support)
            require(abs(derived - error) < 2e-8, "Reliability bins disagree with ECE")
            ax.plot([0, 100], [0, 100], color="#8693A0", linestyle=":", lw=1.3)
            ax.scatter(x, y, s=[55 + 300 * n / max(support) for n in support],
                       color=COLORS[model_index], edgecolors="white", linewidths=1, zorder=3)
            ax.set_title(f"{model} / {task.title()}\nECE: {error:.4f}; n={sum(support):,}",
                         fontsize=11, loc="left", fontweight="bold", pad=17, linespacing=1.6)
            # Keep the full area of the largest support marker inside the panel.
            ax.set_xlim(-8, 108); ax.set_ylim(-8, 108)
            ax.set_xticks(range(0, 101, 25)); ax.set_yticks(range(0, 101, 25))
            ax.xaxis.set_major_formatter(PercentFormatter(100, decimals=0))
            ax.yaxis.set_major_formatter(PercentFormatter(100, decimals=0))
            ax.grid(True, color=GRID, linewidth=0.8); ax.set_axisbelow(True)
            ax.tick_params(length=0, pad=7, labelsize=9)
            ax.set_xlabel("Mean predicted confidence", fontsize=10, labelpad=10)
            ax.set_ylabel("Observed accuracy", fontsize=10, labelpad=10)
            audit(fig, f"{model} / {task}", y, mean_confidence=x, support=support, ECE=error,
                  empty_bins=10-len(occupied))
    return fig


def stress(s):
    rows = indexed(s.table("table_09_controlled_stress_tests.csv"), "model", "condition")
    conditions = list(dict.fromkeys(row["condition"] for row in rows.values()))
    series = [(model, [number(rows[(model, condition)], "joint_accuracy", probability=True) * 100
                       for condition in conditions]) for model in MODELS]
    fig, axes = shell(31, "Joint accuracy under controlled stress",
                      "Three architectures evaluated on the same held-out images",
                      legend=(MODELS, COLORS),
                      note="Joint accuracy requires both fruit and quality predictions to be correct. Bar heights retain source precision; percentage labels are rounded to two decimal places.")
    grouped(fig, axes[0, 0], conditions, series, ylabel="Joint accuracy")
    axes[0, 0].set_xlabel("Stress condition", fontsize=11, labelpad=14)
    return fig


def build(sources, n):
    if n == 1: fig = inventory(sources)
    elif n == 2: fig = allocation(sources)
    elif n == 3: fig = intervals(sources)
    elif 4 <= n <= 12: fig = confusion(sources, n)
    elif n in (13, 14): fig = class_f1(sources, n)
    elif n in (15, 16): fig = per_fruit(sources, n)
    elif n == 17: fig = taxonomy(sources)
    elif 18 <= n <= 23: fig = learning(sources, n)
    elif 24 <= n <= 26: fig = dashboard(sources, n)
    elif n == 27: fig = performance(sources)
    elif n == 28: fig = efficiency(sources)
    elif n == 29: fig = paired(sources)
    elif n == 30: fig = reliability(sources)
    elif n == 31: fig = stress(sources)
    else: raise ValueError(f"Unknown figure {n}")
    finish_sources(fig, sources)
    return fig


def validate_layout(fig):
    """Check actual rendered text bounds, including bar and matrix annotations."""
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    texts = list(fig.texts)
    for legend in fig.legends:
        texts.extend(legend.get_texts())
    for ax in fig.axes:
        texts.extend(ax.texts)
        texts.extend([ax.title, ax._left_title, ax.xaxis.label, ax.yaxis.label])
        for axis, limits in ((ax.xaxis, ax.get_xlim()), (ax.yaxis, ax.get_ylim())):
            low, high = sorted(limits)
            texts.extend(tick.label1 for tick in axis.get_major_ticks()
                         if low <= tick.get_loc() <= high)
    texts = [text for text in texts if text.get_visible() and text.get_text()]
    outside, overlaps = [], []
    boxes = [text.get_window_extent(renderer) for text in texts]
    for index, (text, box) in enumerate(zip(texts, boxes)):
        if not (fig.bbox.contains(box.x0, box.y0) and fig.bbox.contains(box.x1, box.y1)):
            outside.append(text.get_text())
        for other, other_box in zip(texts[index + 1:], boxes[index + 1:]):
            if box.overlaps(other_box):
                overlaps.append([text.get_text(), other.get_text()])
    require(not outside, f"Figure {fig._rework['figure']}: text outside page: {outside}")
    require(not overlaps, f"Figure {fig._rework['figure']}: overlapping text: {overlaps}")
    for text, bar in fig._inside_labels:
        label_box, bar_box = text.get_window_extent(renderer), bar.get_window_extent(renderer)
        require(bar_box.contains(label_box.x0, label_box.y0) and
                bar_box.contains(label_box.x1, label_box.y1),
                f"Figure {fig._rework['figure']}: internal label exceeds bar fill: {text.get_text()}")
    fig._rework["layout_check"] = {"text_items": len(texts), "outside": outside, "overlaps": overlaps}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT, help="Training-output directory.")
    parser.add_argument("--output-dir", type=Path, help="Default: INPUT/figures/reworked.")
    parser.add_argument("--figures", type=int, nargs="+", choices=range(1, 32),
                        help="Figure numbers; default: all 31.")
    parser.add_argument("--dpi", type=int, default=300, help="PNG resolution; default 300.")
    parser.add_argument("--no-show", action="store_true", help="Export all figures without opening windows.")
    parser.add_argument("--list", action="store_true", help="List the original catalog and exit.")
    args = parser.parse_args(argv)
    if args.dpi < 72: parser.error("--dpi must be at least 72")
    try:
        with (args.input_dir / "tables/figure_catalog.csv").open(newline="", encoding="utf-8-sig") as stream:
            catalog = {int(row["figure"]): row for row in csv.DictReader(stream)}
        require(set(catalog) == set(range(1, 32)), "Expected a complete catalog of figures 1-31")
        if args.list:
            for n, row in catalog.items(): print(f"{n:02d}  {row['slug']}")
            return 0
        import matplotlib
        if args.no_show: matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages

        selected = sorted(set(args.figures or range(1, 32)))
        destination = args.output_dir or args.input_dir / "figures/reworked"
        destination.mkdir(parents=True, exist_ok=True)
        entries = []
        book_path = destination / "all_figures_reworked.pdf"
        with matplotlib.rc_context(STYLE), PdfPages(book_path, metadata={
            "Title": "Fruispect - Consistent reworked evaluation figures",
            "Subject": "Figures rebuilt from training-output CSVs; source map in rework_catalog.json",
        }) as book:
            for n in selected:
                sources = Sources(args.input_dir)
                fig = build(sources, n)
                validate_layout(fig)
                stem = f"fig_{n:02d}_{catalog[n]['slug']}_reworked"
                pdf_path, png_path = destination / (stem + ".pdf"), destination / (stem + ".png")
                fig.savefig(pdf_path, facecolor="white", metadata={"Title": fig._rework["title"]})
                fig.savefig(png_path, facecolor="white", dpi=args.dpi)
                book.savefig(fig, facecolor="white")
                entry = fig._rework
                entry.update({"pdf": pdf_path.name, "png": png_path.name,
                              "original_slug": catalog[n]["slug"]})
                entries.append(entry)
                print(f"[{n:02d}/31] {stem} - data and layout checks passed", flush=True)
                if not args.no_show: plt.show()
                plt.close(fig)
        (destination / "rework_catalog.json").write_text(json.dumps({
            "input_directory": str(args.input_dir.resolve()), "png_dpi": args.dpi,
            "review_pdf": book_path.name, "figure_count": len(entries),
            "design": {"model_order": MODELS, "model_colors": COLORS, "font": "DejaVu Sans",
                       "bar_percentage_label_decimals": 2, "bar_values": "unrounded source values"},
            "figures": entries,
        }, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(f"Saved {len(entries)} PDF/PNG pairs and review book to {destination.resolve()}")
        return 0
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Figure rework failed: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Display and export a spacious redesign of Figure 02 from the source CSV.

Requires only matplotlib (install with ``python -m pip install matplotlib``).
Run from any working directory::

    python scripts/plot_split_allocation.py
    python scripts/plot_split_allocation.py --no-show

The default opens an interactive chart and saves a vector PDF and a 300 dpi PNG
beside the original figure, using a distinct ``_reworked`` filename. No training,
application modules, pandas, or original-figure modifications are required.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TABLE = ROOT / "trained-outputs" / "tables" / "actual_split_allocation.csv"
DEFAULT_OUTPUT = ROOT / "trained-outputs" / "figures"
OUTPUT_STEM = "fig_02_split_allocation_reworked"
SPLITS = ("train", "val", "test")
SPLIT_LABELS = ("Training", "Validation", "Testing")
COLORS = ("#245E79", "#9DD5D3", "#A95C2B")
INK = "#202D3A"
MUTED = "#596878"


@dataclass(frozen=True)
class Allocation:
    fruit: str
    quality: str
    counts: tuple[int, int, int]
    total: int


def load_allocations(path: Path) -> list[Allocation]:
    """Read exact integer counts, rejecting incomplete or inconsistent tables."""
    records = []
    seen = set()
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        required = {"fruit", "quality", *SPLITS, "total"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Table must contain columns: {', '.join(sorted(required))}")
        for line, row in enumerate(reader, start=2):
            fruit = (row["fruit"] or "").strip()
            quality = (row["quality"] or "").strip()
            if not fruit or quality not in {"Good", "Bad"}:
                raise ValueError(f"Line {line}: expected a fruit and Good/Bad quality.")
            key = (fruit, quality)
            if key in seen:
                raise ValueError(f"Line {line}: duplicate fruit-quality stratum {key}.")
            try:
                counts = tuple(int(row[split]) for split in SPLITS)
                total = int(row["total"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Line {line}: counts must be integers.") from exc
            if any(value < 0 for value in counts) or total <= 0 or sum(counts) != total:
                raise ValueError(f"Line {line}: nonnegative split counts must sum to total.")
            seen.add(key)
            records.append(Allocation(fruit, quality, counts, total))
    if not records:
        raise ValueError("The allocation table is empty.")
    for fruit in dict.fromkeys(record.fruit for record in records):
        if any((fruit, quality) not in seen for quality in ("Good", "Bad")):
            raise ValueError(f"Missing Good/Bad pair for {fruit}.")
    return records


def build_figure(records: list[Allocation], source_name: str):
    """Keep headers, legend, panels and footnotes in separate layout regions."""
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from matplotlib.ticker import MaxNLocator, StrMethodFormatter

    fruits = list(dict.fromkeys(record.fruit for record in records))
    lookup = {(record.fruit, record.quality): record for record in records}
    totals = [sum(record.counts[index] for record in records) for index in range(3)]
    grand_total = sum(record.total for record in records)
    max_total = max(record.total for record in records)
    row_totals = {record.total for record in records}

    style = {
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "text.color": INK,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "svg.fonttype": "none",
    }
    with plt.rc_context(style):
        fig, axes = plt.subplots(1, 2, figsize=(14, max(8.1, 4.5 + 0.6 * len(fruits))))
        fig.set_facecolor("white")
        fig.subplots_adjust(left=0.135, right=0.97, bottom=0.235, top=0.715, wspace=0.49)

        fig.text(0.04, 0.955, "FIGURE 02  /  DATASET COMPOSITION", fontsize=10,
                 fontweight="bold", color=MUTED)
        fig.text(0.04, 0.899, "Balanced fruit-quality split allocation",
                 fontsize=23, fontweight="bold")
        subtitle = (f"{grand_total:,} photographs  |  {len(fruits)} fruits  |  "
                    f"{len(records)} fruit-quality strata")
        if len(row_totals) == 1:
            subtitle += f"  |  {next(iter(row_totals)):,} photographs per stratum"
        fig.text(0.04, 0.852, subtitle, fontsize=11, color=MUTED)

        legend_labels = [
            f"{label}: {count:,} ({count / grand_total:.0%})"
            for label, count in zip(SPLIT_LABELS, totals)
        ]
        fig.legend([Patch(facecolor=color) for color in COLORS], legend_labels,
                   loc="upper left", bbox_to_anchor=(0.035, 0.811), ncol=3,
                   frameon=False, fontsize=11, handlelength=1.5,
                   handleheight=1.0, columnspacing=3.0, borderaxespad=0)

        for panel, (ax, quality) in enumerate(zip(axes, ("Good", "Bad"))):
            ax.set_title(f"{'AB'[panel]}   {quality} quality", loc="left", pad=20,
                         fontsize=14, fontweight="bold")
            ax.set_axisbelow(True)
            ax.xaxis.grid(True, color="#E5EAF0", linewidth=0.8)
            for y, fruit in enumerate(fruits):
                record = lookup[(fruit, quality)]
                left = 0
                for index, count in enumerate(record.counts):
                    ax.barh(y, count, left=left, height=0.55, color=COLORS[index],
                            edgecolor="white", linewidth=0.9)
                    if count:
                        ax.text(left + count / 2, y, f"{count:,}", ha="center",
                                va="center", fontsize=10, fontweight="bold",
                                color=INK if index == 1 else "white")
                    left += count
            ax.set_yticks(range(len(fruits)), labels=fruits, fontsize=11)
            ax.set_ylim(len(fruits) - 0.35, -0.65)
            ax.set_xlim(0, max_total * 1.025)
            ax.xaxis.set_major_locator(MaxNLocator(nbins=5, integer=True))
            ax.xaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
            ax.tick_params(axis="y", length=0, pad=12)
            ax.tick_params(axis="x", length=0, pad=9, labelsize=10)
            ax.set_xlabel("Photographs per fruit-quality stratum", labelpad=13, fontsize=10)
            for spine in ("top", "right", "left"):
                ax.spines[spine].set_visible(False)
            ax.spines["bottom"].set_color("#CED6DE")

        fig.text(0.04, 0.136, "READING THE CHART", fontsize=9,
                 fontweight="bold", color=MUTED)
        fig.text(0.04, 0.106,
                 "Segment labels give exact photograph counts; bar lengths show each stratum's total.",
                 fontsize=10, color=MUTED)
        fig.text(0.04, 0.075,
                 "Group-aware partitioning keeps every whole near-duplicate group in a single split.",
                 fontsize=10, color=MUTED)
        fig.text(0.04, 0.035, f"Source: {source_name}", fontsize=9, color=MUTED)
    return fig


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", type=Path, default=DEFAULT_TABLE, help="Source allocation CSV.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT,
                        help="Directory for the reworked PDF and PNG.")
    parser.add_argument("--dpi", type=int, default=300, help="PNG resolution (default: 300).")
    parser.add_argument("--no-show", action="store_true", help="Export without opening a window.")
    args = parser.parse_args(argv)
    if args.dpi < 72:
        parser.error("--dpi must be at least 72.")
    try:
        records = load_allocations(args.table)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    # Choose a noninteractive backend before importing pyplot in export-only mode.
    import matplotlib
    if args.no_show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        source_name = args.table.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        source_name = args.table.name
    fig = build_figure(records, source_name)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for extension in ("pdf", "png"):
        destination = args.output_dir / f"{OUTPUT_STEM}.{extension}"
        options = {"dpi": args.dpi} if extension == "png" else {
            "metadata": {"Title": "Figure 02 - Balanced fruit-quality split allocation",
                         "Subject": f"Exact allocation counts from {source_name}"}
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

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path


def add_common_timeline_schedules(reports: list[dict[str, object]]) -> None:
    long_cases = []
    for report in reports:
        case = next(
            (item for item in report.get("cases", []) if item.get("id") == "long-run-bilingual"),
            None,
        )
        if case is None:
            return
        long_cases.append(case)

    segment_counts = {len(case["segments"]) for case in long_cases}
    if len(segment_counts) != 1 or not segment_counts:
        return

    segment_count = segment_counts.pop()
    common_coverage = [
        statistics.median(
            float(case["segments"][index]["outputSeconds"])
            for case in long_cases
        )
        for index in range(segment_count)
    ]
    for report, case in zip(reports, long_cases, strict=True):
        schedule = [
            {
                "generationSeconds": float(segment["generationSeconds"]),
                "mediaCoverageSeconds": common_coverage[index],
                "rawOutputSeconds": float(segment["outputSeconds"]),
            }
            for index, segment in enumerate(case["segments"])
        ]
        timeline_rtfs = [
            item["generationSeconds"] / item["mediaCoverageSeconds"]
            for item in schedule
        ]
        report["timelineSimulation"] = {
            "coverageBasis": "median output duration for the same text across all models",
            "rtf": statistics.median(timeline_rtfs),
            "p90Rtf": sorted(timeline_rtfs)[
                min(len(timeline_rtfs) - 1, round((len(timeline_rtfs) - 1) * 0.9))
            ],
            "schedule": schedule,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the browser-facing benchmark index")
    parser.add_argument("--results", required=True, type=Path)
    args = parser.parse_args()

    reports = []
    for report_path in sorted(args.results.glob("*/benchmark.json")):
        reports.append(json.loads(report_path.read_text(encoding="utf-8")))
    if not reports:
        raise RuntimeError(f"no benchmark reports found below {args.results}")

    add_common_timeline_schedules(reports)

    aggregate = {
        "schemaVersion": 1,
        "referenceFile": "reference.wav",
        "models": reports,
    }
    (args.results / "aggregate.json").write_text(
        json.dumps(aggregate, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(args.results / "aggregate.json")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser(description="Download pinned F5-TTS assets")
    parser.add_argument("--model-output", required=True, type=Path)
    parser.add_argument("--vocoder-output", required=True, type=Path)
    args = parser.parse_args()

    args.model_output.mkdir(parents=True, exist_ok=True)
    args.vocoder_output.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id="SWivid/F5-TTS",
        revision="84e5a410d9cead4de2f847e7c9369a6440bdfaca",
        local_dir=args.model_output,
        allow_patterns=[
            "F5TTS_v1_Base/model_1250000.safetensors",
            "F5TTS_v1_Base/vocab.txt",
        ],
    )
    snapshot_download(
        repo_id="charactr/vocos-mel-24khz",
        revision="0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21",
        local_dir=args.vocoder_output,
        allow_patterns=["config.yaml", "pytorch_model.bin"],
    )


if __name__ == "__main__":
    main()

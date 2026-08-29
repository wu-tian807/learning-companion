from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the pinned voice-cloning model")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repo", default="openbmb/VoxCPM1.5")
    parser.add_argument("--revision")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    local_path = snapshot_download(
        repo_id=args.repo,
        revision=args.revision,
        local_dir=args.output,
        allow_patterns=[
            "audiovae.pth",
            "config.json",
            "model.safetensors",
            "special_tokens_map.json",
            "tokenization_voxcpm2.py",
            "tokenizer.json",
            "tokenizer_config.json",
        ],
    )
    print(local_path)


if __name__ == "__main__":
    main()

"""Generate one WAV for a validated TTS request from the Node server."""

import json
import sys

import torch
from silero import silero_tts


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("An output path is required")
    request = json.loads(sys.stdin.readline())
    text = request.get("text")
    if not isinstance(text, str) or not 1 <= len(text) <= 200:
        raise SystemExit("Invalid text length")

    torch.set_num_threads(1)
    model, _ = silero_tts(language="ru", speaker="v3_1_ru")
    model.save_wav(
        text=text,
        speaker="baya",
        sample_rate=24000,
        audio_path=sys.argv[1],
    )


if __name__ == "__main__":
    main()

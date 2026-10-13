"""Regenerate the legacy first-party export. Edit model-register.json only."""
import json
from pathlib import Path
from collector.register import read_register, firstparty_catalog

if __name__ == "__main__":
    Path(__file__).with_name("firstparty.json").write_text(
        json.dumps(firstparty_catalog(read_register()), indent=2) + "\n", encoding="utf-8")

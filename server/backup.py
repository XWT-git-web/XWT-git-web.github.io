"""Create a consistent SQLite backup: python backup.py /path/to/backup.sqlite3."""
import sqlite3
import sys
import os
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "data" / "zhijian.sqlite3"


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python backup.py /path/to/backup.sqlite3")
    target = Path(sys.argv[1]).expanduser().resolve()
    source = Path(os.environ.get("ZHIJIAN_DB_PATH", SOURCE)).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Database not found: {source}")
    if target == source:
        raise SystemExit("Backup destination must differ from the database")
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as original, sqlite3.connect(target) as backup:
        original.backup(backup)
    print(target)


if __name__ == "__main__":
    main()

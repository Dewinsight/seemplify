#!/usr/bin/env python3
"""Create, verify, or extract the AES-256 Seemplify access vault."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import secrets
import sys
import tempfile
import zipfile

try:
    import pyzipper
except ImportError as exc:
    raise SystemExit("Install the required package with: python -m pip install pyzipper") from exc


def load_key(path: Path) -> bytes:
    key = path.read_bytes().strip()
    if len(key) < 24:
        raise SystemExit("Vault key must contain at least 24 bytes")
    return key


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def members(source: Path):
    for path in sorted(source.rglob("*")):
        if path.is_file():
            yield path, Path(source.name) / path.relative_to(source)


def pack(source: Path, archive: Path, key_file: Path) -> None:
    key = load_key(key_file)
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=archive.parent, suffix=".zip", delete=False) as tmp:
        temp_archive = Path(tmp.name)
    try:
        with pyzipper.AESZipFile(
            temp_archive,
            "w",
            compression=pyzipper.ZIP_DEFLATED,
            encryption=pyzipper.WZ_AES,
        ) as vault:
            vault.setpassword(key)
            vault.setencryption(pyzipper.WZ_AES, nbits=256)
            for path, arcname in members(source):
                vault.write(path, arcname.as_posix())
        verify(temp_archive, key_file)
        os.replace(temp_archive, archive)
    finally:
        temp_archive.unlink(missing_ok=True)
    print(f"created={archive} sha256={sha256(archive)}")


def verify(archive: Path, key_file: Path) -> None:
    key = load_key(key_file)
    with pyzipper.AESZipFile(archive, "r") as vault:
        files = [info for info in vault.infolist() if not info.is_dir()]
        if not files:
            raise SystemExit("Vault is empty")
        encrypted = [info for info in files if info.file_size > 0]
        if not encrypted:
            raise SystemExit("Vault contains no nonempty files to verify")
        try:
            vault.read(encrypted[0])
        except (RuntimeError, NotImplementedError):
            pass
        else:
            raise SystemExit("Vault content was readable without a password")
        vault.setpassword(key)
        bad_member = vault.testzip()
        if bad_member:
            raise SystemExit(f"Vault integrity failed for {bad_member}")
    print(f"verified={archive} files={len(files)} sha256={sha256(archive)}")


def extract(archive: Path, destination: Path, key_file: Path) -> None:
    key = load_key(key_file)
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with pyzipper.AESZipFile(archive, "r") as vault:
        vault.setpassword(key)
        for info in vault.infolist():
            target = (destination / info.filename).resolve()
            if destination != target and destination not in target.parents:
                raise SystemExit(f"Unsafe archive member: {info.filename}")
        vault.extractall(destination)
    print(f"extracted={archive} destination={destination}")


def init_key(key_file: Path) -> None:
    key_file = key_file.resolve()
    key_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        with key_file.open("x", encoding="ascii") as handle:
            handle.write(secrets.token_urlsafe(48) + "\n")
    except FileExistsError:
        raise SystemExit(f"Refusing to replace existing vault key: {key_file}")
    os.chmod(key_file, 0o600)
    print(f"created-key={key_file}")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    init = subparsers.add_parser("init-key")
    init.add_argument("--key-file", type=Path, required=True)
    for command in ("pack", "verify", "extract"):
        sub = subparsers.add_parser(command)
        sub.add_argument("--archive", type=Path, default=Path("access.zip"))
        sub.add_argument("--key-file", type=Path, required=True)
        if command == "pack":
            sub.add_argument("--source", type=Path, default=Path("access"))
        if command == "extract":
            sub.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "init-key":
        init_key(args.key_file)
    elif args.command == "pack":
        pack(args.source.resolve(), args.archive.resolve(), args.key_file.resolve())
    elif args.command == "verify":
        verify(args.archive.resolve(), args.key_file.resolve())
    else:
        extract(args.archive.resolve(), args.destination.resolve(), args.key_file.resolve())


if __name__ == "__main__":
    main()

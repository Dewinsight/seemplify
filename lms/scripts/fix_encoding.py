"""Convert lms-login.html from UTF-16 LE to UTF-8 (no BOM)."""
import os

paths = [
    os.path.join(os.path.dirname(__file__), "..", "www", "lms-login.html"),
    os.path.join(os.path.dirname(__file__), "..", "lms", "www", "lms-login.html"),
]

for p in paths:
    p = os.path.normpath(p)
    if os.path.exists(p):
        with open(p, "rb") as f:
            raw = f.read()
        if raw[:2] == b"\xff\xfe":  # UTF-16 LE BOM
            content = raw.decode("utf-16-le")
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            print(f"Converted: {p}")
        elif raw[:3] == b"\xef\xbb\xbf":  # UTF-8 BOM - remove it
            content = raw[3:].decode("utf-8")
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            print(f"Removed BOM: {p}")
        else:
            print(f"OK (already UTF-8): {p}")

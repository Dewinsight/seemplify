from __future__ import annotations

from dash_view import create_app


def main() -> None:
    app = create_app()

    print("\n" + "=" * 65)
    print("  UBA FastLane Intelligence")
    print("=" * 65)
    print("\n  ✓  Starting server...")
    print("  ✓  Open your browser at:  http://127.0.0.1:8050")
    print("\n  To stop: press Ctrl+C in this terminal")
    print("=" * 65 + "\n")

    app.run(debug=False, port=8050)


if __name__ == "__main__":
    main()

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from dash import Dash, dcc, html, Input, Output
from dash.development.base_component import Component
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from queue_math_model import ( DEMAND_PROFILE, HOUR_LABELS,  erlang_c,  optimal_tellers, staffing_table)

# ══════════════════════════════════════════════════════════════════════════════
#  SECTION 2 — COLOUR PALETTE & STYLE
# ══════════════════════════════════════════════════════════════════════════════

NAVY = "#0f2044"
NAVY2 = "#1b3a6b"
BLUE = "#2563eb"
BLUE2 = "#3b82f6"
AMBER = "#f59e0b"
RED = "#ef4444"
GREEN = "#10b981"
BG = "#060d1f"
BG2 = "#0d1b35"
CARD = "#0f2044"
BORDER = "#1e3a6e"
TEXT = "#e2e8f0"
MUTED = "#64748b"
DIM = "#94a3b8"
WHITE = "#ffffff"

PLOT_LAYOUT: dict[str, Any] = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font=dict(family="monospace", color=TEXT, size=11),
    margin=dict(l=50, r=20, t=20, b=50),
    xaxis=dict(gridcolor=BORDER, linecolor=BORDER, tickfont=dict(color=DIM, size=10)),
    yaxis=dict(gridcolor=BORDER, linecolor=BORDER, tickfont=dict(color=DIM, size=10)),
    legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(color=DIM, size=10)),
    hoverlabel=dict(bgcolor=NAVY, font_color=TEXT, bordercolor=BORDER),
)

# ── CSS injected directly ─────────────────────────────────────────────────────
INDEX_STRING: str = """
<!DOCTYPE html>
<html>
<head>
    {%metas%}
    <title>{%title%}</title>
    {%favicon%}
    {%css%}
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            background: #060d1f;
            color: #e2e8f0;
            font-family: 'DM Sans', sans-serif;
            font-weight: 300;
        }

        body::before {
            content: '';
            position: fixed; inset: 0;
            background-image:
                linear-gradient(rgba(37,99,235,0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(37,99,235,0.04) 1px, transparent 1px);
            background-size: 40px 40px;
            pointer-events: none; z-index: 0;
        }

        #react-entry-point { position: relative; z-index: 1; }

        .mono { font-family: 'DM Mono', monospace; }

        /* ── KPI Cards ── */
        .kpi-card {
            background: rgba(15,32,68,0.85);
            border: 1px solid #1e3a6e;
            border-radius: 8px;
            padding: 18px 22px;
            backdrop-filter: blur(8px);
            position: relative;
            overflow: hidden;
        }
        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 2px;
        }
        .kpi-card.blue::before  { background: #2563eb; }
        .kpi-card.amber::before { background: #f59e0b; }
        .kpi-card.red::before   { background: #ef4444; }
        .kpi-card.green::before { background: #10b981; }

        .kpi-label {
            font-family: 'DM Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.13em;
            text-transform: uppercase;
            color: #64748b;
            margin-bottom: 6px;
        }
        .kpi-value {
            font-family: 'DM Mono', monospace;
            font-size: 32px;
            font-weight: 700;
            color: #ffffff;
            line-height: 1;
        }
        .kpi-unit  { font-size: 14px; color: #94a3b8; margin-left: 3px; }
        .kpi-sub   { font-size: 11px; color: #64748b; margin-top: 5px; }

        /* ── Chart Cards ── */
        .chart-card {
            background: rgba(15,32,68,0.85);
            border: 1px solid #1e3a6e;
            border-radius: 8px;
            padding: 22px;
            backdrop-filter: blur(8px);
        }
        .chart-title    { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
        .chart-subtitle { font-size: 11px; color: #64748b; margin-bottom: 12px; line-height: 1.5; }

        /* ── Slider ── */
        .slider-label {
            font-family: 'DM Mono', monospace;
            font-size: 11px;
            color: #94a3b8;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
        }
        .slider-label span { color: #fff; font-size: 15px; font-weight: 500; }

        /* ── Formula box ── */
        .formula-box {
            background: #0d1b35;
            border: 1px solid #1e3a6e;
            border-left: 3px solid #2563eb;
            border-radius: 0 8px 8px 0;
            padding: 14px 18px;
            font-family: 'DM Mono', monospace;
            font-size: 12px;
            color: #94a3b8;
            line-height: 2;
            margin-top: 12px;
        }

        /* ── Warning ── */
        .warning-box {
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.35);
            border-radius: 8px;
            padding: 12px 18px;
            color: #fca5a5;
            font-size: 13px;
            margin-bottom: 16px;
        }

        /* ── Insight cards ── */
        .insight-card {
            background: #0d1b35;
            border: 1px solid #1e3a6e;
            border-radius: 8px;
            padding: 18px;
        }
        .insight-icon  { font-size: 20px; margin-bottom: 8px; }
        .insight-title { font-size: 13px; font-weight: 500; color: #e2e8f0; margin-bottom: 5px; }
        .insight-body  { font-size: 11px; color: #64748b; line-height: 1.7; }

        /* ── Badge ── */
        .badge {
            display: inline-block;
            font-family: 'DM Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            padding: 4px 10px;
            border-radius: 2px;
            margin-left: 8px;
        }
        .badge-or  { background: rgba(37,99,235,0.2); color: #93c5fd; border: 1px solid rgba(37,99,235,0.4); }
        .badge-not { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }

        /* ── Divider ── */
        .divider {
            height: 1px;
            background: #1e3a6e;
            margin: 24px 0;
        }

        /* Dash table override */
        .dash-table-container .dash-spreadsheet-container .dash-spreadsheet-inner td {
            background: transparent !important;
            color: #94a3b8 !important;
            font-family: 'DM Mono', monospace !important;
            font-size: 12px !important;
            border-color: #1e3a6e !important;
        }
        .dash-table-container .dash-spreadsheet-container .dash-spreadsheet-inner th {
            background: #0f2044 !important;
            color: #64748b !important;
            font-family: 'DM Mono', monospace !important;
            font-size: 10px !important;
            letter-spacing: 0.1em !important;
            text-transform: uppercase !important;
            border-color: #1e3a6e !important;
        }
    </style>
</head>
<body>
    {%app_entry%}
    <footer>
        {%config%}
        {%scripts%}
        {%renderer%}
    </footer>
</body>
</html>
"""


def build_layout() -> Component:
    return html.Div(
        style={"maxWidth": "1400px", "margin": "0 auto", "padding": "0 24px 60px"},
        children=[
            # ── Header ────────────────────────────────────────────────────────────
            html.Div(
                style={
                    "padding": "36px 0 28px",
                    "borderBottom": f"1px solid {BORDER}",
                    "marginBottom": "28px",
                },
                children=[
                    html.Div(
                        style={
                            "display": "flex",
                            "justifyContent": "space-between",
                            "alignItems": "flex-end",
                        },
                        children=[
                            html.Div(
                                [
                                    html.Div(
                                        "UBA Branch Intelligence · Pilot Model",
                                        className="mono",
                                        style={
                                            "fontSize": "11px",
                                            "letterSpacing": "0.14em",
                                            "color": BLUE2,
                                            "textTransform": "uppercase",
                                            "marginBottom": "8px",
                                        },
                                    ),
                                    html.Div(
                                        style={
                                            "display": "flex",
                                            "alignItems": "center",
                                            "gap": "12px",
                                        },
                                        children=[
                                            html.H1(
                                                "UBA FastLane Dashboard",
                                                style={
                                                    "fontSize": "clamp(20px,3vw,36px)",
                                                    "fontWeight": "700",
                                                    "color": WHITE,
                                                    "lineHeight": "1.15",
                                                },
                                            ),
                                        ],
                                    ),
                                ]
                            ),
                            html.Div(
                                style={
                                    "display": "flex",
                                    "flexDirection": "column",
                                    "gap": "6px",
                                    "alignItems": "flex-end",
                                },
                                children=[
                                    html.Span("Mathematical Model", className="badge badge-or"),
                                    html.Span("AL/ML Next Phase", className="badge badge-not"),
                                ],
                            ),
                        ],
                    )
                ],
            ),
            # ── Warning banner (hidden by default) ───────────────────────────────
            html.Div(
                id="warning-banner",
                style={"display": "none"},
                children=[
                    html.Div(
                        className="warning-box",
                        children=[
                            "⚠️  Queue is UNSTABLE (ρ ≥ 1.0) — arrival rate exceeds service capacity. "
                            "Add more tellers or the queue will grow without bound."
                        ],
                    )
                ],
            ),
            # ── KPI Bar ───────────────────────────────────────────────────────────
            html.Div(
                style={
                    "display": "grid",
                    "gridTemplateColumns": "repeat(4,1fr)",
                    "gap": "16px",
                    "marginBottom": "28px",
                },
                children=[
                    html.Div(
                        className="kpi-card blue",
                        children=[
                            html.Div("Expected Wait Time", className="kpi-label"),
                            html.Div(id="kpi-wait", className="kpi-value", children=[]),
                            html.Div(id="kpi-wait-sub", className="kpi-sub"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card amber",
                        children=[
                            html.Div("Utilisation  ρ", className="kpi-label"),
                            html.Div(id="kpi-rho", className="kpi-value", children=[]),
                            html.Div(id="kpi-rho-sub", className="kpi-sub"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card red",
                        children=[
                            html.Div("Prob. of Waiting", className="kpi-label"),
                            html.Div(id="kpi-prob", className="kpi-value", children=[]),
                            html.Div("Erlang C probability", className="kpi-sub"),
                        ],
                    ),
                    html.Div(
                        className="kpi-card green",
                        children=[
                            html.Div("System Capacity", className="kpi-label"),
                            html.Div(id="kpi-capacity", className="kpi-value", children=[]),
                            html.Div(id="kpi-capacity-sub", className="kpi-sub"),
                        ],
                    ),
                ],
            ),
            # ── Controls Panel ────────────────────────────────────────────────────
            html.Div(
                className="chart-card",
                style={"marginBottom": "28px"},
                children=[
                    html.Div(
                        "// Live Parameters — M/M/c Erlang C Model",
                        className="mono",
                        style={
                            "fontSize": "11px",
                            "letterSpacing": "0.13em",
                            "color": BLUE2,
                            "textTransform": "uppercase",
                            "marginBottom": "22px",
                        },
                    ),
                    html.Div(
                        style={"display": "grid", "gridTemplateColumns": "repeat(3,1fr)", "gap": "32px"},
                        children=[
                            # λ slider
                            html.Div(
                                [
                                    html.Div(
                                        style={"display": "flex", "justifyContent": "space-between"},
                                        children=[
                                            html.Span("Arrival Rate  λ", className="mono", style={"fontSize": "11px", "color": DIM}),
                                            html.Span(id="val-lambda", style={"fontFamily": "DM Mono", "fontSize": "15px", "fontWeight": "500", "color": WHITE}),
                                        ],
                                    ),
                                    html.Div("customers / hour", className="mono", style={"fontSize": "10px", "color": MUTED, "marginBottom": "10px"}),
                                    dcc.Slider(
                                        id="slider-lambda",
                                        min=5,
                                        max=120,
                                        step=1,
                                        value=45,
                                        marks={5: "5", 60: "60", 120: "120"},
                                        tooltip={"placement": "bottom", "always_visible": False},
                                        className="mono",
                                    ),
                                ]
                            ),
                            # μ slider
                            html.Div(
                                [
                                    html.Div(
                                        style={"display": "flex", "justifyContent": "space-between"},
                                        children=[
                                            html.Span("Service Rate  μ", className="mono", style={"fontSize": "11px", "color": DIM}),
                                            html.Span(id="val-mu", style={"fontFamily": "DM Mono", "fontSize": "15px", "fontWeight": "500", "color": WHITE}),
                                        ],
                                    ),
                                    html.Div("customers / hour / teller", className="mono", style={"fontSize": "10px", "color": MUTED, "marginBottom": "10px"}),
                                    dcc.Slider(
                                        id="slider-mu",
                                        min=3,
                                        max=30,
                                        step=1,
                                        value=10,
                                        marks={3: "3", 15: "15", 30: "30"},
                                        tooltip={"placement": "bottom", "always_visible": False},
                                    ),
                                ]
                            ),
                            # c slider
                            html.Div(
                                [
                                    html.Div(
                                        style={"display": "flex", "justifyContent": "space-between"},
                                        children=[
                                            html.Span("Active Tellers  c", className="mono", style={"fontSize": "11px", "color": DIM}),
                                            html.Span(id="val-c", style={"fontFamily": "DM Mono", "fontSize": "15px", "fontWeight": "500", "color": WHITE}),
                                        ],
                                    ),
                                    html.Div("number of teller windows open", className="mono", style={"fontSize": "10px", "color": MUTED, "marginBottom": "10px"}),
                                    dcc.Slider(
                                        id="slider-c",
                                        min=1,
                                        max=20,
                                        step=1,
                                        value=5,
                                        marks={1: "1", 10: "10", 20: "20"},
                                        tooltip={"placement": "bottom", "always_visible": False},
                                    ),
                                ]
                            ),
                        ],
                    ),
                    html.Div(id="formula-box", className="formula-box"),
                ],
            ),
            # ── Charts Row 1 ──────────────────────────────────────────────────────
            html.Div(
                style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "20px", "marginBottom": "20px"},
                children=[
                    html.Div(
                        className="chart-card",
                        children=[
                            html.Div("Wait Time vs Teller Count", className="chart-title"),
                            html.Div(
                                "The non-linear cliff — why adding one teller at peak saves more than ten at quiet times",
                                className="chart-subtitle",
                            ),
                            dcc.Graph(id="chart-tellers", config={"displayModeBar": False}, style={"height": "280px"}),
                        ],
                    ),
                    html.Div(
                        className="chart-card",
                        children=[
                            html.Div("Utilisation ρ → Wait Time (Exponential Growth)", className="chart-title"),
                            html.Div(
                                "As ρ approaches 1.0, wait time approaches infinity — not linearly, exponentially",
                                className="chart-subtitle",
                            ),
                            dcc.Graph(id="chart-rho", config={"displayModeBar": False}, style={"height": "280px"}),
                        ],
                    ),
                ],
            ),
            # ── Charts Row 2 — Full width hourly ──────────────────────────────────
            html.Div(
                className="chart-card",
                style={"marginBottom": "20px"},
                children=[
                    html.Div("Simulated Daily Branch Profile — Wait Time by Hour", className="chart-title"),
                    html.Div(
                        "Flat staffing (red) vs demand-matched Erlang C staffing (green) · "
                        "Same labour budget, dramatically different customer experience",
                        className="chart-subtitle",
                    ),
                    dcc.Graph(id="chart-hourly", config={"displayModeBar": False}, style={"height": "300px"}),
                ],
            ),
            # ── Charts Row 3 ──────────────────────────────────────────────────────
            html.Div(
                style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "20px", "marginBottom": "20px"},
                children=[
                    html.Div(
                        className="chart-card",
                        children=[
                            html.Div("Optimal Staffing Recommendation", className="chart-title"),
                            html.Div(
                                "Minimum tellers to hit target wait time thresholds at current λ and μ",
                                className="chart-subtitle",
                            ),
                            html.Div(id="staffing-table-container"),
                        ],
                    ),
                    html.Div(
                        className="chart-card",
                        children=[
                            html.Div("Service Rate μ Impact on Wait Time", className="chart-title"),
                            html.Div(
                                "Effect of improving teller process speed (μ) at current teller count — "
                                "the productivity lever",
                                className="chart-subtitle",
                            ),
                            dcc.Graph(id="chart-mu", config={"displayModeBar": False}, style={"height": "280px"}),
                        ],
                    ),
                ],
            ),
            # ── Insight Cards ─────────────────────────────────────────────────────
            html.Div(
                style={"display": "grid", "gridTemplateColumns": "repeat(3,1fr)", "gap": "16px", "marginBottom": "24px"},
                children=[
                    html.Div(
                        className="insight-card",
                        children=[
                            html.Div("📐", className="insight-icon"),
                            html.Div("Why a Mathematical Model?", className="insight-title"),
                            html.Div(
                                "With the timestamp data we currently have — ticket created, teller called, "
                                "and service closed — we can compute wait times and service durations directly. "
                                "A mathematical model gives us immediate, accurate predictions from day one "
                                "without waiting to accumulate large datasets.",
                                className="insight-body",
                            ),
                        ],
                    ),
                    html.Div(
                        className="insight-card",
                        children=[
                            html.Div("⚡", className="insight-icon"),
                            html.Div("The Non-Linear Danger Zone", className="insight-title"),
                            html.Div(
                                "When utilisation ρ exceeds ~0.80, wait times grow exponentially. "
                                "Adding one teller at ρ = 0.90 saves far more time than adding one "
                                "at ρ = 0.50. This is invisible to intuition — visible only through "
                                "the model.",
                                className="insight-body",
                            ),
                        ],
                    ),
                    html.Div(
                        className="insight-card",
                        children=[
                            html.Div("🎯", className="insight-icon"),
                            html.Div("Three Levers, Three Objectives", className="insight-title"),
                            html.Div(
                                "Reduce wait time by increasing c (tellers) or μ (service speed). "
                                "Improve experience by surfacing predictions at ticket issuance. "
                                "Improve productivity by demand-matching shifts to λ. "
                                "One model — three objectives.",
                                className="insight-body",
                            ),
                        ],
                    ),
                ],
            ),
            # ── Footer ────────────────────────────────────────────────────────────
            html.Div(
                style={
                    "borderTop": f"1px solid {BORDER}",
                    "paddingTop": "20px",
                    "display": "flex",
                    "justifyContent": "space-between",
                    "fontFamily": "DM Mono",
                    "fontSize": "10px",
                    "color": MUTED,
                },
                children=[
                    html.Span("Branch Queue Mathematical Model · Predictive Wait Time · Staff Optimisation"),
                    html.Span("UBA Branch Optimisation Intelligence · POC v1.0 · 2026"),
                ],
            ),
        ],
    )


def create_app() -> Dash:
    app: Dash = Dash(__name__, title="UBA Branch Intelligence — Queueing Theory POC")
    app.config.suppress_callback_exceptions = True
    app.index_string = INDEX_STRING
    app.layout = build_layout()
    register_callbacks(app)
    return app


def register_callbacks(app: Dash) -> None:
    @app.callback(
        # KPIs
        Output("kpi-wait", "children"),
        Output("kpi-wait-sub", "children"),
        Output("kpi-rho", "children"),
        Output("kpi-rho-sub", "children"),
        Output("kpi-prob", "children"),
        Output("kpi-capacity", "children"),
        Output("kpi-capacity-sub", "children"),
        # Warning
        Output("warning-banner", "style"),
        # Formula
        Output("formula-box", "children"),
        # Slider value labels
        Output("val-lambda", "children"),
        Output("val-mu", "children"),
        Output("val-c", "children"),
        # Charts
        Output("chart-tellers", "figure"),
        Output("chart-rho", "figure"),
        Output("chart-hourly", "figure"),
        Output("chart-mu", "figure"),
        # Table
        Output("staffing-table-container", "children"),
        # Inputs
        Input("slider-lambda", "value"),
        Input("slider-mu", "value"),
        Input("slider-c", "value"),
    )
    def update_all(lam: float, mu: float, c: int) -> tuple[Any, ...]:
        # ── Compute current state ─────────────────────────────────────────────────
        r = erlang_c(c, lam, mu)
        stable = r["stable"]

        # ── KPIs ──────────────────────────────────────────────────────────────────
        if stable:
            kpi_wait = [f"{r['W_mean']:.1f}", html.Span(" min", style={"fontSize": "14px", "color": DIM})]
            kpi_wait_sub = f"Range: {r['W_lower']:.1f} – {r['W_upper']:.1f} min"
        else:
            kpi_wait = ["∞", html.Span(" min", style={"fontSize": "14px", "color": DIM})]
            kpi_wait_sub = "Queue unstable — add tellers"

        rho_pct = r["rho"] * 100
        kpi_rho = [f"{rho_pct:.0f}", html.Span(" %", style={"fontSize": "14px", "color": DIM})]
        kpi_rho_sub = (
            "Comfortable"
            if r["rho"] < 0.70
            else "Moderate load"
            if r["rho"] < 0.85
            else "⚠ High load"
            if r["rho"] < 1.0
            else "🚨 Overloaded"
        )

        kpi_prob = [f"{r['C']*100:.0f}", html.Span(" %", style={"fontSize": "14px", "color": DIM})]

        capacity = c * mu
        kpi_cap = [f"{capacity}", html.Span(" /hr", style={"fontSize": "14px", "color": DIM})]
        kpi_cap_sub = f"{c} tellers × {mu} cust/hr each"

        # ── Warning ───────────────────────────────────────────────────────────────
        warning_style = {"display": "block"} if not stable else {"display": "none"}

        # ── Formula ───────────────────────────────────────────────────────────────
        formula = html.Span(
            [
                html.Span("ρ", style={"color": BLUE2}),
                " = λ / (c × μ) = ",
                html.Span(f"{lam}", style={"color": BLUE2}),
                " / (",
                html.Span(f"{c}", style={"color": BLUE2}),
                " × ",
                html.Span(f"{mu}", style={"color": BLUE2}),
                ") = ",
                html.Span(f'{r["rho"]:.3f}', style={"color": AMBER, "fontWeight": "500"}),
                "    |    W = C(c,ρ) / (c×μ − λ) = ",
                html.Span(
                    f"{r['W_mean']:.1f} min" if stable else "∞  (queue unstable)",
                    style={"color": GREEN if stable else RED, "fontWeight": "500", "fontSize": "14px"},
                ),
            ]
        )

        # ── Chart 1: Wait Time vs Teller Count ────────────────────────────────────
        teller_range = list(range(1, 21))
        wait_vs_tellers: list[float | None] = []
        for cc in teller_range:
            res = erlang_c(cc, lam, mu)
            wait_vs_tellers.append(min(res["W_mean"], 120) if res["stable"] else None)

        fig_tellers = go.Figure()
        fig_tellers.add_trace(
            go.Scatter(
                x=teller_range,
                y=wait_vs_tellers,
                mode="lines+markers",
                line=dict(color=BLUE2, width=2.5),
                fill="tozeroy",
                fillcolor="rgba(37,99,235,0.12)",
                marker=dict(color=BLUE2, size=6),
                name="Expected Wait (min)",
                hovertemplate="%{x} tellers → %{y:.1f} min<extra></extra>",
            )
        )
        if stable:
            fig_tellers.add_trace(
                go.Scatter(
                    x=[c],
                    y=[r["W_mean"]],
                    mode="markers",
                    marker=dict(color=AMBER, size=14, symbol="diamond", line=dict(color=WHITE, width=2)),
                    name="Current setting",
                    hovertemplate=f'Current: {c} tellers → {r["W_mean"]:.1f} min<extra></extra>',
                )
            )
        opt = optimal_tellers(lam, mu)
        fig_tellers.add_vline(
            x=opt,
            line_dash="dot",
            line_color=GREEN,
            line_width=1.5,
            annotation_text=f"  Optimal: {opt}",
            annotation_font_color=GREEN,
            annotation_font_size=10,
        )
        fig_tellers.update_layout(**PLOT_LAYOUT, xaxis_title="Number of Tellers (c)", yaxis_title="Expected Wait (min)")

        # ── Chart 2: Wait vs Utilisation ─────────────────────────────────────────
        rho_vals = np.arange(0.10, 0.99, 0.015)
        wait_vs_rho: list[float] = []
        for rho_val in rho_vals:
            eff_lam = rho_val * c * mu
            res = erlang_c(c, eff_lam, mu)
            wait_vs_rho.append(min(res["W_mean"], 150) if res["stable"] else 150)

        fig_rho = go.Figure()
        fig_rho.add_trace(
            go.Scatter(
                x=np.round(rho_vals, 2),
                y=wait_vs_rho,
                mode="lines",
                line=dict(color=RED, width=2.5),
                fill="tozeroy",
                fillcolor="rgba(239,68,68,0.1)",
                name="Wait Time (min)",
                hovertemplate="ρ = %{x:.2f} → %{y:.1f} min<extra></extra>",
            )
        )
        fig_rho.add_vrect(
            x0=0.85,
            x1=0.99,
            fillcolor="rgba(239,68,68,0.06)",
            layer="below",
            line_width=0,
            annotation_text="Danger Zone",
            annotation_position="top left",
            annotation_font_color=RED,
            annotation_font_size=10,
        )
        if stable and r["rho"] < 0.99:
            fig_rho.add_trace(
                go.Scatter(
                    x=[round(r["rho"], 2)],
                    y=[r["W_mean"]],
                    mode="markers",
                    marker=dict(color=AMBER, size=14, symbol="diamond", line=dict(color=WHITE, width=2)),
                    name="Current ρ",
                    hovertemplate=f"Current ρ={r['rho']:.2f} → {r['W_mean']:.1f} min<extra></extra>",
                )
            )
        fig_rho.update_layout(**PLOT_LAYOUT, xaxis_title="Utilisation ρ (= λ / c×μ)", yaxis_title="Expected Wait (min)")

        # ── Chart 3: Hourly Daily Profile ────────────────────────────────────────
        flat_c = 5
        flat_waits: list[float] = []
        opt_waits: list[float] = []
        opt_tellers_per_hour: list[int] = []

        for lhr in DEMAND_PROFILE:
            r_flat = erlang_c(flat_c, lhr, mu)
            flat_waits.append(min(r_flat["W_mean"], 90) if r_flat["stable"] else 90)

            opt_c = optimal_tellers(lhr, mu, target_wait_min=10)
            r_opt = erlang_c(opt_c, lhr, mu)
            opt_waits.append(min(r_opt["W_mean"], 90) if r_opt["stable"] else 90)
            opt_tellers_per_hour.append(opt_c)

        fig_hourly = make_subplots(specs=[[{"secondary_y": True}]])
        fig_hourly.add_trace(
            go.Bar(
                x=HOUR_LABELS,
                y=flat_waits,
                name=f"Flat Staffing ({flat_c} tellers)",
                marker=dict(color="rgba(239,68,68,0.65)", line=dict(color=RED, width=1)),
                hovertemplate="%{x}: %{y:.1f} min (flat)<extra></extra>",
            ),
            secondary_y=False,
        )
        fig_hourly.add_trace(
            go.Bar(
                x=HOUR_LABELS,
                y=opt_waits,
                name="Demand-Matched (Erlang C)",
                marker=dict(color="rgba(16,185,129,0.65)", line=dict(color=GREEN, width=1)),
                hovertemplate="%{x}: %{y:.1f} min (optimised)<extra></extra>",
            ),
            secondary_y=False,
        )
        fig_hourly.add_trace(
            go.Scatter(
                x=HOUR_LABELS,
                y=DEMAND_PROFILE,
                name="Arrivals λ (right axis)",
                line=dict(color=AMBER, width=2, dash="dot"),
                marker=dict(color=AMBER, size=5),
                hovertemplate="%{x}: %{y} arrivals/hr<extra></extra>",
            ),
            secondary_y=True,
        )
        fig_hourly.add_trace(
            go.Scatter(
                x=HOUR_LABELS,
                y=opt_tellers_per_hour,
                name="Optimal Tellers (right)",
                line=dict(color="#a78bfa", width=1.5, dash="dashdot"),
                marker=dict(color="#a78bfa", size=5),
                hovertemplate="%{x}: %{y} tellers needed<extra></extra>",
            ),
            secondary_y=True,
        )
        fig_hourly.update_layout(
            **PLOT_LAYOUT,
            barmode="group",
            yaxis_title="Expected Wait (min)",
            yaxis2=dict(
                title=dict(text="Arrivals/hr · Tellers", font=dict(color=AMBER, size=10)),
                gridcolor="rgba(0,0,0,0)",
                tickfont=dict(color=AMBER, size=10),
            ),
        )

        # ── Chart 4: Service Rate Impact ─────────────────────────────────────────
        mu_range = list(range(3, 31))
        wait_vs_mu: list[float | None] = []
        for m in mu_range:
            res = erlang_c(c, lam, m)
            wait_vs_mu.append(res["W_mean"] if res["stable"] else None)

        fig_mu = go.Figure()
        fig_mu.add_trace(
            go.Scatter(
                x=mu_range,
                y=wait_vs_mu,
                mode="lines+markers",
                line=dict(color=GREEN, width=2.5),
                fill="tozeroy",
                fillcolor="rgba(16,185,129,0.1)",
                marker=dict(color=GREEN, size=5),
                name="Expected Wait (min)",
                hovertemplate="μ = %{x} → %{y:.1f} min<extra></extra>",
            )
        )
        if stable:
            r_mu = erlang_c(c, lam, mu)
            if r_mu["stable"]:
                fig_mu.add_trace(
                    go.Scatter(
                        x=[mu],
                        y=[r_mu["W_mean"]],
                        mode="markers",
                        marker=dict(color=AMBER, size=14, symbol="diamond", line=dict(color=WHITE, width=2)),
                        name="Current μ",
                        hovertemplate=f'Current μ={mu} → {r_mu["W_mean"]:.1f} min<extra></extra>',
                    )
                )
        fig_mu.update_layout(**PLOT_LAYOUT, xaxis_title="Service Rate μ (customers/hr/teller)", yaxis_title="Expected Wait (min)")

        df: pd.DataFrame = staffing_table(lam, mu)

        def row_style(row: pd.Series) -> str:
            is_current = int(row["Tellers (c)"]) == c
            bg = "rgba(37,99,235,0.1)" if is_current else "transparent"
            return bg

        table_rows: list[Component] = []
        for _, row in df.iterrows():
            is_current = int(row["Tellers (c)"]) == c
            row_bg = "rgba(37,99,235,0.1)" if is_current else "transparent"
            status = row["Status"]
            status_color = GREEN if "🟢" in status else AMBER if "🟡" in status else RED
            table_rows.append(
                html.Tr(
                    style={"background": row_bg},
                    children=[
                        html.Td(
                            f"{row['Tellers (c)']}{' ◀' if is_current else ''}",
                            style={
                                "color": WHITE if is_current else DIM,
                                "fontWeight": "600" if is_current else "400",
                                "fontFamily": "DM Mono",
                                "fontSize": "12px",
                                "padding": "9px 14px",
                                "borderBottom": f"1px solid {BORDER}",
                            },
                        ),
                        html.Td(
                            row["Utilisation ρ"],
                            style={
                                "fontFamily": "DM Mono",
                                "fontSize": "12px",
                                "color": DIM,
                                "padding": "9px 14px",
                                "borderBottom": f"1px solid {BORDER}",
                            },
                        ),
                        html.Td(
                            row["Exp. Wait (min)"],
                            style={
                                "fontFamily": "DM Mono",
                                "fontSize": "12px",
                                "color": DIM,
                                "padding": "9px 14px",
                                "borderBottom": f"1px solid {BORDER}",
                            },
                        ),
                        html.Td(
                            row["Prob. of Waiting"],
                            style={
                                "fontFamily": "DM Mono",
                                "fontSize": "12px",
                                "color": DIM,
                                "padding": "9px 14px",
                                "borderBottom": f"1px solid {BORDER}",
                            },
                        ),
                        html.Td(
                            status,
                            style={
                                "fontFamily": "DM Mono",
                                "fontSize": "11px",
                                "color": status_color,
                                "padding": "9px 14px",
                                "borderBottom": f"1px solid {BORDER}",
                            },
                        ),
                    ],
                )
            )

        table = html.Table(
            style={"width": "100%", "borderCollapse": "collapse"},
            children=[
                html.Thead(
                    html.Tr(
                        [
                            html.Th(
                                "Tellers (c)",
                                style={
                                    "fontFamily": "DM Mono",
                                    "fontSize": "10px",
                                    "letterSpacing": "0.1em",
                                    "textTransform": "uppercase",
                                    "color": MUTED,
                                    "padding": "8px 14px",
                                    "textAlign": "left",
                                    "borderBottom": f"1px solid {BORDER}",
                                },
                            ),
                            html.Th(
                                "Utilisation ρ",
                                style={
                                    "fontFamily": "DM Mono",
                                    "fontSize": "10px",
                                    "letterSpacing": "0.1em",
                                    "textTransform": "uppercase",
                                    "color": MUTED,
                                    "padding": "8px 14px",
                                    "textAlign": "left",
                                    "borderBottom": f"1px solid {BORDER}",
                                },
                            ),
                            html.Th(
                                "Exp. Wait",
                                style={
                                    "fontFamily": "DM Mono",
                                    "fontSize": "10px",
                                    "letterSpacing": "0.1em",
                                    "textTransform": "uppercase",
                                    "color": MUTED,
                                    "padding": "8px 14px",
                                    "textAlign": "left",
                                    "borderBottom": f"1px solid {BORDER}",
                                },
                            ),
                            html.Th(
                                "Prob. Wait",
                                style={
                                    "fontFamily": "DM Mono",
                                    "fontSize": "10px",
                                    "letterSpacing": "0.1em",
                                    "textTransform": "uppercase",
                                    "color": MUTED,
                                    "padding": "8px 14px",
                                    "textAlign": "left",
                                    "borderBottom": f"1px solid {BORDER}",
                                },
                            ),
                            html.Th(
                                "Status",
                                style={
                                    "fontFamily": "DM Mono",
                                    "fontSize": "10px",
                                    "letterSpacing": "0.1em",
                                    "textTransform": "uppercase",
                                    "color": MUTED,
                                    "padding": "8px 14px",
                                    "textAlign": "left",
                                    "borderBottom": f"1px solid {BORDER}",
                                },
                            ),
                        ]
                    )
                ),
                html.Tbody(table_rows),
            ],
        )

        return (
            kpi_wait,
            kpi_wait_sub,
            kpi_rho,
            kpi_rho_sub,
            kpi_prob,
            kpi_cap,
            kpi_cap_sub,
            warning_style,
            formula,
            f"{lam} cust/hr",
            f"{mu} cust/hr",
            f"{c} tellers",
            fig_tellers,
            fig_rho,
            fig_hourly,
            fig_mu,
            table,
        )

from __future__ import annotations

import math
from typing import TypedDict

import pandas as pd


class ErlangCResult(TypedDict):
    rho: float
    C: float
    W_mean: float
    W_lower: float
    W_upper: float
    stable: bool


def erlang_c(c: int, lam: float, mu: float) -> ErlangCResult:
    """
    Compute the Erlang C probability and expected queue wait time.

    Parameters
    ----------
    c   : int   — number of active tellers (servers)
    lam : float — customer arrival rate (customers per hour)
    mu  : float — service rate per teller (customers served per hour)

    Returns
    -------
    dict with keys:
        rho      : utilisation (0–1). If >= 1, queue is unstable.
        C        : Erlang C probability — probability customer must wait
        W_mean   : expected wait time in queue (minutes)
        W_lower  : lower bound of wait range (minutes)
        W_upper  : upper bound of wait range (minutes)
        stable   : bool — whether queue can reach steady state
    """
    rho = lam / (c * mu)

    if rho >= 1:
        return dict(
            rho=rho,
            C=1.0,
            W_mean=float("inf"),
            W_lower=float("inf"),
            W_upper=float("inf"),
            stable=False,
        )

    # ── Erlang C formula ──────────────────────────────────────────────────────
    #   Numerator:   (c*rho)^c / c! * 1/(1-rho)
    #   Denominator: sum_{k=0}^{c-1} (c*rho)^k / k!  +  numerator
    # ─────────────────────────────────────────────────────────────────────────
    a = lam / mu  # offered traffic intensity

    numerator = (a**c) / math.factorial(c) * (1 / (1 - rho))
    denominator = sum((a**k) / math.factorial(k) for k in range(c)) + numerator

    C = numerator / denominator  # probability of having to wait

    # ── Expected wait time in queue (converted to minutes) ────────────────────
    W_mean = (C / (c * mu - lam)) * 60  # hours → minutes

    # ── Asymmetric confidence range ───────────────────────────────────────────
    #   Empirically: overruns more likely than underruns at peak hours
    sigma = W_mean * 0.35  # approximate std dev as 35% of mean
    W_lower = max(0.0, W_mean - 1.0 * sigma)
    W_upper = W_mean + 1.5 * sigma

    return dict(
        rho=round(rho, 4),
        C=round(min(C, 1.0), 4),
        W_mean=round(W_mean, 2),
        W_lower=round(W_lower, 2),
        W_upper=round(W_upper, 2),
        stable=True,
    )


def optimal_tellers(lam: float, mu: float, target_wait_min: float = 10.0) -> int:
    """
    Return the minimum number of tellers needed to keep
    expected wait time below target_wait_min.
    """
    min_c = math.ceil(lam / mu) + 1  # minimum for stability
    for c in range(min_c, 50):
        result = erlang_c(c, lam, mu)
        if result["stable"] and result["W_mean"] <= target_wait_min:
            return c
    return 50  # cap


def staffing_table(lam: float, mu: float) -> pd.DataFrame:
    """
    Build a staffing recommendation table showing wait time
    and utilisation for a range of teller counts.
    """
    min_c = max(1, math.ceil(lam / mu))
    rows: list[dict[str, object]] = []
    for c in range(max(1, min_c - 1), min_c + 8):
        r = erlang_c(c, lam, mu)
        if r["stable"]:
            status = (
                "🟢 Excellent"
                if r["W_mean"] <= 5
                else "🟢 Good"
                if r["W_mean"] <= 10
                else "🟡 Acceptable"
                if r["W_mean"] <= 20
                else "🔴 Poor"
            )
        else:
            status = "🔴 Unstable"
        rows.append(
            {
                "Tellers (c)": c,
                "Utilisation ρ": f"{r['rho']*100:.0f}%",
                "Exp. Wait (min)": f"{r['W_mean']:.1f}" if r["stable"] else "∞",
                "Prob. of Waiting": f"{r['C']*100:.0f}%" if r["stable"] else "100%",
                "Status": status,
            }
        )
    return pd.DataFrame(rows)


# ── Typical branch hourly demand profile ─────────────────────────────────
HOUR_LABELS: list[str] = [
    "7am",
    "8am",
    "9am",
    "10am",
    "11am",
    "12pm",
    "1pm",
    "2pm",
    "3pm",
    "4pm",
    "5pm",
    "6pm"
]
DEMAND_PROFILE: list[int] = [8, 22, 48, 55, 50, 38, 42, 45, 40, 35, 25, 12]

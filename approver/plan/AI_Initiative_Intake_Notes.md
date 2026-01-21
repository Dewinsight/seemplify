# STERLING FINANCIAL HOLDINGS GROUP

## AI Initiative Intake Management System

### Engineering Technical Specification Notes

---


please note that this is an enhancement to the existing system and not a replacement so implement 1 - 3 

## 1. Initiative Classification System

### Tier Definitions (Based on Priority Score)

this tells us the classification of the initiative 

| Tier | Score Range | Characteristics |
|------|-------------|-----------------|
| Tier 1 (Low Risk) | 1.0 – 2.5 | Departmental scope, minimal regulatory impact |
| Tier 2 (Moderate Risk) | 2.6 – 3.5 | Cross-functional impact, moderate regulatory considerations |
| Tier 3 (High Risk) | 3.6 – 5.0 | Enterprise-wide impact, significant strategic/regulatory implications |

we will also use this to calculate the priority score of the initiative and order the initiatives based on the priority score which is different from the tier score



**Note:** All parameters are scored 1–5 where higher values indicate more favorable outcomes.

---

## 2. New scoring Parameter Definitions

| Parameter | Weight | Score 1 (Least Favorable) | Score 5 (Most Favorable) |
|-----------|--------|---------------------------|--------------------------|
| Strategic Alignment | 25% | Tangential to strategy | Transformational/competitive differentiator |
| Regulatory Risk | 25% | Low-risk compliance gap | Critical regulatory mandate |
| Business Impact | 20% | <₦50M annual value | >₦500M or transformational |
| Implementation Complexity | 15% | >12 months, major barriers | <3 months, straightforward |
| Time-to-Value | 10% | >18 months to value | <3 months to value |
| Resource Requirements | 5% | Extensive (large team, major infra) | Minimal (existing capacity) |

---


## 3. Workflow Routing Logic

| Tier | Approval Path | Max Duration |
|------|---------------|--------------|
| Tier 1 | Screening → Analysis → AI approve
| Tier 2 | Above + Governance Committee
| Tier 3 | Above + Executive Approval |




import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("validation_service")


class ValidationService:
    """
    Performs 100% resource completeness accounting, status classification,
    and financial cost reconciliation between source billing and target AWS architecture.
    """

    def validate_completeness(self, mapped_resources: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Classifies every resource into one of 4 strict completeness buckets:
        - MAPPED_VALIDATED: exact SKU or spec-matched mapping
        - MAPPED_ASSUMPTIONS: category heuristic or default sizing
        - REVIEW_REQUIRED: unmapped or unknown workload
        - EXCLUDED: zero-usage informational line items
        """
        total_count = len(mapped_resources)
        validated: List[Dict[str, Any]] = []
        assumptions: List[Dict[str, Any]] = []
        review_required: List[Dict[str, Any]] = []
        excluded: List[Dict[str, Any]] = []

        for res in mapped_resources:
            confidence = res.get("mapping_confidence", "")
            is_review = res.get("is_review_required", False)
            source_cost = float(res.get("source_cost", 0.0))
            usage = float(res.get("source_usage_amount", 0.0))

            if is_review or confidence == "review_required" or res.get("target_aws_service_code") == "REVIEW_REQUIRED":
                review_required.append({
                    "id": res.get("id"),
                    "source_name": res.get("source_service_name"),
                    "source_cost": source_cost,
                    "candidate_services": res.get("candidate_services", ["Amazon EC2", "AWS Lambda", "Amazon S3"]),
                    "reason": res.get("mapping_rationale") or "Workload could not be deterministically matched."
                })
            elif source_cost == 0.0 and usage == 0.0 and not res.get("source_sku"):
                excluded.append({
                    "id": res.get("id"),
                    "source_name": res.get("source_service_name"),
                    "reason": "Zero cost and zero usage non-infrastructure item."
                })
            elif confidence in ["exact_sku", "spec_matched"]:
                validated.append({
                    "id": res.get("id"),
                    "source_name": res.get("source_service_name"),
                    "target_service": res.get("target_aws_service"),
                    "instance_type": res.get("target_aws_instance_type"),
                    "confidence": confidence
                })
            else:
                assumptions.append({
                    "id": res.get("id"),
                    "source_name": res.get("source_service_name"),
                    "target_service": res.get("target_aws_service"),
                    "instance_type": res.get("target_aws_instance_type"),
                    "confidence": confidence,
                    "notes": res.get("notes")
                })

        val_pct = round((len(validated) / total_count * 100), 1) if total_count > 0 else 0.0
        assump_pct = round((len(assumptions) / total_count * 100), 1) if total_count > 0 else 0.0
        review_pct = round((len(review_required) / total_count * 100), 1) if total_count > 0 else 0.0
        excl_pct = round((len(excluded) / total_count * 100), 1) if total_count > 0 else 0.0

        is_100_percent = (len(validated) + len(assumptions) + len(review_required) + len(excluded)) == total_count

        return {
            "total_resources": total_count,
            "is_complete_accounting": is_100_percent,
            "counts": {
                "MAPPED_VALIDATED": len(validated),
                "MAPPED_ASSUMPTIONS": len(assumptions),
                "REVIEW_REQUIRED": len(review_required),
                "EXCLUDED": len(excluded)
            },
            "percentages": {
                "MAPPED_VALIDATED": val_pct,
                "MAPPED_ASSUMPTIONS": assump_pct,
                "REVIEW_REQUIRED": review_pct,
                "EXCLUDED": excl_pct
            },
            "items": {
                "validated": validated,
                "assumptions": assumptions,
                "review_required": review_required,
                "excluded": excluded
            }
        }

    def reconcile_costs(
        self,
        estimate_result: Dict[str, Any],
        calculator_scraped_monthly: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Reconciles financial figures across:
        1. Source Bill Cost
        2. Internal AWS Estimate (Workloads + Inferred)
        3. Scraped AWS Pricing Calculator Session (if available)
        """
        source_cost = float(estimate_result.get("total_source_bill_cost", 0.0))
        workloads_cost = float(estimate_result.get("workloads_monthly_cost_usd", 0.0))
        inferred_cost = float(estimate_result.get("inferred_monthly_cost_usd", 0.0))
        aws_total = float(estimate_result.get("total_monthly_cost_usd", 0.0))

        delta_usd = round(aws_total - source_cost, 2)
        delta_pct = round((delta_usd / source_cost * 100), 2) if source_cost > 0 else 0.0

        variance_drivers: List[str] = []
        if inferred_cost > 0:
            variance_drivers.append(f"Inferred auxiliary architecture (NAT Gateway, IPv4, Backup, CloudWatch) added ${inferred_cost:.2f}/mo.")
        if delta_usd > 10:
            variance_drivers.append(f"AWS On-Demand standard baseline pricing applied without 1-yr/3-yr Savings Plans or Reserved Instances.")
        elif delta_usd < -10:
            variance_drivers.append(f"AWS cost is lower than source cloud bill, primarily due to cost-effective gp3 storage and burstable instance efficiencies.")
        else:
            variance_drivers.append("Target AWS estimate is closely aligned within +/- $10 of source cloud bill.")

        reconciliation = {
            "source_monthly_bill_usd": round(source_cost, 2),
            "aws_direct_workloads_monthly_usd": round(workloads_cost, 2),
            "aws_inferred_infrastructure_monthly_usd": round(inferred_cost, 2),
            "aws_total_estimated_monthly_usd": round(aws_total, 2),
            "aws_total_estimated_annual_usd": float(estimate_result.get("total_annual_cost_usd", round(aws_total * 12, 2))),
            "delta_usd": delta_usd,
            "delta_percentage": delta_pct,
            "variance_drivers": variance_drivers
        }

        if calculator_scraped_monthly is not None:
            calc_delta = round(calculator_scraped_monthly - aws_total, 2)
            reconciliation["calculator_scraped_monthly_usd"] = round(calculator_scraped_monthly, 2)
            reconciliation["calculator_vs_internal_delta_usd"] = calc_delta
            reconciliation["calculator_reconciled"] = abs(calc_delta) < (aws_total * 0.15)

        return reconciliation


validation_service = ValidationService()

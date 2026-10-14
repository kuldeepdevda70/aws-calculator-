import unittest
from app.services.validation_service import validation_service


class TestValidationAndReconciliation(unittest.TestCase):
    def test_completeness_accounting_100_percent(self):
        resources = [
            {"id": "1", "source_service_name": "VM1", "mapping_confidence": "exact_sku", "source_cost": 50.0},
            {"id": "2", "source_service_name": "VM2", "mapping_confidence": "spec_matched", "source_cost": 80.0},
            {"id": "3", "source_service_name": "DB1", "mapping_confidence": "category_rule", "source_cost": 100.0},
            {"id": "4", "source_service_name": "Unknown", "mapping_confidence": "review_required", "source_cost": 30.0, "is_review_required": True},
            {"id": "5", "source_service_name": "Header Row", "source_cost": 0.0, "source_usage_amount": 0.0}
        ]

        result = validation_service.validate_completeness(resources)
        self.assertTrue(result["is_complete_accounting"])
        self.assertEqual(result["total_resources"], 5)
        self.assertEqual(result["counts"]["MAPPED_VALIDATED"], 2)
        self.assertEqual(result["counts"]["MAPPED_ASSUMPTIONS"], 1)
        self.assertEqual(result["counts"]["REVIEW_REQUIRED"], 1)
        self.assertEqual(result["counts"]["EXCLUDED"], 1)

    def test_cost_reconciliation_variance(self):
        estimate_result = {
            "total_source_bill_cost": 200.0,
            "workloads_monthly_cost_usd": 180.0,
            "inferred_monthly_cost_usd": 40.0,
            "total_monthly_cost_usd": 220.0,
            "total_annual_cost_usd": 2640.0
        }

        reconciliation = validation_service.reconcile_costs(estimate_result, calculator_scraped_monthly=225.0)
        self.assertEqual(reconciliation["source_monthly_bill_usd"], 200.0)
        self.assertEqual(reconciliation["aws_total_estimated_monthly_usd"], 220.0)
        self.assertEqual(reconciliation["delta_usd"], 20.0)
        self.assertEqual(reconciliation["delta_percentage"], 10.0)
        self.assertTrue(reconciliation["calculator_reconciled"])
        self.assertGreater(len(reconciliation["variance_drivers"]), 0)


if __name__ == "__main__":
    unittest.main()

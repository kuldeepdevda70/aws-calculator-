import unittest
import openpyxl
from app.services.export_service import export_service


class TestExports(unittest.TestCase):
    def setUp(self):
        self.estimate_data = {
            "status": "success",
            "default_region": "ap-south-1",
            "total_monthly_cost_usd": 212.53,
            "total_annual_cost_usd": 2550.36,
            "workloads_monthly_cost_usd": 171.75,
            "inferred_monthly_cost_usd": 40.78,
            "total_source_bill_cost": 218.71,
            "category_breakdown_usd": {"Compute": 30.37, "Database": 49.64, "Storage": 10.24, "Networking": 122.28},
            "total_resources_calculated": 5,
            "priced_resources": [
                {
                    "source_service_name": "Virtual Machines",
                    "source_cost": 70.0,
                    "target_aws_service": "Amazon EC2",
                    "target_aws_instance_type": "t3.medium",
                    "target_quantity": 1.0,
                    "target_storage_gb": 0.0,
                    "pricing_unit_rate": 0.0416,
                    "monthly_cost_usd": 30.37,
                    "annual_cost_usd": 364.44,
                    "mapping_confidence": "exact_sku",
                    "mapping_rationale": "Exact SKU matched Standard_D2s_v3"
                }
            ],
            "inferred_infrastructure": [
                {
                    "target_aws_service": "Amazon VPC",
                    "target_aws_instance_type": "NAT Gateway",
                    "target_quantity": 1.0,
                    "pricing_unit_rate": 0.0450,
                    "pricing_unit_type": "hour",
                    "monthly_cost_usd": 32.85,
                    "annual_cost_usd": 394.20,
                    "rationale": "Required for outbound internet access in private subnets"
                }
            ]
        }

    def test_excel_export_multi_tabs(self):
        stream = export_service.generate_excel_report(self.estimate_data)
        self.assertGreater(len(stream.getvalue()), 5000)

        # Inspect sheet names
        wb = openpyxl.load_workbook(stream)
        expected_sheets = ["Executive Summary", "Itemized Workloads", "Inferred Infrastructure", "Completeness & Reconciliation"]
        for s in expected_sheets:
            self.assertIn(s, wb.sheetnames)

    def test_pdf_export(self):
        stream = export_service.generate_pdf_report(self.estimate_data)
        self.assertGreater(len(stream.getvalue()), 2000)
        # Check PDF header signature %PDF-
        self.assertTrue(stream.getvalue().startswith(b"%PDF-"))


if __name__ == "__main__":
    unittest.main()

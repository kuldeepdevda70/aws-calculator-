import unittest
from pathlib import Path
from app.services.bill_parser import bill_parser
from app.services.tabular_service import tabular_service


class TestTabularParser(unittest.TestCase):
    def test_sample_azure_bill_parsing(self):
        sample_path = Path("sample_bills/sample_azure_bill.csv")
        self.assertTrue(sample_path.exists(), "Sample Azure bill must exist")

        with open(sample_path, "rb") as f:
            content = f.read()

        parsed = bill_parser.parse_bill(content, "sample_azure_bill.csv")
        self.assertEqual(parsed["detected_provider"], "Microsoft Azure")
        self.assertEqual(parsed["detected_currency"], "USD")
        self.assertEqual(parsed["total_items"], 5)

        items = parsed["items"]
        # Check first item (Compute)
        vm_item = items[0]
        self.assertEqual(vm_item["sku"], "Standard_D2s_v3")
        self.assertEqual(vm_item["source_region"], "us-east-1")
        self.assertIn("raw_record", vm_item)
        self.assertEqual(vm_item["raw_record"]["Meter Name"], "Standard_D2s_v3")

    def test_column_priority_scoring(self):
        # When both ResourceType and MeterName are present, MeterName must win for SKU
        cols = ["SubscriptionId", "ResourceType", "MeterCategory", "MeterName", "PreTaxCost", "ResourceLocation"]
        mapped = tabular_service._map_columns(cols)
        self.assertEqual(mapped.get("MeterName"), "sku")
        self.assertEqual(mapped.get("PreTaxCost"), "cost")
        self.assertEqual(mapped.get("ResourceLocation"), "region")


if __name__ == "__main__":
    unittest.main()

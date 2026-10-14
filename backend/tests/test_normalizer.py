import unittest
from app.services.normalizer import resource_normalizer


class TestResourceNormalizer(unittest.TestCase):
    def test_provider_detection_scoring(self):
        azure_text = "Microsoft Azure Invoice subscription id resource group meter name"
        gcp_text = "Google Cloud Platform project id compute engine cloud storage"
        aws_text = "Amazon Web Services account id arn:aws:ec2 elastic compute"
        do_text = "DigitalOcean droplet spaces bandwidth pool"

        self.assertEqual(resource_normalizer.detect_provider(azure_text), "Microsoft Azure")
        self.assertEqual(resource_normalizer.detect_provider(gcp_text), "Google Cloud Platform")
        self.assertEqual(resource_normalizer.detect_provider(aws_text), "Amazon Web Services")
        self.assertEqual(resource_normalizer.detect_provider(do_text), "DigitalOcean")
        self.assertEqual(resource_normalizer.detect_provider("random unidentifiable text"), "Unknown Cloud")

    def test_currency_detection_no_false_positive(self):
        # Text containing "Hours" and "Users" must NOT be detected as INR!
        usd_text = "Total Usage 730 Hours for 15 Users. Amount: $150.00 USD"
        currency, symbol = resource_normalizer.detect_currency(usd_text)
        self.assertEqual(currency, "USD")
        self.assertEqual(symbol, "$")

        # Explicit INR
        inr_text = "Tax invoice GSTIN 27AAAC1234F1Z5 Amount: ₹ 12,500 INR"
        currency_inr, symbol_inr = resource_normalizer.detect_currency(inr_text)
        self.assertEqual(currency_inr, "INR")
        self.assertEqual(symbol_inr, "₹")

    def test_region_normalization(self):
        self.assertEqual(resource_normalizer.normalize_region("centralindia"), "ap-south-1")
        self.assertEqual(resource_normalizer.normalize_region("eastus"), "us-east-1")
        self.assertEqual(resource_normalizer.normalize_region("westeurope"), "eu-west-1")
        self.assertEqual(resource_normalizer.normalize_region("blr1"), "ap-south-1")
        self.assertEqual(resource_normalizer.normalize_region("asia-south1"), "ap-south-1")
        self.assertEqual(resource_normalizer.normalize_region(None, default_region="ap-south-1"), "ap-south-1")

    def test_spec_extraction(self):
        specs1 = resource_normalizer.extract_specs("Virtual Machine 4 vCPU 16 GB RAM")
        self.assertEqual(specs1["vcpu"], 4.0)
        self.assertEqual(specs1["ram_gb"], 16.0)

        specs2 = resource_normalizer.extract_specs("Standard_D2s_v3", sku="Standard_D2s_v3")
        self.assertEqual(specs2["vcpu"], 2.0)
        self.assertEqual(specs2["ram_gb"], 8.0)
        self.assertEqual(specs2["confidence"], "catalog_exact")

        specs_db = resource_normalizer.extract_specs("Azure Database for PostgreSQL Flexible Server")
        self.assertEqual(specs_db["database_engine"], "PostgreSQL")

    def test_find_closest_ec2(self):
        # 2 vCPU, 4 GB RAM -> t3.medium
        fit1 = resource_normalizer.find_closest_ec2_instance(2, 4)
        self.assertEqual(fit1["instance"], "t3.medium")

        # 4 vCPU, 16 GB RAM -> t3.xlarge
        fit2 = resource_normalizer.find_closest_ec2_instance(4, 16)
        self.assertEqual(fit2["instance"], "t3.xlarge")

        # 2 vCPU, 8 GB RAM with compute family preference -> c5.xlarge or m5.large
        fit3 = resource_normalizer.find_closest_ec2_instance(2, 8)
        self.assertIn(fit3["instance"], ["m5.large", "t3.large"])


if __name__ == "__main__":
    unittest.main()

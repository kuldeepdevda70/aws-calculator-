import unittest
from app.services.pricing_service import pricing_service


class TestPricingAndInferred(unittest.TestCase):
    def test_storage_math_no_squared_multiplication(self):
        # 1 volume of 128 GB gp3 disk in ap-south-1 (rate $0.08/GB-month)
        ebs_resource = {
            "target_aws_service": "Amazon EBS",
            "target_aws_service_code": "AmazonEBS",
            "target_aws_instance_type": "gp3",
            "target_aws_region": "ap-south-1",
            "target_quantity": 1.0,
            "target_storage_gb": 128.0
        }
        priced = pricing_service.calculate_resource_cost(ebs_resource)
        # Expected: 128 * 0.08 = $10.24
        self.assertEqual(priced["monthly_cost_usd"], 10.24)
        self.assertEqual(priced["pricing_unit_rate"], 0.08)

    def test_inferred_infrastructure_detection(self):
        resources = [
            {
                "target_aws_service": "Amazon EC2",
                "target_aws_service_code": "AmazonEC2",
                "target_aws_instance_type": "t3.medium",
                "target_quantity": 2.0,
                "target_storage_gb": 0.0
            },
            {
                "target_aws_service": "Amazon EBS",
                "target_aws_service_code": "AmazonEBS",
                "target_aws_instance_type": "gp3",
                "target_quantity": 2.0,
                "target_storage_gb": 100.0
            }
        ]

        inferred = pricing_service.detect_inferred_infrastructure(resources)
        inferred_codes = [inf["target_aws_service_code"] for inf in inferred]

        # Must infer NAT Gateway (for VPC compute), Public IPv4, Egress, Backup, CloudWatch
        self.assertIn("AWSVPC", inferred_codes)
        self.assertIn("AWSDataTransfer", inferred_codes)
        self.assertIn("AWSBackup", inferred_codes)
        self.assertIn("CloudWatch", inferred_codes)

    def test_total_estimate_with_inferred(self):
        resources = [
            {
                "target_aws_service": "Amazon EC2",
                "target_aws_service_code": "AmazonEC2",
                "target_aws_instance_type": "t3.medium",
                "target_aws_region": "ap-south-1",
                "target_quantity": 1.0,
                "target_storage_gb": 0.0
            }
        ]
        # Total without inferred
        est_without = pricing_service.calculate_total_estimate(resources, include_inferred=False)
        # Total with inferred
        est_with = pricing_service.calculate_total_estimate(resources, include_inferred=True)

        self.assertGreater(est_with["total_monthly_cost_usd"], est_without["total_monthly_cost_usd"])
        self.assertEqual(est_with["workloads_monthly_cost_usd"], est_without["total_monthly_cost_usd"])
        self.assertGreater(est_with["inferred_monthly_cost_usd"], 0)


if __name__ == "__main__":
    unittest.main()

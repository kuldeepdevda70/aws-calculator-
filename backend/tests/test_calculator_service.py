import unittest
from app.services.calculator_service import calculator_service


class TestCalculatorService(unittest.TestCase):
    def test_build_dynamic_workloads_no_artificial_four_cap(self):
        resources = [
            {"target_aws_service": "Amazon EC2", "target_aws_instance_type": "t3.medium", "target_quantity": 2},
            {"target_aws_service": "Amazon EC2", "target_aws_instance_type": "m5.large", "target_quantity": 1},
            {"target_aws_service": "Amazon EBS", "target_storage_gb": 100},
            {"target_aws_service": "Amazon EBS", "target_storage_gb": 200},
            {"target_aws_service": "Amazon RDS", "db_engine": "PostgreSQL", "target_aws_instance_type": "db.t3.medium"},
            {"target_aws_service": "Amazon S3", "target_storage_gb": 500}
        ]

        workloads = calculator_service._build_dynamic_workloads(resources)
        # Should include distinct EC2 groups, EBS, RDS, S3 without truncation to 4
        types = [w["type"] for w in workloads]
        self.assertIn("ec2", types)
        self.assertIn("ebs", types)
        self.assertIn("rds", types)
        self.assertIn("s3", types)
        # Check that both t3.medium and m5.large were grouped
        ec2_insts = [w.get("instance_type") for w in workloads if w["type"] == "ec2"]
        self.assertIn("t3.medium", ec2_insts)
        self.assertIn("m5.large", ec2_insts)


if __name__ == "__main__":
    unittest.main()

import unittest
from app.services.aws_mapper import aws_mapper


class TestAWSMapper(unittest.TestCase):
    def test_compute_mapping(self):
        item = {
            "id": "1",
            "source_service_name": "Virtual Machines",
            "sku": "Standard_D2s_v3",
            "usage_amount": 730,
            "usage_unit": "Hours",
            "cost": 70.0,
            "source_region": "eastus"
        }
        mapped = aws_mapper.map_workload(item)
        self.assertEqual(mapped["target_aws_service"], "Amazon EC2")
        self.assertEqual(mapped["target_aws_instance_type"], "t3.medium")
        self.assertEqual(mapped["target_quantity"], 1.0)
        self.assertEqual(mapped["mapping_confidence"], "exact_sku")
        self.assertEqual(mapped["target_aws_region"], "us-east-1")

    def test_storage_disk_sizing(self):
        # 128 GB P10 disk
        item = {
            "id": "2",
            "source_service_name": "Storage Accounts",
            "sku": "P10",
            "usage_amount": 1,
            "usage_unit": "Disks",
            "cost": 19.71
        }
        mapped = aws_mapper.map_workload(item)
        self.assertEqual(mapped["target_aws_service"], "Amazon EBS")
        self.assertEqual(mapped["target_aws_instance_type"], "gp3")
        self.assertEqual(mapped["target_storage_gb"], 128.0)
        self.assertEqual(mapped["target_quantity"], 1.0)

    def test_unknown_workload_review_required(self):
        item = {
            "id": "3",
            "source_service_name": "Unusual Proprietary Custom Engine",
            "sku": "custom_unknown_1",
            "usage_amount": 1,
            "cost": 50.0
        }
        mapped = aws_mapper.map_workload(item)
        self.assertEqual(mapped["target_aws_service_code"], "REVIEW_REQUIRED")
        self.assertTrue(mapped["is_review_required"])
        self.assertEqual(mapped["mapping_confidence"], "review_required")
        self.assertIn("Amazon EC2", mapped["candidate_services"])

    def test_database_engine_mapping(self):
        item = {
            "id": "4",
            "source_service_name": "Azure Database for PostgreSQL",
            "sku": "GeneralPurpose_GP_Gen5_2",
            "cost": 120.0
        }
        mapped = aws_mapper.map_workload(item)
        self.assertEqual(mapped["target_aws_service"], "Amazon RDS")
        self.assertEqual(mapped["db_engine"], "PostgreSQL")


if __name__ == "__main__":
    unittest.main()

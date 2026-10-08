import logging
import re
from typing import Any, Dict, List, Optional
from app.core.config import settings

logger = logging.getLogger("aws_mapper")


class AWSMapper:
    """
    Translates third-party cloud workloads (Azure, GCP, DigitalOcean, etc.)
    into equivalent AWS architecture components (EC2, EBS, S3, RDS, Route 53, Data Transfer)
    using configurable mapping rules defined in config/rules.json.
    """

    def __init__(self):
        self._rules = None

    @property
    def rules(self) -> Dict[str, Any]:
        """Lazy load or refresh configuration rules."""
        return settings.load_rules()

    def map_workload(self, item: Dict[str, Any], target_region: Optional[str] = None) -> Dict[str, Any]:
        """Maps an individual cloud workload item to an AWS equivalent resource."""
        rules = self.rules
        region = target_region or settings.AWS_REGION
        desc = (item.get("source_service_name") or item.get("raw_description") or "").lower()
        sku_raw = (item.get("sku") or "").lower().replace("-", "_").replace(".", "_")

        # 1. Detect service category & AWS target service
        target_service = "Amazon EC2"
        target_service_code = "AmazonEC2"
        default_instance = "t3.medium"
        category_name = "Compute"

        category_rules = rules.get("service_category_rules", [])
        for cat in category_rules:
            keywords = cat.get("keywords", [])
            if any(kw in desc for kw in keywords):
                target_service = cat.get("target_aws_service", "Amazon EC2")
                target_service_code = cat.get("target_aws_service_code", "AmazonEC2")
                default_instance = cat.get("default_instance", "t3.medium")
                category_name = cat.get("category", "General")
                break

        # 2. Resolve matching AWS instance type or SKU
        instance_mappings = rules.get("instance_mappings", {})
        mapped_instance = default_instance
        vcpu = 2
        ram_gb = 4.0
        storage_gb = 0.0
        match_confidence = "category_default"

        # Check explicit SKU match
        matched_spec = None
        if sku_raw and sku_raw in instance_mappings:
            matched_spec = instance_mappings[sku_raw]
            match_confidence = "exact_sku"
        else:
            # Check for partial SKU in description
            for k, spec in instance_mappings.items():
                if k in desc.replace("-", "_").replace(".", "_").replace(" ", "_"):
                    matched_spec = spec
                    match_confidence = "keyword_spec"
                    break

        if matched_spec:
            mapped_instance = matched_spec.get("aws_instance", default_instance)
            vcpu = matched_spec.get("vcpu", 2)
            ram_gb = matched_spec.get("ram_gb", 4.0)
            storage_gb = matched_spec.get("storage_gb", 0.0)

        # 3. Handle storage size parsing for disks/storage if not set
        usage_amt = float(item.get("usage_amount") or 1.0)
        if target_service_code == "AmazonEBS" and storage_gb == 0.0:
            # Check if usage amount looks like gigabytes or disks
            storage_gb = usage_amt if usage_amt >= 10 else 100.0

        return {
            "id": item.get("id"),
            "source_provider": item.get("source_provider", "Unknown Cloud"),
            "source_service_name": item.get("source_service_name", "Cloud Resource"),
            "source_sku": item.get("sku"),
            "source_cost": float(item.get("cost", 0.0)),
            "source_usage_amount": usage_amt,
            "source_usage_unit": item.get("usage_unit", "Units"),
            "source_region": item.get("source_region", "default"),
            
            # AWS Mapping Results
            "target_aws_service": target_service,
            "target_aws_service_code": target_service_code,
            "target_aws_category": category_name,
            "target_aws_instance_type": mapped_instance,
            "target_aws_region": region,
            "target_vcpu": vcpu,
            "target_ram_gb": ram_gb,
            "target_storage_gb": storage_gb,
            "target_quantity": 1 if target_service_code in ["AmazonEC2", "AmazonRDS"] else max(1.0, round(usage_amt, 2)),
            "mapping_confidence": match_confidence,
            "notes": f"Mapped {item.get('source_service_name', '')[:35]} to {target_service} ({mapped_instance})"
        }

    def map_all(self, items: List[Dict[str, Any]], target_region: Optional[str] = None) -> List[Dict[str, Any]]:
        """Maps a collection of parsed bill items into standard AWS resource specifications."""
        mapped = []
        for item in items:
            mapped.append(self.map_workload(item, target_region))
        return mapped

    def get_mapping_options(self) -> Dict[str, Any]:
        """Provides available regions, services, and instance options for the frontend edit interface."""
        rules = self.rules
        return {
            "default_region": settings.AWS_REGION,
            "supported_regions": rules.get("supported_aws_regions", [
                {"code": "ap-south-1", "name": "Asia Pacific (Mumbai) [Default]"}
            ]),
            "available_services": rules.get("available_aws_services", []),
            "common_instances": rules.get("instance_mappings", {})
        }


aws_mapper = AWSMapper()

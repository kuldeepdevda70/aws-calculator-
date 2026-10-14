import logging
import re
from typing import Any, Dict, List, Optional
from app.core.config import settings
from app.services.normalizer import resource_normalizer

logger = logging.getLogger("aws_mapper")


class AWSMapper:
    """
    Translates third-party cloud workloads (Azure, GCP, DigitalOcean, etc.)
    into equivalent AWS architecture components (EC2, EBS, S3, RDS, Route 53, Data Transfer)
    using configurable mapping rules, spec matching, and confidence classification.
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
        
        # Region resolution: explicit target_region > item source_region > settings default
        item_region = item.get("source_region")
        selected_region = target_region or (item_region if item_region and item_region != "default" else None) or settings.AWS_REGION
        region = resource_normalizer.normalize_region(selected_region)

        service_name = item.get("source_service_name") or ""
        desc = f"{service_name} {item.get('raw_description') or ''}".lower()
        sku_raw = (item.get("sku") or "").lower().replace("-", "_").replace(".", "_")

        # Extract specs if not already present
        specs = item.get("specs") or resource_normalizer.extract_specs(
            service_name,
            sku=item.get("sku"),
            unit=item.get("usage_unit")
        )

        # 1. Detect service category & AWS target service
        matched_cat_rule = None
        category_rules = rules.get("service_category_rules", [])
        for cat in category_rules:
            keywords = cat.get("keywords", [])
            if any(kw in desc for kw in keywords):
                matched_cat_rule = cat
                break

        # Check explicit instance mappings catalog
        instance_mappings = rules.get("instance_mappings", {})
        matched_instance_spec = None
        is_exact_sku = False
        if sku_raw and sku_raw in instance_mappings:
            matched_instance_spec = instance_mappings[sku_raw]
            is_exact_sku = True
        else:
            for k, spec in instance_mappings.items():
                if k in desc.replace("-", "_").replace(".", "_").replace(" ", "_"):
                    matched_instance_spec = spec
                    break

        # 2. Determine target service and handle unmapped items
        target_service = "Amazon EC2"
        target_service_code = "AmazonEC2"
        default_instance = "t3.medium"
        category_name = "Compute"
        is_review_required = False
        match_confidence = "category_default"
        mapping_rationale = ""
        candidate_services: List[str] = []

        if is_exact_sku and matched_instance_spec:
            mapped_inst_name = matched_instance_spec.get("aws_instance", "t3.medium")
            if mapped_inst_name in ["gp3", "gp2", "io2", "st1", "sc1"]:
                target_service = "Amazon EBS"
                target_service_code = "AmazonEBS"
                category_name = "Block Storage"
            elif mapped_inst_name.startswith("db."):
                target_service = "Amazon RDS"
                target_service_code = "AmazonRDS"
                category_name = "Database"
            elif mapped_inst_name.startswith("cache."):
                target_service = "Amazon ElastiCache"
                target_service_code = "AmazonElastiCache"
                category_name = "Cache"
            else:
                target_service = "Amazon EC2"
                target_service_code = "AmazonEC2"
                category_name = "Compute"
            default_instance = mapped_inst_name
            match_confidence = "exact_sku"
            mapping_rationale = f"Matched source SKU '{item.get('sku')}' directly in instance catalog."
        elif matched_cat_rule:
            target_service = matched_cat_rule.get("target_aws_service", "Amazon EC2")
            target_service_code = matched_cat_rule.get("target_aws_service_code", "AmazonEC2")
            default_instance = matched_cat_rule.get("default_instance", "t3.medium")
            category_name = matched_cat_rule.get("category", "General")
            match_confidence = "category_rule"
            mapping_rationale = f"Matched category rule '{category_name}' from workload description."
        elif matched_instance_spec:
            # If instance was found via partial keyword in description
            mapped_inst_name = matched_instance_spec.get("aws_instance", "t3.medium")
            if mapped_inst_name.startswith("db."):
                target_service = "Amazon RDS"
                target_service_code = "AmazonRDS"
                category_name = "Database"
            elif mapped_inst_name.startswith("cache."):
                target_service = "Amazon ElastiCache"
                target_service_code = "AmazonElastiCache"
                category_name = "Cache"
            elif mapped_inst_name in ["gp3", "gp2", "io2", "st1", "sc1"]:
                target_service = "Amazon EBS"
                target_service_code = "AmazonEBS"
                category_name = "Block Storage"
            else:
                target_service = "Amazon EC2"
                target_service_code = "AmazonEC2"
                category_name = "Compute"
            default_instance = mapped_inst_name
            match_confidence = "keyword_spec"
            mapping_rationale = f"Matched instance '{mapped_inst_name}' from description."
        else:
            # Check if compute indicators are present
            compute_indicators = ["virtual machine", "server", "instance", "vm", "vcore", "compute", "node", "cpu"]
            if any(ind in desc for ind in compute_indicators):
                target_service = "Amazon EC2"
                target_service_code = "AmazonEC2"
                category_name = "Compute"
                default_instance = "t3.medium"
                match_confidence = "category_rule"
                mapping_rationale = "Inferred EC2 compute workload from compute keywords."
            else:
                # Do NOT silently fallback to EC2! Flag as REVIEW_REQUIRED
                is_review_required = True
                target_service = "Unmapped / Review Required"
                target_service_code = "REVIEW_REQUIRED"
                category_name = "Unmapped"
                default_instance = "Manual Review"
                match_confidence = "review_required"
                mapping_rationale = f"Workload '{service_name[:40]}' could not be deterministically mapped. Manual review required."
                candidate_services = ["Amazon EC2", "AWS Lambda", "Amazon S3", "Amazon ECS", "AWS Site-to-Site VPN"]

        # 3. Resolve sizing, specs, and quantities
        mapped_instance = default_instance
        vcpu = 2.0
        ram_gb = 4.0
        storage_gb = 0.0
        usage_amt = float(item.get("usage_amount") or 1.0)
        target_quantity = 1.0
        db_engine = None

        if not is_review_required:
            if matched_instance_spec:
                mapped_instance = matched_instance_spec.get("aws_instance", default_instance)
                vcpu = float(matched_instance_spec.get("vcpu", 2))
                ram_gb = float(matched_instance_spec.get("ram_gb", 4.0))
                storage_gb = float(matched_instance_spec.get("storage_gb", 0.0))
                match_confidence = "exact_sku"
                mapping_rationale = f"Exact SKU match '{sku_raw}' -> {mapped_instance}."

            elif target_service_code == "AmazonEC2":
                # Dynamic spec-based EC2 matcher
                spec_vcpu = float(specs.get("vcpu", 0))
                spec_ram = float(specs.get("ram_gb", 0))
                if spec_vcpu > 0 or spec_ram > 0:
                    matched_ec2 = resource_normalizer.find_closest_ec2_instance(spec_vcpu, spec_ram)
                    mapped_instance = matched_ec2["instance"]
                    vcpu = matched_ec2["vcpu"]
                    ram_gb = matched_ec2["ram_gb"]
                    match_confidence = "spec_matched"
                    mapping_rationale = f"Dynamically matched EC2 instance {mapped_instance} based on requested specs ({spec_vcpu} vCPU, {spec_ram} GB RAM)."
                else:
                    mapped_instance = default_instance
                    match_confidence = "category_default"
                    mapping_rationale = f"Defaulted to {default_instance} for general compute workload."

            elif target_service_code == "AmazonRDS":
                db_engine = specs.get("database_engine") or resource_normalizer._detect_db_engine(desc) or "PostgreSQL"
                spec_vcpu = float(specs.get("vcpu", 0))
                spec_ram = float(specs.get("ram_gb", 0))
                if spec_vcpu >= 4 or spec_ram >= 16:
                    mapped_instance = "db.m5.large"
                    vcpu = 2.0
                    ram_gb = 8.0
                elif spec_vcpu >= 2 or spec_ram >= 4:
                    mapped_instance = "db.t3.medium"
                    vcpu = 2.0
                    ram_gb = 4.0
                else:
                    mapped_instance = "db.t3.small"
                    vcpu = 2.0
                    ram_gb = 2.0
                mapping_rationale = f"Mapped relational database cluster ({db_engine} on {mapped_instance})."

            elif target_service_code == "AmazonEBS":
                # Storage disks: determine storage size in GB
                if specs.get("storage_gb", 0) > 0:
                    storage_gb = float(specs["storage_gb"])
                elif "gb" in str(item.get("usage_unit", "")).lower() or usage_amt >= 10:
                    storage_gb = usage_amt
                elif storage_gb <= 0:
                    storage_gb = 100.0  # standard baseline disk
                mapped_instance = "gp3"
                target_quantity = 1.0  # 1 disk volume
                mapping_rationale = f"Mapped block storage volume ({storage_gb:.0f} GB gp3)."

            elif target_service_code == "AmazonS3":
                storage_gb = max(usage_amt, 20.0) if "gb" in str(item.get("usage_unit", "")).lower() else 50.0
                mapped_instance = "Standard"
                target_quantity = 1.0
                mapping_rationale = f"Mapped S3 object storage bucket ({storage_gb:.0f} GB Standard)."

            elif target_service_code == "AWSDataTransfer":
                target_quantity = max(usage_amt, 10.0)
                mapped_instance = "Internet Out"
                mapping_rationale = f"Mapped outbound network data transfer ({target_quantity:.1f} GB)."

            elif target_service_code == "AWSELB":
                target_quantity = max(1.0, usage_amt if usage_amt < 10 else 1.0)
                mapped_instance = "Application Load Balancer"
                mapping_rationale = f"Mapped AWS Application Load Balancer (ALB)."

            elif target_service_code == "AWSVPN":
                target_quantity = max(1.0, usage_amt if usage_amt < 10 else 1.0)
                mapped_instance = "VPN Connection"
                mapping_rationale = f"Mapped AWS Site-to-Site VPN Connection."

            elif target_service_code == "AWSVPC":
                if "nat" in desc:
                    mapped_instance = "NAT Gateway"
                    target_quantity = 1.0
                    mapping_rationale = "Mapped VPC NAT Gateway."
                else:
                    mapped_instance = "Public IPv4 Address"
                    target_quantity = usage_amt if usage_amt > 0 else 1.0
                    mapping_rationale = f"Mapped Public IPv4 Address ({target_quantity} units)."

        return {
            "id": item.get("id"),
            "source_provider": item.get("source_provider", "Unknown Cloud"),
            "source_service_name": service_name or "Cloud Resource",
            "source_sku": item.get("sku"),
            "source_cost": float(item.get("cost", 0.0)),
            "source_usage_amount": usage_amt,
            "source_usage_unit": item.get("usage_unit", "Units"),
            "source_region": item_region or region,
            "raw_record": item.get("raw_record") or item.get("raw_data") or {},

            # AWS Mapping Results
            "target_aws_service": target_service,
            "target_aws_service_code": target_service_code,
            "target_aws_category": category_name,
            "target_aws_instance_type": mapped_instance,
            "target_aws_region": region,
            "target_vcpu": vcpu,
            "target_ram_gb": ram_gb,
            "target_storage_gb": storage_gb,
            "target_quantity": target_quantity,
            "db_engine": db_engine,
            "mapping_confidence": match_confidence,
            "mapping_rationale": mapping_rationale,
            "is_review_required": is_review_required,
            "candidate_services": candidate_services,
            "notes": mapping_rationale or f"Mapped {service_name[:35]} to {target_service} ({mapped_instance})"
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

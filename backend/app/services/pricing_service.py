import json
import logging
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from app.core.config import settings

logger = logging.getLogger("pricing_service")

# Baseline official AWS On-Demand hourly/unit rates in ap-south-1 (Mumbai) and major regions
REGIONAL_BASELINE_RATES: Dict[str, Dict[str, Any]] = {
    "ap-south-1": {
        "ec2": {
            "t3.nano": 0.0052, "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416,
            "t3.large": 0.0832, "t3.xlarge": 0.1664, "t3.2xlarge": 0.3328,
            "c5.large": 0.0850, "c5.xlarge": 0.1700, "c5.2xlarge": 0.3400, "c5.4xlarge": 0.6800,
            "m5.large": 0.0960, "m5.xlarge": 0.1920, "m5.2xlarge": 0.3840, "m5.4xlarge": 0.7680,
            "r5.large": 0.1260, "r5.xlarge": 0.2520, "r5.2xlarge": 0.5040, "r5.4xlarge": 1.0080
        },
        "rds": {
            "db.t3.micro": 0.0180, "db.t3.small": 0.0360, "db.t3.medium": 0.0730,
            "db.m5.large": 0.1700, "db.r5.large": 0.2400
        },
        "ebs": {"gp3": 0.0800, "gp2": 0.1000, "io2": 0.1250, "st1": 0.0450},
        "s3": {"Standard": 0.0230, "Intelligent-Tiering": 0.0230, "Standard-IA": 0.0125, "Glacier Flexible": 0.0036},
        "networking": {
            "Hosted Zone": 0.5000,
            "Internet Out": 0.0900,
            "alb_hourly": 0.0225,
            "nat_gateway_hourly": 0.0450,
            "public_ipv4_hourly": 0.0050,
            "vpn_hourly": 0.0500
        }
    },
    "us-east-1": {
        "ec2": {
            "t3.nano": 0.0052, "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416,
            "t3.large": 0.0832, "t3.xlarge": 0.1664, "t3.2xlarge": 0.3328,
            "c5.large": 0.0850, "c5.xlarge": 0.1700, "c5.2xlarge": 0.3400, "c5.4xlarge": 0.6800,
            "m5.large": 0.0960, "m5.xlarge": 0.1920, "m5.2xlarge": 0.3840, "m5.4xlarge": 0.7680,
            "r5.large": 0.1260, "r5.xlarge": 0.2520, "r5.2xlarge": 0.5040, "r5.4xlarge": 1.0080
        },
        "rds": {
            "db.t3.micro": 0.0170, "db.t3.small": 0.0340, "db.t3.medium": 0.0680,
            "db.m5.large": 0.1560, "db.r5.large": 0.2200
        },
        "ebs": {"gp3": 0.0800, "gp2": 0.1000, "io2": 0.1250, "st1": 0.0450},
        "s3": {"Standard": 0.0230, "Intelligent-Tiering": 0.0230, "Standard-IA": 0.0125, "Glacier Flexible": 0.0036},
        "networking": {
            "Hosted Zone": 0.5000,
            "Internet Out": 0.0900,
            "alb_hourly": 0.0225,
            "nat_gateway_hourly": 0.0450,
            "public_ipv4_hourly": 0.0050,
            "vpn_hourly": 0.0500
        }
    }
}


class PricingService:
    """
    Calculates itemized monthly and annual AWS infrastructure costs.
    Supports multi-region catalogs, Boto3 live Price List API lookup,
    correct storage math (no squared multiplication), and Inferred Infrastructure detection.
    """

    def __init__(self):
        self.pricing_client = None

    def get_pricing_client(self):
        """Initializes boto3 pricing client pointing to AWS Price List API endpoint in us-east-1."""
        if not self.pricing_client:
            kwargs = {"region_name": "us-east-1"}
            if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
                if settings.AWS_SESSION_TOKEN:
                    kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
            try:
                self.pricing_client = boto3.client("pricing", **kwargs)
            except Exception as e:
                logger.warning(f"Could not initialize AWS Pricing client: {e}")
        return self.pricing_client

    def _get_regional_catalog(self, region: str) -> Dict[str, Any]:
        """Returns baseline rates for region, falling back to Mumbai (ap-south-1)."""
        return REGIONAL_BASELINE_RATES.get(region) or REGIONAL_BASELINE_RATES["ap-south-1"]

    def fetch_ec2_hourly_price(self, instance_type: str, region: str = "ap-south-1") -> float:
        """Queries live AWS Price List API for EC2 hourly rate, or falls back to baseline."""
        client = self.get_pricing_client()
        if client:
            try:
                location_map = {
                    "ap-south-1": "Asia Pacific (Mumbai)",
                    "us-east-1": "US East (N. Virginia)",
                    "us-west-2": "US West (Oregon)",
                    "eu-west-1": "Europe (Ireland)",
                    "ap-southeast-1": "Asia Pacific (Singapore)",
                    "ap-southeast-2": "Asia Pacific (Sydney)"
                }
                location = location_map.get(region, "Asia Pacific (Mumbai)")
                filters = [
                    {"Type": "TERM_MATCH", "Field": "ServiceCode", "Value": "AmazonEC2"},
                    {"Type": "TERM_MATCH", "Field": "location", "Value": location},
                    {"Type": "TERM_MATCH", "Field": "instanceType", "Value": instance_type},
                    {"Type": "TERM_MATCH", "Field": "operatingSystem", "Value": "Linux"},
                    {"Type": "TERM_MATCH", "Field": "preInstalledSw", "Value": "NA"},
                    {"Type": "TERM_MATCH", "Field": "tenancy", "Value": "Shared"},
                    {"Type": "TERM_MATCH", "Field": "capacitystatus", "Value": "Used"}
                ]
                response = client.get_products(ServiceCode="AmazonEC2", Filters=filters, MaxResults=1)
                for price_str in response.get("PriceList", []):
                    price_json = json.loads(price_str)
                    on_demand = price_json.get("terms", {}).get("OnDemand", {})
                    for term_k, term_v in on_demand.items():
                        price_dimensions = term_v.get("priceDimensions", {})
                        for dim_k, dim_v in price_dimensions.items():
                            rate = float(dim_v.get("pricePerUnit", {}).get("USD", 0.0))
                            if rate > 0:
                                return rate
            except Exception as e:
                logger.debug(f"Live Price List API query failed for {instance_type}: {e}")

        # Fallback to regional catalog
        cat = self._get_regional_catalog(region)
        return cat["ec2"].get(instance_type, 0.0416)

    def calculate_resource_cost(self, resource: Dict[str, Any], hours_per_month: int = 730) -> Dict[str, Any]:
        """Calculates itemized monthly cost for a single mapped AWS resource."""
        service_code = resource.get("target_aws_service_code") or "AmazonEC2"
        instance_type = resource.get("target_aws_instance_type") or "t3.medium"
        region = resource.get("target_aws_region") or settings.AWS_REGION
        quantity = float(resource.get("target_quantity") or 1.0)
        storage_gb = float(resource.get("target_storage_gb") or 0.0)

        catalog = self._get_regional_catalog(region)

        unit_rate = 0.0
        unit_type = "month"
        monthly_cost = 0.0

        if service_code == "AmazonEC2":
            unit_rate = self.fetch_ec2_hourly_price(instance_type, region)
            unit_type = "hour"
            monthly_cost = unit_rate * hours_per_month * quantity

        elif service_code == "AmazonRDS":
            unit_rate = catalog["rds"].get(instance_type, 0.0730)
            unit_type = "hour"
            # Optional storage cost for DB (default 20 GB included or priced at EBS rates)
            db_storage_cost = storage_gb * catalog["ebs"].get("gp3", 0.0800) if storage_gb > 20 else 0.0
            monthly_cost = (unit_rate * hours_per_month * quantity) + db_storage_cost

        elif service_code == "AmazonEBS":
            rate_per_gb = catalog["ebs"].get(instance_type, 0.0800)
            unit_rate = rate_per_gb
            unit_type = "GB-month"
            effective_storage = max(storage_gb, 10.0)
            # Correct formula: storage cost is rate * GB, multiplied by number of disk volumes (quantity)
            monthly_cost = rate_per_gb * effective_storage * max(1.0, quantity)

        elif service_code == "AmazonS3":
            rate_per_gb = catalog["s3"].get(instance_type, 0.0230)
            unit_rate = rate_per_gb
            unit_type = "GB-month"
            effective_storage = max(storage_gb, 10.0)
            monthly_cost = rate_per_gb * effective_storage * max(1.0, quantity)

        elif service_code == "AmazonRoute53":
            unit_rate = catalog["networking"].get("Hosted Zone", 0.5000)
            unit_type = "zone-month"
            monthly_cost = unit_rate * quantity

        elif service_code == "AWSDataTransfer":
            unit_rate = catalog["networking"].get("Internet Out", 0.0900)
            unit_type = "GB-out"
            monthly_cost = unit_rate * max(quantity, 10.0)

        elif service_code == "AWSELB":
            unit_rate = catalog["networking"].get("alb_hourly", 0.0225)
            unit_type = "hour"
            alb_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * alb_count

        elif service_code == "AWSVPN":
            unit_rate = catalog["networking"].get("vpn_hourly", 0.0500)
            unit_type = "hour"
            vpn_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * vpn_count

        elif service_code == "AmazonElastiCache":
            unit_rate = catalog["rds"].get("db.t3.micro", 0.0170)
            unit_type = "hour"
            node_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * node_count

        elif service_code == "AWSVPC":
            if "nat" in str(instance_type).lower():
                unit_rate = catalog["networking"].get("nat_gateway_hourly", 0.0450)
                unit_type = "hour"
                monthly_cost = unit_rate * hours_per_month * max(1.0, quantity)
            else:
                unit_rate = catalog["networking"].get("public_ipv4_hourly", 0.0050)
                unit_type = "hour"
                if quantity > 100:
                    monthly_cost = unit_rate * quantity
                else:
                    monthly_cost = unit_rate * hours_per_month * quantity

        elif service_code == "AWSKMS":
            unit_rate = 1.0000
            unit_type = "key-month"
            monthly_cost = unit_rate * max(1.0, quantity if quantity < 10 else 1.0)

        elif service_code == "REVIEW_REQUIRED":
            # For review-required workloads, estimate based on original source cost if available, else 0
            unit_rate = 0.0
            unit_type = "review"
            monthly_cost = float(resource.get("source_cost") or 0.0)

        else:
            unit_rate = 0.0208
            unit_type = "hour"
            unit_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * unit_count

        annual_cost = monthly_cost * 12.0

        return {
            **resource,
            "pricing_unit_rate": round(unit_rate, 4),
            "pricing_unit_type": unit_type,
            "monthly_cost_usd": round(monthly_cost, 2),
            "annual_cost_usd": round(annual_cost, 2)
        }

    def detect_inferred_infrastructure(
        self, resources: List[Dict[str, Any]], hours_per_month: int = 730
    ) -> List[Dict[str, Any]]:
        """
        Detects missing infrastructure components required for a functional, secure AWS deployment:
        - NAT Gateway (for private subnet internet access)
        - Public IPv4 Addresses (mandatory AWS fee since Feb 2024)
        - Baseline Outbound Data Transfer (Egress)
        - CloudWatch & Base Logging
        - AWS Backup for storage volumes/databases
        """
        inferred: List[Dict[str, Any]] = []

        has_compute = any(r.get("target_aws_service_code") == "AmazonEC2" for r in resources)
        has_database = any(r.get("target_aws_service_code") == "AmazonRDS" for r in resources)
        has_nat = any("nat" in str(r.get("target_aws_instance_type", "")).lower() for r in resources)
        has_egress = any(r.get("target_aws_service_code") == "AWSDataTransfer" for r in resources)
        has_ipv4 = any("ipv4" in str(r.get("target_aws_instance_type", "")).lower() for r in resources)

        total_storage_gb = sum(float(r.get("target_storage_gb") or 0.0) for r in resources)
        ec2_count = sum(float(r.get("target_quantity") or 1.0) for r in resources if r.get("target_aws_service_code") == "AmazonEC2")

        # 1. Inferred NAT Gateway (if VPC compute or database exists without explicit NAT)
        if (has_compute or has_database) and not has_nat:
            nat_hourly = 0.0450
            nat_monthly = round(nat_hourly * hours_per_month * 1.0, 2)
            inferred.append({
                "id": "inferred-nat-gw",
                "is_inferred": True,
                "is_enabled": True,
                "target_aws_service": "Amazon VPC",
                "target_aws_service_code": "AWSVPC",
                "target_aws_category": "Networking",
                "target_aws_instance_type": "NAT Gateway",
                "target_quantity": 1.0,
                "pricing_unit_rate": nat_hourly,
                "pricing_unit_type": "hour",
                "monthly_cost_usd": nat_monthly,
                "annual_cost_usd": round(nat_monthly * 12, 2),
                "rationale": "Required for EC2 and RDS instances in private subnets to reach OS repos, package managers, and external APIs securely."
            })

        # 2. Inferred Public IPv4 Address (if compute exists without explicit IPv4 line item)
        if has_compute and not has_ipv4:
            ip_count = max(1.0, ec2_count)
            ip_hourly = 0.0050
            ip_monthly = round(ip_hourly * hours_per_month * ip_count, 2)
            inferred.append({
                "id": "inferred-public-ipv4",
                "is_inferred": True,
                "is_enabled": True,
                "target_aws_service": "Amazon VPC",
                "target_aws_service_code": "AWSVPC",
                "target_aws_category": "Networking",
                "target_aws_instance_type": "Public IPv4 Address",
                "target_quantity": ip_count,
                "pricing_unit_rate": ip_hourly,
                "pricing_unit_type": "hour",
                "monthly_cost_usd": ip_monthly,
                "annual_cost_usd": round(ip_monthly * 12, 2),
                "rationale": f"AWS charges $0.005/hr per public IPv4 address since Feb 2024 for public-facing servers/ALBs."
            })

        # 3. Inferred Baseline Data Transfer Out (Egress) if missing
        if (has_compute or total_storage_gb > 0) and not has_egress:
            egress_gb = 50.0  # Conservative baseline egress
            egress_rate = 0.0900
            egress_monthly = round(egress_gb * egress_rate, 2)
            inferred.append({
                "id": "inferred-egress",
                "is_inferred": True,
                "is_enabled": True,
                "target_aws_service": "AWS Data Transfer",
                "target_aws_service_code": "AWSDataTransfer",
                "target_aws_category": "Networking",
                "target_aws_instance_type": "Internet Out",
                "target_quantity": egress_gb,
                "pricing_unit_rate": egress_rate,
                "pricing_unit_type": "GB-out",
                "monthly_cost_usd": egress_monthly,
                "annual_cost_usd": round(egress_monthly * 12, 2),
                "rationale": f"Estimated baseline outbound data transfer ({egress_gb:.0f} GB/mo) for typical web applications and APIs."
            })

        # 4. Inferred AWS Backup & Snapshots
        if total_storage_gb > 0:
            backup_storage_gb = round(total_storage_gb * 0.20, 1)  # 20% delta snapshot storage
            backup_rate = 0.0500  # $0.05/GB-mo for warm backup storage
            backup_monthly = round(backup_storage_gb * backup_rate, 2)
            inferred.append({
                "id": "inferred-backup",
                "is_inferred": True,
                "is_enabled": True,
                "target_aws_service": "AWS Backup",
                "target_aws_service_code": "AWSBackup",
                "target_aws_category": "Storage",
                "target_aws_instance_type": "Warm Backup Storage",
                "target_storage_gb": backup_storage_gb,
                "target_quantity": 1.0,
                "pricing_unit_rate": backup_rate,
                "pricing_unit_type": "GB-month",
                "monthly_cost_usd": backup_monthly,
                "annual_cost_usd": round(backup_monthly * 12, 2),
                "rationale": f"Automated compliance snapshots for EBS/RDS ({backup_storage_gb:.0f} GB retention)."
            })

        # 5. Inferred Base CloudWatch Monitoring
        if has_compute:
            cw_monthly = 3.00
            inferred.append({
                "id": "inferred-cloudwatch",
                "is_inferred": True,
                "is_enabled": True,
                "target_aws_service": "Amazon CloudWatch",
                "target_aws_service_code": "CloudWatch",
                "target_aws_category": "Management & Governance",
                "target_aws_instance_type": "Logs & Alarms",
                "target_quantity": 1.0,
                "pricing_unit_rate": 3.0000,
                "pricing_unit_type": "month",
                "monthly_cost_usd": cw_monthly,
                "annual_cost_usd": round(cw_monthly * 12, 2),
                "rationale": "Essential log aggregation, operational metrics, and billing alarms."
            })

        return inferred

    def calculate_total_estimate(
        self,
        resources: List[Dict[str, Any]],
        hours_per_month: int = 730,
        currency_rate_to_usd: float = 1.0,
        include_inferred: bool = True
    ) -> Dict[str, Any]:
        """Calculates total monthly & annual AWS estimate, category breakdown, inferred items, and source bill delta."""
        priced_items = []
        total_monthly_usd = 0.0
        total_annual_usd = 0.0
        category_breakdown: Dict[str, float] = {}

        total_source_bill = sum(float(r.get("source_cost", 0.0)) for r in resources)

        for res in resources:
            priced = self.calculate_resource_cost(res, hours_per_month)
            priced_items.append(priced)
            monthly = priced["monthly_cost_usd"]
            total_monthly_usd += monthly
            total_annual_usd += priced["annual_cost_usd"]

            cat = res.get("target_aws_category") or "Compute"
            category_breakdown[cat] = category_breakdown.get(cat, 0.0) + monthly

        # Inferred auxiliary infrastructure
        inferred_items = self.detect_inferred_infrastructure(resources, hours_per_month)
        inferred_monthly_usd = 0.0

        if include_inferred:
            for inf in inferred_items:
                inf_monthly = inf["monthly_cost_usd"]
                inferred_monthly_usd += inf_monthly
                total_monthly_usd += inf_monthly
                total_annual_usd += inf["annual_cost_usd"]

                cat = inf.get("target_aws_category") or "Networking"
                category_breakdown[cat] = category_breakdown.get(cat, 0.0) + inf_monthly

        # Round category values
        for k in category_breakdown:
            category_breakdown[k] = round(category_breakdown[k], 2)

        workloads_monthly = round(total_monthly_usd - inferred_monthly_usd, 2)

        return {
            "status": "success",
            "default_region": settings.AWS_REGION,
            "total_monthly_cost_usd": round(total_monthly_usd, 2),
            "total_annual_cost_usd": round(total_annual_usd, 2),
            "workloads_monthly_cost_usd": workloads_monthly,
            "inferred_monthly_cost_usd": round(inferred_monthly_usd, 2),
            "total_source_bill_cost": round(total_source_bill, 2),
            "category_breakdown_usd": category_breakdown,
            "total_resources_calculated": len(priced_items),
            "priced_resources": priced_items,
            "inferred_infrastructure": inferred_items
        }


pricing_service = PricingService()

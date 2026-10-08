import json
import logging
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from app.core.config import settings

logger = logging.getLogger("pricing_service")

# Baseline official AWS On-Demand hourly/unit rates in ap-south-1 (Mumbai)
# Used as fallback or offline cache when AWS Price List API is unavailable or credentials are unset
MUMBAI_BASELINE_RATES = {
    # EC2 Instances (Hourly USD in ap-south-1)
    "ec2": {
        "t3.nano": 0.0052,
        "t3.micro": 0.0104,
        "t3.small": 0.0208,
        "t3.medium": 0.0416,
        "t3.large": 0.0832,
        "t3.xlarge": 0.1664,
        "m5.large": 0.0960,
        "m5.xlarge": 0.1920,
        "c5.large": 0.0850,
        "r5.large": 0.1260
    },
    # RDS Instances (Hourly USD in ap-south-1)
    "rds": {
        "db.t3.micro": 0.0180,
        "db.t3.small": 0.0360,
        "db.t3.medium": 0.0730,
        "db.m5.large": 0.1700,
        "db.r5.large": 0.2400
    },
    # EBS Storage (per GB-month USD in ap-south-1)
    "ebs": {
        "gp3": 0.0800,
        "gp2": 0.1000,
        "io2": 0.1250,
        "st1": 0.0450
    },
    # S3 Storage (per GB-month USD in ap-south-1)
    "s3": {
        "Standard": 0.0230,
        "Intelligent-Tiering": 0.0230,
        "Standard-IA": 0.0125,
        "Glacier Flexible": 0.0036
    },
    # Networking & Route 53
    "networking": {
        "Hosted Zone": 0.5000,
        "Internet Out": 0.0900
    }
}


class PricingService:
    """
    Calculates monthly and annual AWS infrastructure costs.
    Attempts live AWS Price List API queries; falls back to cached baseline catalog.
    """

    def __init__(self):
        self.pricing_client = None

    def get_pricing_client(self):
        """Initializes boto3 pricing client pointing to AWS Price List API endpoint."""
        if not self.pricing_client:
            kwargs = {"region_name": "us-east-1"} # AWS Price List API endpoint is global in us-east-1
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

        # Fallback to catalog
        return MUMBAI_BASELINE_RATES["ec2"].get(instance_type, 0.0416)

    def calculate_resource_cost(self, resource: Dict[str, Any], hours_per_month: int = 730) -> Dict[str, Any]:
        """Calculates itemized monthly cost for a single mapped AWS resource."""
        service_code = resource.get("target_aws_service_code") or "AmazonEC2"
        instance_type = resource.get("target_aws_instance_type") or "t3.medium"
        region = resource.get("target_aws_region") or settings.AWS_REGION
        quantity = float(resource.get("target_quantity") or 1.0)
        storage_gb = float(resource.get("target_storage_gb") or 0.0)

        unit_rate = 0.0
        unit_type = "month"
        monthly_cost = 0.0

        if service_code == "AmazonEC2":
            unit_rate = self.fetch_ec2_hourly_price(instance_type, region)
            unit_type = "hour"
            monthly_cost = unit_rate * hours_per_month * quantity

        elif service_code == "AmazonRDS":
            unit_rate = MUMBAI_BASELINE_RATES["rds"].get(instance_type, 0.0730)
            unit_type = "hour"
            monthly_cost = unit_rate * hours_per_month * quantity

        elif service_code == "AmazonEBS":
            rate_per_gb = MUMBAI_BASELINE_RATES["ebs"].get(instance_type, 0.0800)
            unit_rate = rate_per_gb
            unit_type = "GB-month"
            effective_storage = max(storage_gb, 10.0)
            monthly_cost = rate_per_gb * effective_storage * quantity

        elif service_code == "AmazonS3":
            rate_per_gb = MUMBAI_BASELINE_RATES["s3"].get(instance_type, 0.0230)
            unit_rate = rate_per_gb
            unit_type = "GB-month"
            effective_storage = max(storage_gb, 50.0)
            monthly_cost = rate_per_gb * effective_storage * quantity

        elif service_code == "AmazonRoute53":
            unit_rate = MUMBAI_BASELINE_RATES["networking"].get("Hosted Zone", 0.5000)
            unit_type = "zone-month"
            monthly_cost = unit_rate * quantity

        elif service_code == "AWSDataTransfer":
            unit_rate = MUMBAI_BASELINE_RATES["networking"].get("Internet Out", 0.0900)
            unit_type = "GB-out"
            monthly_cost = unit_rate * max(quantity, 50.0)

        elif service_code == "AWSELB":
            unit_rate = 0.0225 # AWS ALB in ap-south-1
            unit_type = "hour"
            # Quantity for load balancer is number of ALBs (cap reasonable instance count)
            alb_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * alb_count

        elif service_code == "AmazonElastiCache":
            unit_rate = MUMBAI_BASELINE_RATES["rds"].get("db.t3.micro", 0.0170)
            unit_type = "hour"
            node_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * node_count

        elif service_code == "AmazonVPC":
            unit_rate = 0.005 # In-use public IPv4 address per hour in AWS
            unit_type = "hour"
            # If quantity is large (>100), it represents total IPv4-hours in bill (e.g. 7312 hrs)
            if quantity > 100:
                monthly_cost = unit_rate * quantity
            else:
                monthly_cost = unit_rate * hours_per_month * quantity

        elif service_code == "AWSKMS":
            unit_rate = 1.000 # AWS KMS key per month
            unit_type = "key-month"
            monthly_cost = unit_rate * max(1.0, quantity if quantity < 10 else 1.0)

        else:
            unit_rate = 0.0208 # Standard micro utility rate
            unit_type = "hour"
            unit_count = quantity if quantity < 10 else 1.0
            monthly_cost = unit_rate * hours_per_month * unit_count

        annual_cost = monthly_cost * 12

        return {
            **resource,
            "pricing_unit_rate": round(unit_rate, 4),
            "pricing_unit_type": unit_type,
            "monthly_cost_usd": round(monthly_cost, 2),
            "annual_cost_usd": round(annual_cost, 2)
        }

    def calculate_total_estimate(self, resources: List[Dict[str, Any]], hours_per_month: int = 730, currency_rate_to_usd: float = 1.0) -> Dict[str, Any]:
        """Calculates total monthly & annual AWS estimate, category breakdown, and source bill delta."""
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

        # Round category values
        for k in category_breakdown:
            category_breakdown[k] = round(category_breakdown[k], 2)

        return {
            "status": "success",
            "default_region": settings.AWS_REGION,
            "total_monthly_cost_usd": round(total_monthly_usd, 2),
            "total_annual_cost_usd": round(total_annual_usd, 2),
            "total_source_bill_cost": round(total_source_bill, 2),
            "category_breakdown_usd": category_breakdown,
            "total_resources_calculated": len(priced_items),
            "priced_resources": priced_items
        }


pricing_service = PricingService()

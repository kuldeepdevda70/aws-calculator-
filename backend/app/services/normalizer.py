import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from app.core.config import settings

logger = logging.getLogger("normalizer")

# Standard EC2 instance catalog for dynamic spec matching
EC2_CATALOG = [
    {"instance": "t3.nano", "vcpu": 2, "ram_gb": 0.5, "family": "t3", "category": "burstable"},
    {"instance": "t3.micro", "vcpu": 2, "ram_gb": 1.0, "family": "t3", "category": "burstable"},
    {"instance": "t3.small", "vcpu": 2, "ram_gb": 2.0, "family": "t3", "category": "burstable"},
    {"instance": "t3.medium", "vcpu": 2, "ram_gb": 4.0, "family": "t3", "category": "burstable"},
    {"instance": "t3.large", "vcpu": 2, "ram_gb": 8.0, "family": "t3", "category": "burstable"},
    {"instance": "t3.xlarge", "vcpu": 4, "ram_gb": 16.0, "family": "t3", "category": "burstable"},
    {"instance": "t3.2xlarge", "vcpu": 8, "ram_gb": 32.0, "family": "t3", "category": "burstable"},
    {"instance": "c5.large", "vcpu": 2, "ram_gb": 4.0, "family": "c5", "category": "compute"},
    {"instance": "c5.xlarge", "vcpu": 4, "ram_gb": 8.0, "family": "c5", "category": "compute"},
    {"instance": "c5.2xlarge", "vcpu": 8, "ram_gb": 16.0, "family": "c5", "category": "compute"},
    {"instance": "c5.4xlarge", "vcpu": 16, "ram_gb": 32.0, "family": "c5", "category": "compute"},
    {"instance": "m5.large", "vcpu": 2, "ram_gb": 8.0, "family": "m5", "category": "general"},
    {"instance": "m5.xlarge", "vcpu": 4, "ram_gb": 16.0, "family": "m5", "category": "general"},
    {"instance": "m5.2xlarge", "vcpu": 8, "ram_gb": 32.0, "family": "m5", "category": "general"},
    {"instance": "m5.4xlarge", "vcpu": 16, "ram_gb": 64.0, "family": "m5", "category": "general"},
    {"instance": "r5.large", "vcpu": 2, "ram_gb": 16.0, "family": "r5", "category": "memory"},
    {"instance": "r5.xlarge", "vcpu": 4, "ram_gb": 32.0, "family": "r5", "category": "memory"},
    {"instance": "r5.2xlarge", "vcpu": 8, "ram_gb": 64.0, "family": "r5", "category": "memory"},
    {"instance": "r5.4xlarge", "vcpu": 16, "ram_gb": 128.0, "family": "r5", "category": "memory"},
]


class ResourceNormalizer:
    """
    Normalizes third-party billing line items and document extracts into standardized
    cloud workload specifications with detected specs, source cloud provider scoring,
    region mapping, and provenance tracing.
    """

    def __init__(self):
        self._rules = None

    @property
    def rules(self) -> Dict[str, Any]:
        if not self._rules:
            self._rules = settings.load_rules()
        return self._rules

    def reload_rules(self):
        self._rules = settings.load_rules()

    def detect_provider(self, text: str) -> str:
        """
        Calculates match scores across known cloud providers using weighted keyword hits.
        Returns the highest-scoring provider or 'Unknown Cloud'.
        """
        text_lower = text.lower()
        providers = self.rules.get("providers", {})
        scores: Dict[str, int] = {}

        for key, p_data in providers.items():
            provider_name = p_data.get("name", key.capitalize())
            score = 0
            for kw in p_data.get("keywords", []):
                # Count occurrences of the keyword
                count = text_lower.count(kw.lower())
                if count > 0:
                    # Longer and more specific keywords carry higher weight
                    weight = 2 if len(kw.split()) > 1 or len(kw) > 8 else 1
                    score += count * weight
            if score > 0:
                scores[provider_name] = score

        if scores:
            best_provider = max(scores.items(), key=lambda x: x[1])[0]
            return best_provider

        return "Unknown Cloud"

    def detect_currency(self, text: str) -> Tuple[str, str]:
        """
        Identifies billing currency safely using strict regex and word boundaries.
        Prevents false-positive matches like 'rs' in 'Hours' or 'Users'.
        """
        currencies = self.rules.get("currencies", {})
        for code, c_data in currencies.items():
            pattern = c_data.get("regex")
            if pattern:
                if re.search(pattern, text, re.IGNORECASE):
                    return code, c_data.get("symbol", "$")
            else:
                for kw in c_data.get("keywords", []):
                    # Fallback to word-boundary check
                    escaped = re.escape(kw)
                    if re.search(rf"(?:\b|^){escaped}(?:\b|$)", text, re.IGNORECASE):
                        return code, c_data.get("symbol", "$")

        return "USD", "$"

    def normalize_region(self, source_region: Optional[str], default_region: Optional[str] = None) -> str:
        """
        Translates cloud provider regions (e.g. 'centralindia', 'eastus', 'blr1', 'asia-south1')
        to canonical AWS region codes (e.g. 'ap-south-1', 'us-east-1').
        """
        target_default = default_region or settings.AWS_REGION
        if not source_region:
            return target_default

        clean = str(source_region).strip().lower().replace(" ", "").replace("_", "-")
        region_mappings = self.rules.get("region_mappings", {})

        # Direct dictionary match
        if clean in region_mappings:
            return region_mappings[clean]

        # Partial matching (e.g. "East US", "South India (Chennai)")
        for src_key, target_aws in region_mappings.items():
            if src_key in clean or clean in src_key:
                return target_aws

        # Check if already a valid AWS region code
        supported_regions = [r["code"] for r in self.rules.get("supported_aws_regions", [])]
        if clean in supported_regions:
            return clean

        return target_default

    def extract_specs(self, description: str, sku: Optional[str] = None, unit: Optional[str] = None) -> Dict[str, Any]:
        """
        Extracts technical specs (vCPU, RAM, storage, engine, OS) from raw resource texts.
        """
        combined = f"{description or ''} {sku or ''}".strip()
        combined_lower = combined.lower()

        # 1. Check known instance catalog first (fast exact lookup)
        sku_clean = (sku or "").lower().replace("-", "_").replace(".", "_")
        instance_mappings = self.rules.get("instance_mappings", {})
        if sku_clean and sku_clean in instance_mappings:
            spec = instance_mappings[sku_clean]
            return {
                "vcpu": float(spec.get("vcpu", 0)),
                "ram_gb": float(spec.get("ram_gb", 0)),
                "storage_gb": float(spec.get("storage_gb", 0)),
                "database_engine": self._detect_db_engine(combined_lower),
                "os": self._detect_os(combined_lower),
                "matched_catalog_key": sku_clean,
                "confidence": "catalog_exact"
            }

        # 2. Extract vCPU count
        vcpu = 0.0
        vcpu_match = re.search(r"\b(\d+)\s*(?:v?cpu|core|vcore)s?\b", combined_lower)
        if vcpu_match:
            try:
                vcpu = float(vcpu_match.group(1))
            except ValueError:
                pass

        # 3. Extract RAM size in GB
        ram_gb = 0.0
        ram_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:gb|gib)\s*(?:ram|memory)?\b", combined_lower)
        if ram_match:
            try:
                ram_gb = float(ram_match.group(1))
            except ValueError:
                pass
        else:
            mb_match = re.search(r"\b(\d+)\s*(?:mb|mib)\s*(?:ram|memory)?\b", combined_lower)
            if mb_match:
                try:
                    ram_gb = round(float(mb_match.group(1)) / 1024.0, 2)
                except ValueError:
                    pass

        # 4. Extract Storage size in GB
        storage_gb = 0.0
        # Check TB first
        tb_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:tb|tib)\b", combined_lower)
        if tb_match:
            try:
                storage_gb = float(tb_match.group(1)) * 1024.0
            except ValueError:
                pass
        else:
            storage_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:gb|gib)\s*(?:disk|storage|ssd|hdd|volume)?\b", combined_lower)
            if storage_match and ram_gb != float(storage_match.group(1)):
                try:
                    storage_gb = float(storage_match.group(1))
                except ValueError:
                    pass

        return {
            "vcpu": vcpu,
            "ram_gb": ram_gb,
            "storage_gb": storage_gb,
            "database_engine": self._detect_db_engine(combined_lower),
            "os": self._detect_os(combined_lower),
            "matched_catalog_key": None,
            "confidence": "heuristic_parsed" if (vcpu > 0 or ram_gb > 0 or storage_gb > 0) else "unspecified"
        }

    def find_closest_ec2_instance(
        self, vcpu: float, ram_gb: float, family_preference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Dynamically selects the most cost-effective AWS EC2 instance that satisfies or exceeds
        the requested vCPU and RAM requirements.
        """
        target_vcpu = max(1.0, float(vcpu or 2.0))
        target_ram = max(0.5, float(ram_gb or 4.0))

        # Filter candidates that can fit the workload
        candidates = [
            inst for inst in EC2_CATALOG
            if inst["vcpu"] >= target_vcpu and inst["ram_gb"] >= target_ram
        ]

        if family_preference:
            pref_candidates = [c for c in candidates if c["family"] == family_preference or c["category"] == family_preference]
            if pref_candidates:
                candidates = pref_candidates

        if candidates:
            # Sort candidates by smallest resource excess (least wasted capacity)
            def _waste_score(c):
                vcpu_diff = c["vcpu"] - target_vcpu
                ram_diff = c["ram_gb"] - target_ram
                return (vcpu_diff * 4) + ram_diff

            best_fit = min(candidates, key=_waste_score)
            return best_fit

        # If requirements exceed catalog limits, find highest capacity available
        return max(EC2_CATALOG, key=lambda x: (x["vcpu"], x["ram_gb"]))

    @staticmethod
    def _detect_db_engine(text: str) -> Optional[str]:
        if "postgres" in text or "psql" in text:
            return "PostgreSQL"
        if "mysql" in text:
            return "MySQL"
        if "sql server" in text or "mssql" in text:
            return "SQL Server"
        if "mariadb" in text:
            return "MariaDB"
        if "oracle" in text:
            return "Oracle"
        if "redis" in text:
            return "Redis"
        if "memcached" in text:
            return "Memcached"
        if "cosmos" in text or "mongo" in text:
            return "DocumentDB (MongoDB)"
        return None

    @staticmethod
    def _detect_os(text: str) -> str:
        if "windows" in text or "win server" in text:
            return "Windows"
        if "rhel" in text or "red hat" in text:
            return "RHEL"
        if "suse" in text:
            return "SUSE"
        return "Linux"


resource_normalizer = ResourceNormalizer()

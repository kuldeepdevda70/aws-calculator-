import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.core.config import settings
from app.services.aws_mapper import aws_mapper

router = APIRouter()
logger = logging.getLogger("mapping_endpoint")


class WorkloadItem(BaseModel):
    id: Optional[str] = None
    source_provider: Optional[str] = "Unknown Cloud"
    source_service_name: str
    sku: Optional[str] = None
    cost: Optional[float] = 0.0
    usage_amount: Optional[float] = 1.0
    usage_unit: Optional[str] = "Units"
    source_region: Optional[str] = None
    raw_description: Optional[str] = None


class MapRequest(BaseModel):
    items: List[Dict[str, Any]]
    target_region: Optional[str] = Field(default=None, description="AWS Region override, e.g. ap-south-1")


class ResourceUpdateRequest(BaseModel):
    resources: List[Dict[str, Any]]
    target_region: Optional[str] = None


@router.get("/options")
def get_mapping_options():
    """
    Returns available target AWS regions, services, and instance types
    for populating interactive selection dropdowns on the edit screen.
    """
    return aws_mapper.get_mapping_options()


@router.post("/map")
def map_workloads_to_aws(request: MapRequest):
    """
    Converts a list of third-party cloud workloads into target AWS architecture equivalents.
    Default region is ap-south-1 (Mumbai).
    """
    try:
        region = request.target_region or settings.AWS_REGION
        mapped = aws_mapper.map_all(request.items, target_region=region)
        return {
            "status": "success",
            "target_region": region,
            "total_workloads": len(mapped),
            "mapped_resources": mapped
        }
    except Exception as e:
        logger.error(f"Error mapping workloads: {e}")
        raise HTTPException(status_code=500, detail=f"Mapping failed: {str(e)}")


@router.post("/update")
def save_edited_resources(request: ResourceUpdateRequest):
    """
    Validates and saves user-edited AWS workload configurations from the edit screen.
    Ensures valid regions, instance types, and positive usage quantities.
    """
    cleaned = []
    region = request.target_region or settings.AWS_REGION

    for idx, res in enumerate(request.resources):
        # Validate and clean up
        qty = float(res.get("target_quantity") or 1.0)
        vcpu = int(res.get("target_vcpu") or 2)
        ram = float(res.get("target_ram_gb") or 4.0)
        storage = float(res.get("target_storage_gb") or 0.0)

        cleaned.append({
            "id": res.get("id") or f"custom-{idx + 1}",
            "source_provider": res.get("source_provider", "Custom"),
            "source_service_name": res.get("source_service_name", "User Defined Service"),
            "source_sku": res.get("source_sku"),
            "source_cost": float(res.get("source_cost", 0.0)),
            "source_usage_amount": float(res.get("source_usage_amount", 1.0)),
            "source_usage_unit": res.get("source_usage_unit", "Units"),
            "target_aws_service": res.get("target_aws_service", "Amazon EC2"),
            "target_aws_service_code": res.get("target_aws_service_code", "AmazonEC2"),
            "target_aws_category": res.get("target_aws_category", "Compute"),
            "target_aws_instance_type": res.get("target_aws_instance_type", "t3.medium"),
            "target_aws_region": res.get("target_aws_region") or region,
            "target_vcpu": vcpu,
            "target_ram_gb": ram,
            "target_storage_gb": storage,
            "target_quantity": max(1.0, qty),
            "notes": res.get("notes", "User configured workload")
        })

    return {
        "status": "success",
        "message": f"Successfully updated {len(cleaned)} AWS resources",
        "target_region": region,
        "total_resources": len(cleaned),
        "resources": cleaned
    }

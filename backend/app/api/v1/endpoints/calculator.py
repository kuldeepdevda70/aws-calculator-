import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.calculator_service import calculator_service
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger("calculator_endpoint")


class GenerateLinkRequest(BaseModel):
    resources: List[Dict[str, Any]] = Field(default_factory=list, description="Finalized AWS resources list")
    target_region: Optional[str] = Field(default=None, description="AWS Region code (default ap-south-1)")


@router.post("/generate-link")
async def generate_calculator_link(request: GenerateLinkRequest):
    """
    Automates browser interaction with official AWS Pricing Calculator (calculator.aws)
    using Playwright to generate a public shareable estimate URL.
    Returns the link or indicates fallback to Excel/PDF reports if automation cannot complete.
    """
    region = request.target_region or settings.AWS_REGION
    logger.info(f"Received request to generate calculator.aws shareable link for region: {region}")

    try:
        result = await calculator_service.generate_shareable_link(
            resources=request.resources,
            target_region=region
        )
        return result
    except Exception as e:
        logger.error(f"Error handling calculator link generation: {e}")
        return {
            "success": False,
            "share_url": None,
            "error": str(e),
            "region": region,
            "fallback_message": "Automated browser session could not complete link generation. Please download the complete estimate using the Excel or PDF export options."
        }


@router.get("/status")
def get_calculator_automation_status():
    """Returns the configuration and status of the Playwright automation service."""
    return {
        "service": "AWS Pricing Calculator Automation",
        "calculator_url": settings.CALCULATOR_URL,
        "default_region": settings.AWS_REGION,
        "headless": settings.PLAYWRIGHT_HEADLESS,
        "timeout_seconds": settings.PLAYWRIGHT_TIMEOUT_SECONDS
    }

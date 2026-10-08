import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.services.pricing_service import pricing_service
from app.services.export_service import export_service

router = APIRouter()
logger = logging.getLogger("pricing_endpoint")


class CostCalculationRequest(BaseModel):
    resources: List[Dict[str, Any]]
    hours_per_month: Optional[int] = Field(default=730, description="Monthly hours (default 730)")
    currency_rate_to_usd: Optional[float] = Field(default=1.0, description="Exchange rate to USD")


@router.post("/calculate")
def calculate_costs(request: CostCalculationRequest):
    """
    Computes monthly & annual AWS infrastructure costs using AWS Price List rates
    for all finalized architecture workloads in the target region.
    """
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for calculation")

    try:
        estimate = pricing_service.calculate_total_estimate(
            resources=request.resources,
            hours_per_month=request.hours_per_month or 730,
            currency_rate_to_usd=request.currency_rate_to_usd or 1.0
        )
        return estimate
    except Exception as e:
        logger.error(f"Cost calculation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cost calculation error: {str(e)}")


@router.post("/export/excel")
def export_excel_estimate(request: CostCalculationRequest):
    """Generates and downloads an Excel (.xlsx) cost estimate spreadsheet."""
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for export")

    try:
        estimate = pricing_service.calculate_total_estimate(request.resources, request.hours_per_month or 730)
        excel_stream = export_service.generate_excel_report(estimate)
        return StreamingResponse(
            excel_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=aws_migration_cost_estimate.xlsx"}
        )
    except Exception as e:
        logger.error(f"Excel export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel report: {str(e)}")


@router.post("/export/pdf")
def export_pdf_estimate(request: CostCalculationRequest):
    """Generates and downloads a PDF (.pdf) cost estimate report."""
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for export")

    try:
        estimate = pricing_service.calculate_total_estimate(request.resources, request.hours_per_month or 730)
        pdf_stream = export_service.generate_pdf_report(estimate)
        return StreamingResponse(
            pdf_stream,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=aws_migration_cost_estimate.pdf"}
        )
    except Exception as e:
        logger.error(f"PDF export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF report: {str(e)}")

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.services.pricing_service import pricing_service
from app.services.export_service import export_service
from app.services.validation_service import validation_service

router = APIRouter()
logger = logging.getLogger("pricing_endpoint")


class CostCalculationRequest(BaseModel):
    resources: List[Dict[str, Any]]
    hours_per_month: Optional[int] = Field(default=730, description="Monthly hours (default 730)")
    currency_rate_to_usd: Optional[float] = Field(default=1.0, description="Exchange rate to USD")
    include_inferred: Optional[bool] = Field(default=True, description="Whether to include inferred auxiliary architecture")
    calculator_scraped_monthly: Optional[float] = Field(default=None, description="Optional scraped calculator.aws monthly total")


@router.post("/calculate")
def calculate_costs(request: CostCalculationRequest):
    """
    Computes monthly & annual AWS infrastructure costs using AWS Price List rates
    for all finalized architecture workloads in the target region.
    Also returns 100% resource completeness accounting and financial cost reconciliation.
    """
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for calculation")

    try:
        estimate = pricing_service.calculate_total_estimate(
            resources=request.resources,
            hours_per_month=request.hours_per_month or 730,
            currency_rate_to_usd=request.currency_rate_to_usd or 1.0,
            include_inferred=request.include_inferred if request.include_inferred is not None else True
        )
        completeness = validation_service.validate_completeness(request.resources)
        reconciliation = validation_service.reconcile_costs(
            estimate,
            calculator_scraped_monthly=request.calculator_scraped_monthly
        )
        return {
            **estimate,
            "completeness_accounting": completeness,
            "cost_reconciliation": reconciliation
        }
    except Exception as e:
        logger.error(f"Cost calculation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cost calculation error: {str(e)}")


@router.post("/export/excel")
def export_excel_estimate(request: CostCalculationRequest):
    """Generates and downloads an executive multi-tab Excel (.xlsx) cost estimate workbook."""
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for export")

    try:
        estimate = pricing_service.calculate_total_estimate(
            resources=request.resources,
            hours_per_month=request.hours_per_month or 730,
            include_inferred=request.include_inferred if request.include_inferred is not None else True
        )
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
    """Generates and downloads a landscape PDF (.pdf) cost estimate report."""
    if not request.resources:
        raise HTTPException(status_code=400, detail="No resources provided for export")

    try:
        estimate = pricing_service.calculate_total_estimate(
            resources=request.resources,
            hours_per_month=request.hours_per_month or 730,
            include_inferred=request.include_inferred if request.include_inferred is not None else True
        )
        pdf_stream = export_service.generate_pdf_report(estimate)
        return StreamingResponse(
            pdf_stream,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=aws_migration_cost_estimate.pdf"}
        )
    except Exception as e:
        logger.error(f"PDF export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF report: {str(e)}")

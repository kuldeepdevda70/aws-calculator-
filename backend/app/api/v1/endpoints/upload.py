from datetime import datetime, timedelta
import logging
import os
import uuid
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile
from app.core.config import settings
from app.services.bill_parser import bill_parser
from app.services.aws_mapper import aws_mapper

router = APIRouter()
logger = logging.getLogger("upload_endpoint")


@router.post("/upload")
async def upload_bill(file: UploadFile = File(...)):
    """
    Uploads a cloud bill (PDF, image, Excel, or CSV) and parses it into structured JSON.
    Files are stored in the temporary uploads directory and deleted after 24 hours.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    filename = file.filename
    ext = f".{filename.lower().split('.')[-1]}"
    rules = settings.load_rules()
    allowed_exts = rules.get("supported_extensions", [".pdf", ".png", ".jpg", ".jpeg", ".csv", ".xlsx", ".xls"])

    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed extensions: {', '.join(allowed_exts)}"
        )

    # Read content
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    # Check file size limit
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds maximum allowed size of {settings.MAX_FILE_SIZE_MB}MB (received {size_mb:.2f}MB)"
        )

    # Save to upload directory with unique identifier
    file_id = str(uuid.uuid4())
    stored_filename = f"{file_id}_{filename}"
    file_path = Path(settings.UPLOAD_DIR) / stored_filename

    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"Failed to save uploaded file: {e}")
        raise HTTPException(status_code=500, detail="Could not store upload file")

    # Parse document using BillParser
    try:
        parsed_result = bill_parser.parse_bill(content, filename)
    except Exception as e:
        logger.error(f"Error parsing bill '{filename}': {e}")
        raise HTTPException(status_code=500, detail=f"Parsing error: {str(e)}")

    # Automatically generate recommended AWS architectural mappings
    raw_items = parsed_result.get("items", [])
    mapped_resources = aws_mapper.map_all(raw_items, target_region=settings.AWS_REGION)

    expires_at = datetime.utcnow() + timedelta(hours=settings.FILE_RETENTION_HOURS)

    return {
        "status": "success",
        "file_id": file_id,
        "original_filename": filename,
        "file_size_bytes": len(content),
        "uploaded_at": datetime.utcnow().isoformat(),
        "retention_expires_at": expires_at.isoformat(),
        "default_target_aws_region": settings.AWS_REGION,
        **parsed_result,
        "mapped_resources": mapped_resources
    }


@router.get("/health")
def health_check():
    """Health check endpoint indicating active region and settings."""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "default_aws_region": settings.AWS_REGION,
        "retention_hours": settings.FILE_RETENTION_HOURS,
        "timestamp": datetime.utcnow().isoformat()
    }

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.endpoints.upload import router as upload_router
from app.api.v1.endpoints.mapping import router as mapping_router
from app.api.v1.endpoints.pricing import router as pricing_router
from app.core.config import settings
from app.utils.cleanup import run_cleanup_worker

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager to run background cleanup tasks."""
    logger.info(f"🚀 Starting {settings.APP_NAME}")
    logger.info(f"📍 Default AWS Region configured: {settings.AWS_REGION}")
    logger.info(f"⏳ File retention policy: Auto-delete uploads after {settings.FILE_RETENTION_HOURS} hours")

    # Start background cleanup worker task
    cleanup_task = asyncio.create_task(run_cleanup_worker(interval_seconds=3600))
    yield
    cleanup_task.cancel()
    logger.info("🛑 App shutdown, background tasks cancelled")


app = FastAPI(
    title=settings.APP_NAME,
    description="Multi-Cloud Billing Ingestion, Textract & Tabular Extraction, and AWS Cost Estimation API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(upload_router, prefix="/api/v1", tags=["Billing Ingestion & Upload"])
app.include_router(mapping_router, prefix="/api/v1/mapping", tags=["AWS Architecture Mapping & Edit"])
app.include_router(pricing_router, prefix="/api/v1/pricing", tags=["AWS Price List Cost Calculation & Export"])


@app.get("/")
def root():
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "docs": "/docs",
        "default_region": settings.AWS_REGION
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)

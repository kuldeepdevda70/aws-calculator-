import asyncio
import logging
import os
import time
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger("cleanup")


def cleanup_expired_uploads() -> int:
    """
    Deletes files from the upload directory that are older than FILE_RETENTION_HOURS (default 24 hours).
    Returns the count of deleted files.
    """
    upload_path = Path(settings.UPLOAD_DIR)
    if not upload_path.exists():
        return 0

    retention_seconds = settings.FILE_RETENTION_HOURS * 3600
    now = time.time()
    deleted_count = 0

    for item in upload_path.iterdir():
        if item.is_file():
            try:
                file_age = now - item.stat().st_mtime
                if file_age > retention_seconds:
                    item.unlink()
                    deleted_count += 1
                    logger.info(f"🗑️ Deleted expired uploaded bill: {item.name} (age: {file_age/3600:.1f} hours)")
            except Exception as e:
                logger.error(f"Failed to check or delete file {item.name}: {e}")

    return deleted_count


async def run_cleanup_worker(interval_seconds: int = 3600):
    """
    Background worker task that runs every hour to enforce the 24-hour file retention policy.
    """
    while True:
        try:
            count = cleanup_expired_uploads()
            if count > 0:
                logger.info(f"Cleanup worker pruned {count} expired file(s)")
        except Exception as e:
            logger.error(f"Error during scheduled file cleanup: {e}")
        
        await asyncio.sleep(interval_seconds)

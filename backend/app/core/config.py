import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic_settings import BaseSettings

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"


class Settings(BaseSettings):
    # App Information
    APP_NAME: str = "Cloud to AWS Migration Cost Estimator"
    APP_ENV: str = "development"
    DEBUG: bool = True
    PORT: int = 8000
    HOST: str = "0.0.0.0"

    # AWS Configuration - Mumbai default as required
    AWS_REGION: str = "ap-south-1"
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_SESSION_TOKEN: Optional[str] = None

    # Uploads and 24-hour Lifecycle Management
    UPLOAD_DIR: str = str(BASE_DIR / "uploads")
    FILE_RETENTION_HOURS: int = 24
    MAX_FILE_SIZE_MB: int = 50

    # Rules file path
    RULES_CONFIG_PATH: str = str(CONFIG_DIR / "rules.json")

    class Config:
        env_file = (".env", "../.env")
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

    def load_rules(self) -> Dict[str, Any]:
        """Loads non-hardcoded rules, provider detection keywords, and mappings from JSON."""
        rules_path = Path(self.RULES_CONFIG_PATH)
        if not rules_path.is_file():
            # Fallback path if running from root
            rules_path = BASE_DIR / "config" / "rules.json"
        
        if rules_path.is_file():
            with open(rules_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}


settings = Settings()

# Ensure uploads directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

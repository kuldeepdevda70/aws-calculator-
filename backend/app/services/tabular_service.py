import io
import logging
from typing import Any, Dict, List, Optional
import pandas as pd
from app.core.config import settings

logger = logging.getLogger("tabular_service")


class TabularService:
    def __init__(self):
        self.rules = settings.load_rules()
        self.col_mappings = self.rules.get("tabular_column_mappings", {})

    def parse_tabular_file(self, file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
        """
        Reads CSV or Excel files using pandas and standardizes them into structured row records.
        """
        ext = filename.lower().split(".")[-1]
        buffer = io.BytesIO(file_bytes)

        if ext == "csv":
            # Auto-detect separator if possible
            try:
                df = pd.read_csv(buffer, encoding="utf-8")
            except UnicodeDecodeError:
                buffer.seek(0)
                df = pd.read_csv(buffer, encoding="latin1")
        elif ext in ["xlsx", "xls"]:
            df = pd.read_excel(buffer)
        else:
            raise ValueError(f"Unsupported tabular file format: .{ext}")

        # Clean dataframe: drop completely empty rows and columns
        df = df.dropna(how="all").dropna(axis=1, how="all")
        if df.empty:
            return []

        # Find best matching columns using rules config
        normalized_cols = self._map_columns(df.columns.tolist())
        df = df.rename(columns=normalized_cols)

        records: List[Dict[str, Any]] = []
        for idx, row in df.iterrows():
            item = {
                "source_service_name": str(row.get("service") or row.get("raw_description") or f"Item {idx + 1}").strip(),
                "sku": str(row.get("sku") or "").strip() or None,
                "usage_amount": self._safe_float(row.get("usage")),
                "usage_unit": str(row.get("unit") or "Units").strip(),
                "cost": self._safe_float(row.get("cost")),
                "region": str(row.get("region") or settings.AWS_REGION).strip(),
                "raw_data": {str(k): (None if pd.isna(v) else v) for k, v in row.items()}
            }
            # Only include rows that have either a service description or cost/usage
            if item["source_service_name"] or item["cost"] > 0:
                records.append(item)

        return records

    def _map_columns(self, columns: List[str]) -> Dict[str, str]:
        """Maps arbitrary table headers to standard fields using configured aliases."""
        mapping: Dict[str, str] = {}
        for col in columns:
            clean_col = str(col).lower().strip().replace("_", " ")
            matched = False
            for target_field, aliases in self.col_mappings.items():
                if any(alias in clean_col for alias in aliases):
                    mapping[col] = target_field
                    matched = True
                    break
            if not matched:
                mapping[col] = col
        return mapping

    @staticmethod
    def _safe_float(val: Any) -> float:
        """Safely parses float numbers from messy currency/unit strings."""
        if val is None or pd.isna(val):
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        
        # Remove currency symbols and formatting commas
        cleaned = str(val).replace(",", "").replace("$", "").replace("₹", "").replace("€", "").replace("£", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return 0.0


tabular_service = TabularService()

import io
import logging
import re
from typing import Any, Dict, List, Optional
import pandas as pd
from app.core.config import settings
from app.services.normalizer import resource_normalizer

logger = logging.getLogger("tabular_service")


class TabularService:
    def __init__(self):
        self.rules = settings.load_rules()
        self.col_mappings = self.rules.get("tabular_column_mappings", {})

    def parse_tabular_file(self, file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
        """
        Reads CSV or Excel files using pandas and standardizes them into structured row records.
        Preserves original raw data and applies robust priority-based column mapping.
        """
        ext = filename.lower().split(".")[-1]
        buffer = io.BytesIO(file_bytes)

        if ext == "csv":
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

        # Retain original column names and copy for raw provenance
        original_df = df.copy()

        # Find best matching columns using rules config
        normalized_cols = self._map_columns(df.columns.tolist())
        df = df.rename(columns=normalized_cols)

        records: List[Dict[str, Any]] = []
        for idx, row in df.iterrows():
            orig_row = original_df.iloc[idx]

            def _get_val(k):
                v = row.get(k)
                if isinstance(v, pd.Series):
                    v = v.iloc[0] if not v.empty else None
                if pd.isna(v):
                    return None
                return v

            service_val = _get_val("service") or _get_val("raw_description")
            sku_val = _get_val("sku")
            unit_val = _get_val("unit")
            region_val = _get_val("region") or settings.AWS_REGION
            cost_val = self._safe_float(_get_val("cost"))
            usage_val = self._safe_float(_get_val("usage"))

            # Fallbacks: if service_val is empty, check raw fields
            if not service_val or str(service_val).strip() == "":
                for fallback_col in ["MeterCategory", "ConsumedService", "ResourceType", "Product"]:
                    if fallback_col in orig_row and not pd.isna(orig_row[fallback_col]):
                        service_val = str(orig_row[fallback_col]).strip()
                        break
                if not service_val:
                    service_val = f"Resource-{idx + 1}"

            # If sku is empty, check MeterName or InstanceType in original row
            if not sku_val:
                for fallback_sku in ["MeterName", "meter_name", "InstanceType", "instance_type", "sku_name"]:
                    if fallback_sku in orig_row and not pd.isna(orig_row[fallback_sku]):
                        sku_val = str(orig_row[fallback_sku]).strip()
                        break

            # Raw record dictionary preserving full provenance
            raw_record = {str(k): (None if pd.isna(v) else v) for k, v in orig_row.items()}

            item = {
                "id": f"item-{idx + 1}",
                "source_service_name": str(service_val).strip(),
                "sku": str(sku_val).strip() if sku_val is not None else None,
                "usage_amount": usage_val,
                "usage_unit": str(unit_val).strip() if unit_val is not None else "Units",
                "cost": cost_val,
                "region": str(region_val).strip(),
                "raw_data": raw_record,
                "raw_record": raw_record,
                "row_index": idx + 1
            }

            # Only include rows that have meaningful service description, usage, or cost
            if item["source_service_name"] or item["cost"] > 0 or item["usage_amount"] > 0:
                records.append(item)

        return records

    def _map_columns(self, columns: List[str]) -> Dict[str, str]:
        """
        Maps arbitrary table headers to standard fields using scored candidate matching.
        Ensures high-priority aliases (e.g. 'meter name' for sku) beat generic terms (e.g. 'resource type').
        """
        mapping: Dict[str, str] = {}
        assigned_cols = set()

        # Target fields in priority order of mapping resolution
        target_priority = ["sku", "cost", "usage", "service", "unit", "region"]

        for target_field in target_priority:
            aliases = self.col_mappings.get(target_field, [])
            best_col = None
            best_score = -1

            for col in columns:
                if col in assigned_cols:
                    continue

                clean_col = str(col).lower().strip().replace("_", " ")

                for alias_idx, alias in enumerate(aliases):
                    clean_alias = alias.lower().strip()
                    score = 0
                    if clean_col == clean_alias:
                        score = 1000 - alias_idx * 10
                    elif clean_col.startswith(clean_alias) or clean_col.endswith(clean_alias):
                        score = 600 - alias_idx * 10
                    elif re.search(rf"\b{re.escape(clean_alias)}\b", clean_col):
                        score = 400 - alias_idx * 10
                    elif clean_alias in clean_col:
                        score = 200 - alias_idx * 10

                    if score > best_score:
                        best_score = score
                        best_col = col

            if best_col and best_score > 0:
                mapping[best_col] = target_field
                assigned_cols.add(best_col)

        # For remaining unmapped columns, keep original names
        for col in columns:
            if col not in mapping:
                mapping[col] = col

        return mapping

    @staticmethod
    def _safe_float(val: Any) -> float:
        """Safely parses float numbers from messy currency/unit strings."""
        if val is None or pd.isna(val):
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        
        cleaned = str(val).replace(",", "").replace("$", "").replace("₹", "").replace("€", "").replace("£", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return 0.0


tabular_service = TabularService()

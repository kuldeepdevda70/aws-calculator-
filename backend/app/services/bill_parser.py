import logging
import re
from typing import Any, Dict, List, Tuple
from app.core.config import settings
from app.services.textract_service import textract_service
from app.services.tabular_service import tabular_service
from app.services.normalizer import resource_normalizer

logger = logging.getLogger("bill_parser")


class BillParser:
    def __init__(self):
        self.rules = settings.load_rules()

    def parse_bill(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """
        Coordinates document reading between Amazon Textract (PDF/Images) and pandas (Excel/CSV).
        Returns unified structured JSON.
        """
        ext = f".{filename.lower().split('.')[-1]}"

        if ext in [".pdf", ".png", ".jpg", ".jpeg"]:
            return self._parse_with_textract(file_bytes, filename)
        elif ext in [".csv", ".xlsx", ".xls"]:
            return self._parse_with_tabular(file_bytes, filename)
        else:
            raise ValueError(f"Unsupported file extension: {ext}")

    def _parse_with_textract(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """Extracts document data via Textract or local fallback and processes detected lines/tables."""
        extracted = textract_service.extract_document(file_bytes, filename=filename)
        raw_text = extracted.get("raw_text", "")
        tables = extracted.get("tables", [])

        provider = resource_normalizer.detect_provider(raw_text)
        currency, symbol = resource_normalizer.detect_currency(raw_text)

        items: List[Dict[str, Any]] = []

        # Process any extracted tables from Textract
        if tables:
            for table in tables:
                if len(table) > 1:
                    headers = [str(cell).lower().strip() for cell in table[0]]
                    for row in table[1:]:
                        if any(cell.strip() for cell in row):
                            desc = row[0] if len(row) > 0 else "Cloud Resource"
                            qty = self._find_first_numeric(row[1:]) if len(row) > 1 else 1.0
                            cost = self._find_first_numeric(list(reversed(row[1:]))) if len(row) > 1 else 0.0
                            sku = self._extract_sku(desc)
                            specs = resource_normalizer.extract_specs(desc, sku=sku)

                            items.append({
                                "id": f"item-{len(items) + 1}",
                                "source_provider": provider,
                                "source_service_name": desc,
                                "sku": sku,
                                "specs": specs,
                                "usage_amount": qty,
                                "usage_unit": "Units",
                                "cost": cost,
                                "source_region": resource_normalizer.normalize_region(None),
                                "raw_description": " | ".join(row),
                                "raw_record": {f"col_{c_idx}": val for c_idx, val in enumerate(row)}
                            })

        # If no tables found, construct line items from lines that look like bill line items
        if not items and extracted.get("lines"):
            raw_full = extracted.get("raw_text", "")
            lines_to_process = extracted["lines"]

            if "Usage Charges" in raw_full:
                usage_idx = -1
                for idx, l in enumerate(lines_to_process):
                    if "Usage Charges" in l:
                        usage_idx = idx
                        break
                if usage_idx != -1:
                    lines_to_process = lines_to_process[usage_idx:]

            ignore_prefixes = (
                "commercial invoice", "payment ref", "statement date", "usage charges",
                "name type", "detailed usage", "additional info", "discover", "useful resources",
                "support", "connect with", "visit windows", "total (inr)", "grand total",
                "sub-total", "order id", "subscription id", "billing period", "due date",
                "state of destination", "total charges", "total inr", "pan no", "cin ",
                "phone number", "web support", "gstin", "rupees", "regd. office",
                "total:", "total ", "amount in words", "payment instructions"
            )
            pending_title = ""
            for line in lines_to_process:
                line_clean = line.strip()
                line_lower = line_clean.lower()
                if any(line_lower.startswith(p) for p in ignore_prefixes) or "regd. office" in line_lower:
                    continue

                num_matches = list(re.finditer(r"[\d,]+\.\d{2,4}", line_clean))
                if len(num_matches) >= 2:
                    first_num = num_matches[0]
                    sub_name = line_clean[:first_num.start()].strip()
                    full_name = f"{pending_title} {sub_name}".strip() if pending_title else sub_name
                    try:
                        cost_val = float(num_matches[-1].group(0).replace(",", ""))
                    except ValueError:
                        cost_val = 0.0

                    usage_val = 1.0
                    if len(num_matches) >= 3:
                        try:
                            usage_val = float(num_matches[-3].group(0).replace(",", ""))
                        except ValueError:
                            usage_val = 1.0
                    elif num_matches:
                        try:
                            usage_val = float(first_num.group(0).replace(",", ""))
                        except ValueError:
                            usage_val = 1.0

                    if len(full_name) > 2 and not any(full_name.lower().startswith(p) for p in ignore_prefixes):
                        sku = self._extract_sku(full_name) or self._extract_sku(line_clean)
                        specs = resource_normalizer.extract_specs(full_name, sku=sku)

                        items.append({
                            "id": f"item-{len(items) + 1}",
                            "source_provider": provider,
                            "source_service_name": full_name,
                            "sku": sku,
                            "specs": specs,
                            "usage_amount": usage_val,
                            "usage_unit": "Units",
                            "cost": cost_val,
                            "source_region": resource_normalizer.normalize_region(None),
                            "raw_description": line_clean,
                            "raw_record": {"raw_line": line_clean}
                        })
                    pending_title = ""
                else:
                    if len(line_clean) > 3 and not any(line_lower.startswith(p) for p in ignore_prefixes):
                        pending_title = f"{pending_title} {line_clean}".strip()
                    else:
                        pending_title = ""

        return {
            "file_type": extracted.get("extraction_source", "pdf_document"),
            "detected_provider": provider,
            "detected_currency": currency,
            "currency_symbol": symbol,
            "total_items": len(items),
            "items": items,
            "raw_text_summary": raw_text[:500] if raw_text else None
        }

    def _parse_with_tabular(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """Extracts data via pandas tabular engine with normalized specs and metadata."""
        records = tabular_service.parse_tabular_file(file_bytes, filename)
        all_text = " ".join([r.get("source_service_name", "") + " " + str(r.get("raw_data", "")) for r in records])

        provider = resource_normalizer.detect_provider(all_text)
        currency, symbol = resource_normalizer.detect_currency(all_text)

        items = []
        for idx, rec in enumerate(records):
            sku = rec.get("sku") or self._extract_sku(rec.get("source_service_name", ""))
            specs = resource_normalizer.extract_specs(
                rec.get("source_service_name", ""),
                sku=sku,
                unit=rec.get("usage_unit")
            )
            raw_rec = rec.get("raw_record") or rec.get("raw_data") or {}

            items.append({
                "id": rec.get("id") or f"item-{idx + 1}",
                "source_provider": provider,
                "source_service_name": rec.get("source_service_name"),
                "sku": sku,
                "specs": specs,
                "usage_amount": rec.get("usage_amount", 0.0),
                "usage_unit": rec.get("usage_unit", "Units"),
                "cost": rec.get("cost", 0.0),
                "source_region": resource_normalizer.normalize_region(rec.get("region")),
                "raw_description": str(rec.get("raw_data", "")),
                "raw_record": raw_rec,
                "row_index": rec.get("row_index", idx + 1)
            })

        return {
            "file_type": "tabular",
            "detected_provider": provider,
            "detected_currency": currency,
            "currency_symbol": symbol,
            "total_items": len(items),
            "items": items
        }

    @staticmethod
    def _extract_sku(text: str) -> str | None:
        """Extracts common instance sizes (e.g. Standard_D2s_v3, t3.medium, n1-standard-1, D2s v3, B1ms, E4)."""
        m_az = re.search(r"\b([A-Z]\d+[a-z]*(?:\s*v\d+)?)\b", text)
        if m_az:
            return m_az.group(1).replace(" ", "_")
        match = re.search(r"\b([a-zA-Z0-9]+[_\-.][a-zA-Z0-9]+(?:[_\-.][a-zA-Z0-9]+)?)\b", text)
        return match.group(1) if match else None

    @staticmethod
    def _find_first_numeric(items: List[str]) -> float:
        for val in items:
            cleaned = re.sub(r"[^\d.]", "", str(val))
            if cleaned:
                try:
                    return float(cleaned)
                except ValueError:
                    continue
        return 0.0


bill_parser = BillParser()

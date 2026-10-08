import logging
import re
from typing import Any, Dict, List, Tuple
from app.core.config import settings
from app.services.textract_service import textract_service
from app.services.tabular_service import tabular_service

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

        provider = self._detect_provider(raw_text)
        currency, symbol = self._detect_currency(raw_text)

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

                            items.append({
                                "id": f"item-{len(items) + 1}",
                                "source_provider": provider,
                                "source_service_name": desc,
                                "sku": self._extract_sku(desc),
                                "usage_amount": qty,
                                "usage_unit": "Units",
                                "cost": cost,
                                "source_region": settings.AWS_REGION,
                                "raw_description": " | ".join(row)
                            })

        # If no tables found, construct line items from lines that look like bill line items
        if not items and extracted.get("lines"):
            ignore_prefixes = (
                "order id", "subscription id", "billing period", "due date",
                "state of destination", "total charges", "grand total", "sub-total",
                "total (", "total inr", "total amount", "total:", "total ",
                "service period", "statement date", "commercial invoice", "payment ref",
                "pan no", "cin ", "phone number", "web support", "gstin", "rupees",
                "regd. office", "tax invoice", "invoice number", "bill to", "ship to",
                "amount in words", "payment instructions"
            )
            prev_descriptive_line = ""
            for line in extracted["lines"]:
                line_clean = line.strip()
                line_lower = line_clean.lower()
                if any(line_lower.startswith(p) for p in ignore_prefixes) or "regd. office" in line_lower:
                    prev_descriptive_line = ""
                    continue
                if re.match(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", line_clean):
                    prev_descriptive_line = ""
                    continue

                num_matches = list(re.finditer(r"[\d,]+(?:\.\d{2,4})", line_clean))
                if num_matches:
                    try:
                        cost_val = float(num_matches[-1].group(0).replace(",", ""))
                    except ValueError:
                        continue

                    service_name = line_clean[:num_matches[0].start()].strip()
                    if not service_name:
                        service_name = line_clean[:50].strip()

                    # Stitch previous context if current name was orphaned (e.g. 'Addresses')
                    if len(service_name.split()) <= 2 and prev_descriptive_line:
                        service_name = f"{prev_descriptive_line} - {service_name}".strip()

                    usage_val = 1.0
                    if len(num_matches) > 1:
                        try:
                            usage_val = float(num_matches[0].group(0).replace(",", ""))
                        except ValueError:
                            usage_val = 1.0

                    if len(service_name) > 2 and not any(service_name.lower().startswith(p) for p in ignore_prefixes):
                        items.append({
                            "id": f"item-{len(items) + 1}",
                            "source_provider": provider,
                            "source_service_name": service_name,
                            "sku": self._extract_sku(service_name) or self._extract_sku(line_clean),
                            "usage_amount": usage_val,
                            "usage_unit": "Units",
                            "cost": cost_val,
                            "source_region": settings.AWS_REGION,
                            "raw_description": line_clean
                        })
                    prev_descriptive_line = ""
                else:
                    # Line has no numbers - could be a header/title for the next line
                    if len(line_clean) > 5 and not any(line_lower.startswith(p) for p in ignore_prefixes):
                        prev_descriptive_line = line_clean
                    else:
                        prev_descriptive_line = ""

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
        """Extracts data via pandas tabular engine."""
        records = tabular_service.parse_tabular_file(file_bytes, filename)
        all_text = " ".join([r.get("source_service_name", "") + " " + str(r.get("raw_data", "")) for r in records])

        provider = self._detect_provider(all_text)
        currency, symbol = self._detect_currency(all_text)

        items = []
        for idx, rec in enumerate(records):
            items.append({
                "id": f"item-{idx + 1}",
                "source_provider": provider,
                "source_service_name": rec.get("source_service_name"),
                "sku": rec.get("sku") or self._extract_sku(rec.get("source_service_name", "")),
                "usage_amount": rec.get("usage_amount", 0.0),
                "usage_unit": rec.get("usage_unit", "Units"),
                "cost": rec.get("cost", 0.0),
                "source_region": rec.get("region", settings.AWS_REGION),
                "raw_description": str(rec.get("raw_data", ""))
            })

        return {
            "file_type": "tabular",
            "detected_provider": provider,
            "detected_currency": currency,
            "currency_symbol": symbol,
            "total_items": len(items),
            "items": items
        }

    def _detect_provider(self, text: str) -> str:
        """Identifies source provider using keywords loaded from rules config."""
        text_lower = text.lower()
        providers = self.rules.get("providers", {})
        for key, p_data in providers.items():
            for kw in p_data.get("keywords", []):
                if kw in text_lower:
                    return p_data.get("name", key.capitalize())
        return "Unknown Cloud"

    def _detect_currency(self, text: str) -> Tuple[str, str]:
        """Identifies billing currency using keywords and symbols from rules config."""
        text_lower = text.lower()
        currencies = self.rules.get("currencies", {})
        for code, c_data in currencies.items():
            for kw in c_data.get("keywords", []):
                if kw in text_lower:
                    return code, c_data.get("symbol", "$")
        return "USD", "$"

    @staticmethod
    def _extract_sku(text: str) -> str | None:
        """Extracts common instance sizes (e.g. Standard_D2s_v3, t3.medium, n1-standard-1, D2s v3, B1ms, E4)."""
        # Look for explicit patterns like D2 v3, D2s v3, B1ms, B2s, E4, P6
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

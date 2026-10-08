import io
import logging
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from app.core.config import settings

logger = logging.getLogger("textract_service")


class TextractService:
    def __init__(self):
        self.region = settings.AWS_REGION
        self._client = None

    def get_client(self):
        """Initializes and caches the boto3 Textract client using configured settings."""
        if not self._client:
            kwargs = {"region_name": self.region}
            if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
                if settings.AWS_SESSION_TOKEN:
                    kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN

            self._client = boto3.client("textract", **kwargs)
        return self._client

    def extract_document(self, file_bytes: bytes, filename: str = "") -> Dict[str, Any]:
        """
        Processes PDF or image document bytes using Amazon Textract or local fallback.
        - Synchronous Textract only supports 1 page; multi-page PDFs automatically use local engine.
        - Falls back gracefully to local PDF parser if AWS credentials are invalid or Textract fails.
        """
        is_pdf = file_bytes.startswith(b"%PDF") or filename.lower().endswith(".pdf")

        # 1. Multi-page PDFs cannot use Textract synchronous API (only single-page supported)
        if is_pdf:
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(file_bytes))
                page_count = len(reader.pages)
                if page_count > 1:
                    logger.info(
                        f"Multi-page PDF detected ({page_count} pages). "
                        "AWS Textract sync API only supports 1 page; using local PDF extractor."
                    )
                    return self._extract_with_local_pdf(file_bytes)
            except Exception as e:
                logger.debug(f"Could not inspect PDF page count: {e}")

        # 2. Attempt Amazon Textract
        try:
            client = self.get_client()
            response = client.analyze_document(
                Document={"Bytes": file_bytes},
                FeatureTypes=["TABLES", "FORMS"]
            )
            result = self._parse_textract_blocks(response.get("Blocks", []))
            result["extraction_source"] = "aws_textract_analyze"
            return result
        except (BotoCoreError, ClientError) as e:
            logger.warning(f"analyze_document failed ({e}); attempting detect_document_text fallback...")
            try:
                client = self.get_client()
                response = client.detect_document_text(Document={"Bytes": file_bytes})
                result = self._parse_textract_blocks(response.get("Blocks", []))
                result["extraction_source"] = "aws_textract_detect"
                return result
            except Exception as inner_e:
                logger.warning(f"Amazon Textract API call failed: {inner_e}")
                if is_pdf:
                    logger.info("Falling back to local PDF extractor due to Textract failure...")
                    return self._extract_with_local_pdf(file_bytes)
                raise RuntimeError(
                    f"Amazon Textract analysis failed ({str(inner_e)}). "
                    "Please check your AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN) "
                    "or upload a PDF for local fallback processing."
                )

    def _extract_with_local_pdf(self, file_bytes: bytes) -> Dict[str, Any]:
        """Extracts text lines from PDF using pypdf locally without external AWS dependency."""
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            lines: List[str] = []
            for page in reader.pages:
                text = page.extract_text() or ""
                for line in text.splitlines():
                    cleaned = line.strip()
                    if cleaned:
                        lines.append(cleaned)

            logger.info(f"Local PDF extractor successfully read {len(lines)} lines from {len(reader.pages)} pages")
            return {
                "raw_text": "\n".join(lines),
                "lines": lines,
                "tables": [],
                "extraction_source": "local_pdf",
                "page_count": len(reader.pages)
            }
        except Exception as e:
            logger.error(f"Local PDF extraction failed: {e}")
            return {
                "raw_text": "",
                "lines": [],
                "tables": [],
                "extraction_source": "local_pdf_error"
            }

    def _parse_textract_blocks(self, blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Parses Textract blocks into raw lines, key-value forms, and tabular rows."""
        lines: List[str] = []
        block_map: Dict[str, Dict[str, Any]] = {b["Id"]: b for b in blocks}
        tables: List[List[List[str]]] = []

        # 1. Extract plain text lines
        for block in blocks:
            if block.get("BlockType") == "LINE":
                text = block.get("Text", "").strip()
                if text:
                    lines.append(text)

        # 2. Extract tables
        for block in blocks:
            if block.get("BlockType") == "TABLE":
                table_rows: Dict[int, Dict[int, str]] = {}
                relationships = block.get("Relationships", [])

                cell_ids = []
                for rel in relationships:
                    if rel.get("Type") == "CHILD":
                        cell_ids.extend(rel.get("Ids", []))

                for cell_id in cell_ids:
                    cell_block = block_map.get(cell_id, {})
                    if cell_block.get("BlockType") == "CELL":
                        r_idx = cell_block.get("RowIndex", 1) - 1
                        c_idx = cell_block.get("ColumnIndex", 1) - 1

                        # Get text inside the cell
                        cell_text = ""
                        for cell_rel in cell_block.get("Relationships", []):
                            if cell_rel.get("Type") == "CHILD":
                                words = [block_map[w_id].get("Text", "") for w_id in cell_rel.get("Ids", []) if w_id in block_map]
                                cell_text = " ".join(words).strip()

                        if r_idx not in table_rows:
                            table_rows[r_idx] = {}
                        table_rows[r_idx][c_idx] = cell_text

                # Assemble 2D matrix
                sorted_rows = []
                for r in sorted(table_rows.keys()):
                    row_dict = table_rows[r]
                    max_col = max(row_dict.keys()) if row_dict else 0
                    sorted_rows.append([row_dict.get(c, "") for c in range(max_col + 1)])

                if sorted_rows:
                    tables.append(sorted_rows)

        return {
            "raw_text": "\n".join(lines),
            "lines": lines,
            "tables": tables,
        }


textract_service = TextractService()

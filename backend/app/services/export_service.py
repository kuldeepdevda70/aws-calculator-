import io
import logging
from typing import Any, Dict, List
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

logger = logging.getLogger("export_service")


class ExportService:
    """
    Generates downloadable Excel (.xlsx) and PDF (.pdf) cost estimate reports
    from calculated AWS architecture migration workloads.
    """

    def generate_excel_report(self, estimate_data: Dict[str, Any]) -> io.BytesIO:
        """Creates a styled Excel workbook with summary KPIs and itemized workload details."""
        wb = Workbook()
        ws = wb.active
        ws.title = "AWS Cost Estimate"

        # Styles
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        accent_fill = PatternFill(start_color="FF9900", end_color="FF9900", fill_type="solid")
        zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        
        font_title = Font(name="Calibri", size=16, bold=True, color="1E293B")
        font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        font_bold = Font(name="Calibri", size=11, bold=True)
        font_regular = Font(name="Calibri", size=11)
        
        thin_border = Border(
            left=Side(style='thin', color='E2E8F0'),
            right=Side(style='thin', color='E2E8F0'),
            top=Side(style='thin', color='E2E8F0'),
            bottom=Side(style='thin', color='E2E8F0')
        )

        # Title Block
        ws.merge_cells("A1:H1")
        ws["A1"] = "Cloud to AWS Migration Cost Estimate"
        ws["A1"].font = font_title
        ws["A1"].alignment = Alignment(vertical="center")
        ws.row_dimensions[1].height = 30

        # Summary KPIs
        monthly_cost = estimate_data.get("total_monthly_cost_usd", 0.0)
        annual_cost = estimate_data.get("total_annual_cost_usd", 0.0)
        region = estimate_data.get("default_region", "ap-south-1")
        total_items = estimate_data.get("total_resources_calculated", 0)

        ws["A3"] = "Target AWS Region:"
        ws["B3"] = f"{region} (Mumbai Default)"
        ws["A4"] = "Total Workloads:"
        ws["B4"] = total_items
        ws["A5"] = "Estimated Monthly Cost (USD):"
        ws["B5"] = monthly_cost
        ws["B5"].number_format = '$#,##0.00'
        ws["A6"] = "Estimated Annual Cost (USD):"
        ws["B6"] = annual_cost
        ws["B6"].number_format = '$#,##0.00'

        for r in range(3, 7):
            ws[f"A{r}"].font = font_bold
            ws[f"B{r}"].font = font_bold

        # Table Headers
        headers = [
            "Source Workload", "Source Cost", "Target AWS Service",
            "Instance / Spec", "Quantity", "Unit Rate (USD)", "Monthly Cost (USD)", "Annual Cost (USD)"
        ]
        
        start_row = 9
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=start_row, column=col_idx, value=header)
            cell.font = font_header
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[start_row].height = 25

        # Table Rows
        resources = estimate_data.get("priced_resources", [])
        current_row = start_row + 1
        for idx, res in enumerate(resources):
            ws.cell(row=current_row, column=1, value=res.get("source_service_name", ""))
            
            c2 = ws.cell(row=current_row, column=2, value=float(res.get("source_cost", 0.0)))
            c2.number_format = '#,##0.00'

            ws.cell(row=current_row, column=3, value=res.get("target_aws_service", ""))
            ws.cell(row=current_row, column=4, value=res.get("target_aws_instance_type", ""))
            ws.cell(row=current_row, column=5, value=float(res.get("target_quantity", 1.0)))

            c6 = ws.cell(row=current_row, column=6, value=float(res.get("pricing_unit_rate", 0.0)))
            c6.number_format = '$#,##0.0000'

            c7 = ws.cell(row=current_row, column=7, value=float(res.get("monthly_cost_usd", 0.0)))
            c7.number_format = '$#,##0.00'

            c8 = ws.cell(row=current_row, column=8, value=float(res.get("annual_cost_usd", 0.0)))
            c8.number_format = '$#,##0.00'

            for c in range(1, 9):
                cell = ws.cell(row=current_row, column=c)
                cell.font = font_regular
                cell.border = thin_border
                if idx % 2 == 1:
                    cell.fill = zebra_fill

            current_row += 1

        # Total Row
        ws.cell(row=current_row, column=1, value="TOTAL ESTIMATED AWS COST").font = font_bold
        ws.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=6)
        tot_m = ws.cell(row=current_row, column=7, value=monthly_cost)
        tot_m.font = font_bold
        tot_m.number_format = '$#,##0.00'
        tot_m.fill = accent_fill

        tot_a = ws.cell(row=current_row, column=8, value=annual_cost)
        tot_a.font = font_bold
        tot_a.number_format = '$#,##0.00'
        tot_a.fill = accent_fill

        # Auto-adjust column widths
        col_widths = {1: 42, 2: 15, 3: 26, 4: 22, 5: 12, 6: 18, 7: 20, 8: 20}
        for col_idx, width in col_widths.items():
            ws.column_dimensions[chr(64 + col_idx)].width = width

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    def generate_pdf_report(self, estimate_data: Dict[str, Any]) -> io.BytesIO:
        """Generates a landscape PDF cost estimate summary table using ReportLab."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            rightMargin=30,
            leftMargin=30,
            topMargin=30,
            bottomMargin=30
        )
        
        styles = getSampleStyleSheet()
        elements = []

        # Title
        title_style = ParagraphStyle(
            name="TitleStyle",
            parent=styles["Heading1"],
            fontSize=18,
            leading=22,
            textColor=colors.HexColor("#1E293B")
        )
        subtitle_style = ParagraphStyle(
            name="SubtitleStyle",
            parent=styles["Normal"],
            fontSize=10,
            textColor=colors.HexColor("#64748B")
        )
        
        elements.append(Paragraph("<b>Cloud to AWS Migration Cost Estimate</b>", title_style))
        region = estimate_data.get("default_region", "ap-south-1")
        monthly = estimate_data.get("total_monthly_cost_usd", 0.0)
        annual = estimate_data.get("total_annual_cost_usd", 0.0)
        elements.append(Paragraph(
            f"Target Region: <b>{region} (Mumbai Default)</b> | "
            f"Monthly AWS Cost: <b>${monthly:,.2f} USD</b> | "
            f"Annual AWS Cost: <b>${annual:,.2f} USD</b>",
            subtitle_style
        ))
        elements.append(Spacer(1, 15))

        # Data Table
        table_data = [[
            Paragraph("<b>Source Workload</b>", styles["Normal"]),
            Paragraph("<b>Source Cost</b>", styles["Normal"]),
            Paragraph("<b>Target AWS Service</b>", styles["Normal"]),
            Paragraph("<b>Instance / Spec</b>", styles["Normal"]),
            Paragraph("<b>Qty</b>", styles["Normal"]),
            Paragraph("<b>Monthly USD</b>", styles["Normal"]),
            Paragraph("<b>Annual USD</b>", styles["Normal"])
        ]]

        resources = estimate_data.get("priced_resources", [])[:50] # Top 50 items for clean PDF formatting
        for r in resources:
            src_name = (r.get("source_service_name") or "")[:35]
            src_cost = float(r.get("source_cost") or 0.0)
            aws_svc = r.get("target_aws_service", "")
            inst = r.get("target_aws_instance_type", "")
            qty = r.get("target_quantity", 1.0)
            m_cost = float(r.get("monthly_cost_usd") or 0.0)
            a_cost = float(r.get("annual_cost_usd") or 0.0)

            table_data.append([
                Paragraph(src_name, styles["Normal"]),
                f"{src_cost:,.2f}",
                Paragraph(aws_svc, styles["Normal"]),
                Paragraph(inst, styles["Normal"]),
                str(qty),
                f"${m_cost:,.2f}",
                f"${a_cost:,.2f}"
            ])

        # Table Styling
        t = Table(table_data, colWidths=[180, 75, 130, 110, 45, 95, 95])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1E293B")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (4, 1), (-1, -1), 'RIGHT'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
            ('TOPPADDING', (0, 0), (-1, 0), 6),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#FFFFFF"), colors.HexColor("#F8FAFC")]),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
        ]))
        elements.append(t)

        doc.build(elements)
        buffer.seek(0)
        return buffer


export_service = ExportService()

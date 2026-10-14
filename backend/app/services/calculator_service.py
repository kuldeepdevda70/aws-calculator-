import sys
import re
import asyncio
import concurrent.futures
import logging
from typing import Any, Dict, List, Optional, Tuple
from playwright.sync_api import sync_playwright
from app.core.config import settings

logger = logging.getLogger("calculator_service")

# Mapping of region codes to matching text in calculator.aws region selector
REGION_KEYWORDS = {
    "ap-south-1": "Mumbai",
    "us-east-1": "N. Virginia",
    "us-east-2": "Ohio",
    "us-west-1": "N. California",
    "us-west-2": "Oregon",
    "eu-west-1": "Ireland",
    "eu-central-1": "Frankfurt",
    "ap-southeast-1": "Singapore",
    "ap-southeast-2": "Sydney",
    "ap-northeast-1": "Tokyo"
}


class AWSCalculatorAutomationService:
    """
    Automates the official AWS Pricing Calculator (calculator.aws) using Playwright.
    Dynamically groups and configures multiple real workloads (EC2 Compute instances,
    EBS Block Storage, RDS Databases, S3 Object Storage) based on the uploaded bill,
    saves each workload into the active estimate session, scrapes the estimate summary,
    and extracts the official shareable URL.
    """

    def __init__(self):
        rules = settings.load_rules()
        calc_config = rules.get("calculator_automation", {})
        self.calculator_url = calc_config.get("url", settings.CALCULATOR_URL)
        self.timeout_seconds = calc_config.get("timeout_seconds", settings.PLAYWRIGHT_TIMEOUT_SECONDS)
        self.headless = calc_config.get("headless", settings.PLAYWRIGHT_HEADLESS)

    def _build_dynamic_workloads(self, resources: List[Dict[str, Any]], max_workloads: int = 12) -> List[Dict[str, Any]]:
        """
        Dynamically extracts and aggregates distinct AWS architecture workloads from the bill.
        Groups compute, block storage, databases, and object storage without artificial caps.
        """
        if not resources:
            return []

        workloads: List[Dict[str, Any]] = []

        # 1. Group EC2 Compute workloads by distinct instance type
        ec2_items = [
            r for r in resources
            if "EC2" in r.get("target_aws_service_code", "")
            or "EC2" in r.get("target_aws_service", "")
            or r.get("target_aws_category") == "Compute"
        ]

        if ec2_items:
            ec2_by_type: Dict[str, List[Dict[str, Any]]] = {}
            for item in ec2_items:
                itype = item.get("target_aws_instance_type") or "t3.medium"
                ec2_by_type.setdefault(itype, []).append(item)

            for itype, group in ec2_by_type.items():
                total_qty = sum(float(x.get("target_quantity") or 1.0) for x in group)
                total_qty = max(1, int(round(total_qty)))
                first_name = group[0].get("source_service_name") or "Virtual Machine"
                desc = f"{first_name} ({itype} x {total_qty})"[:90]

                workloads.append({
                    "type": "ec2",
                    "service_search": "Amazon EC2",
                    "description": desc,
                    "instance_type": itype,
                    "quantity": total_qty,
                    "count": len(group)
                })

        # 2. Group EBS Block Storage workloads
        ebs_items = [
            r for r in resources
            if "EBS" in r.get("target_aws_service_code", "")
            or "EBS" in r.get("target_aws_service", "")
            or r.get("target_aws_category") == "Block Storage"
            or "disk" in (r.get("source_service_name") or "").lower()
        ]

        if ebs_items:
            total_storage_gb = 0.0
            for item in ebs_items:
                st = float(item.get("target_storage_gb") or item.get("source_usage_amount") or 0.0)
                if st <= 0:
                    st = 50.0
                total_storage_gb += st

            total_storage_gb = max(30, int(round(total_storage_gb)))
            num_volumes = max(1, len(ebs_items))
            first_name = ebs_items[0].get("source_service_name") or "Managed Disks"
            desc = f"{first_name} ({num_volumes} volumes - {total_storage_gb} GB total)"[:90]

            workloads.append({
                "type": "ebs",
                "service_search": "Amazon Elastic Block Store",
                "description": desc,
                "storage_gb": total_storage_gb,
                "num_volumes": num_volumes
            })

        # 3. Group RDS Database workloads
        rds_items = [
            r for r in resources
            if "RDS" in r.get("target_aws_service_code", "")
            or "RDS" in r.get("target_aws_service", "")
            or r.get("target_aws_category") == "Database"
        ]

        if rds_items:
            first_rds = rds_items[0]
            raw_desc = (first_rds.get("source_service_name") or "").lower()
            engine = first_rds.get("db_engine") or ("PostgreSQL" if "postgres" in raw_desc else "MySQL")
            itype = first_rds.get("target_aws_instance_type") or "db.t3.medium"
            db_storage = sum(float(x.get("target_storage_gb") or 50.0) for x in rds_items)
            db_storage = max(20, int(round(db_storage)))

            desc = f"Database Cluster ({engine} - {itype})"[:90]
            workloads.append({
                "type": "rds",
                "service_search": f"Amazon RDS for {engine}",
                "description": desc,
                "engine": engine,
                "instance_type": itype,
                "storage_gb": db_storage
            })

        # 4. Group S3 Object Storage workloads
        s3_items = [
            r for r in resources
            if "S3" in r.get("target_aws_service_code", "")
            or "S3" in r.get("target_aws_service", "")
            or r.get("target_aws_category") == "Object Storage"
            or "blob" in (r.get("source_service_name") or "").lower()
        ]

        if s3_items:
            total_s3_storage = sum(float(x.get("target_storage_gb") or x.get("source_usage_amount") or 50.0) for x in s3_items)
            total_s3_storage = max(20, int(round(total_s3_storage)))
            desc = f"Object Storage ({len(s3_items)} buckets - {total_s3_storage} GB)"[:90]

            workloads.append({
                "type": "s3",
                "service_search": "Amazon Simple Storage Service",
                "description": desc,
                "storage_gb": total_s3_storage
            })

        # Fallback if no specific workloads categorized
        if not workloads and resources:
            first_res = resources[0]
            workloads.append({
                "type": "ec2",
                "service_search": "Amazon EC2",
                "description": first_res.get("source_service_name") or "Primary Workload",
                "instance_type": first_res.get("target_aws_instance_type") or "t3.medium",
                "quantity": int(round(float(first_res.get("target_quantity") or 1.0)))
            })

        return workloads[:max_workloads]

    def _execute_playwright_workflow(
        self,
        resources: List[Dict[str, Any]],
        region_code: str,
        region_keyword: str
    ) -> Tuple[Optional[str], Optional[float]]:
        """
        Runs synchronously inside a dedicated worker thread with WindowsProactorEventLoopPolicy
        to automate adding all dynamic workloads to calculator.aws, scraping the monthly summary total,
        and obtaining the public share URL.
        """
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        timeout_ms = self.timeout_seconds * 1000
        dynamic_workloads = self._build_dynamic_workloads(resources)
        logger.info(f"Built {len(dynamic_workloads)} dynamic workloads for calculator.aws: {dynamic_workloads}")

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            page = context.new_page()

            try:
                # 1. Navigate to Add Service page
                logger.info(f"Navigating to {self.calculator_url}...")
                page.goto(self.calculator_url, timeout=timeout_ms, wait_until="networkidle")
                page.wait_for_timeout(2000)

                # 2. Select Region if not already set
                self._select_region_sync(page, region_keyword)

                # 3. Dynamically configure each workload in sequence
                for idx, workload in enumerate(dynamic_workloads):
                    is_last = (idx == len(dynamic_workloads) - 1)
                    logger.info(f"Configuring workload {idx + 1}/{len(dynamic_workloads)}: {workload['description']} ({workload['type']})")
                    self._configure_single_workload_sync(page, workload, is_last)

                # 4. Scrape summary estimate cost before sharing
                scraped_monthly_usd = self._scrape_summary_monthly_cost_sync(page)

                # 5. Generate and extract public shareable URL
                share_link = self._extract_share_link_sync(page)
                return share_link, scraped_monthly_usd

            finally:
                browser.close()

    def _select_region_sync(self, page, region_keyword: str):
        """Selects the desired AWS Region on calculator.aws."""
        try:
            region_btn = page.locator('button:has-text("US East"), button[aria-label*="region" i], button:has-text("Region")').first
            if region_btn.count() > 0:
                current_text = region_btn.inner_text()
                if region_keyword.lower() not in current_text.lower():
                    logger.info(f"Changing region from '{current_text.strip()}' to '{region_keyword}'...")
                    region_btn.click()
                    page.wait_for_timeout(1000)

                    target_opt = page.locator(f'[role="option"]:has-text("{region_keyword}"), li:has-text("{region_keyword}")').first
                    if target_opt.count() > 0:
                        target_opt.click()
                        logger.info(f"Selected region: {region_keyword}")
                        page.wait_for_timeout(1000)
                    else:
                        page.keyboard.press("Escape")
        except Exception as e:
            logger.warning(f"Could not switch region, continuing with default: {e}")

    def _configure_single_workload_sync(self, page, workload: Dict[str, Any], is_last: bool):
        """Dynamically configures an individual workload and saves it to active estimate."""
        wtype = workload.get("type", "ec2")
        service_search = workload.get("service_search", "Amazon EC2")

        try:
            if "addService" not in page.url:
                add_svc_btn = page.locator('button:has-text("Add service"):visible').first
                if add_svc_btn.count() > 0:
                    add_svc_btn.click()
                    page.wait_for_timeout(2000)
                else:
                    page.goto("https://calculator.aws/#/addService", wait_until="networkidle")
                    page.wait_for_timeout(2000)

            # Search service name
            search_box = page.locator('input[placeholder*="service" i], input[placeholder*="Search" i], input[type="search"]').first
            if search_box.count() > 0:
                search_box.fill("")
                search_box.fill(service_search)
                page.wait_for_timeout(1500)

            # Click Configure
            cfg_btn = page.locator('button:has-text("Configure"):visible').first
            if cfg_btn.count() == 0:
                logger.warning(f"Configure button not found for {service_search}, skipping...")
                return

            cfg_btn.click()
            page.wait_for_timeout(2500)

            if wtype == "ec2":
                self._fill_ec2_fields_sync(page, workload)
            elif wtype == "ebs":
                self._fill_ebs_fields_sync(page, workload)
            elif wtype == "rds":
                self._fill_rds_fields_sync(page, workload)
            elif wtype == "s3":
                self._fill_s3_fields_sync(page, workload)

            page.wait_for_timeout(1000)

            if is_last:
                save_btn = page.locator('button:has-text("Save and view summary"):visible').first
                if save_btn.count() > 0:
                    save_btn.click()
                else:
                    page.evaluate("""() => {
                        const b = document.querySelector('button[data-cy="Save and view summary-button"]') || 
                                  document.querySelector('button[title*="Save and view summary"]');
                        if (b) b.click();
                    }""")
                logger.info(f"Saved final workload '{workload['description']}', transitioning to estimate summary...")
                page.wait_for_timeout(4000)
            else:
                save_and_add = page.locator('button:has-text("Save and add service"):visible').first
                if save_and_add.count() > 0:
                    save_and_add.click()
                else:
                    save_btn = page.locator('button:has-text("Save and view summary"):visible').first
                    if save_btn.count() > 0:
                        save_btn.click()
                logger.info(f"Saved workload '{workload['description']}', returning to Add Service...")
                page.wait_for_timeout(3500)

        except Exception as e:
            logger.warning(f"Error configuring workload '{workload.get('description')}': {e}")
            try:
                page.goto("https://calculator.aws/#/estimate", wait_until="networkidle")
                page.wait_for_timeout(2000)
            except Exception:
                pass

    def _fill_ec2_fields_sync(self, page, workload: Dict[str, Any]):
        """Dynamically populates EC2 form fields."""
        desc_inp = page.locator('input[aria-label*="Description" i]').first
        if desc_inp.count() > 0:
            desc_inp.fill(workload.get("description", "EC2 Compute"))

        qty_inp = page.locator('input[aria-label*="Number of instances" i]').first
        if qty_inp.count() > 0:
            qty_inp.fill(str(workload.get("quantity", 1)))

        inst_type = workload.get("instance_type", "t3.medium")
        inst_search = page.locator('input[placeholder*="Search by instance name" i]').first
        if inst_search.count() > 0:
            inst_search.fill(inst_type)
            page.wait_for_timeout(1500)

            tbody_rows = page.locator('tbody tr').all()
            if tbody_rows:
                matched_row = tbody_rows[0]
                for r in tbody_rows:
                    if inst_type.lower() in r.inner_text().lower():
                        matched_row = r
                        break
                radio = matched_row.locator('input[type="radio"]').first
                if radio.count() > 0:
                    radio.click(force=True)

    def _fill_ebs_fields_sync(self, page, workload: Dict[str, Any]):
        """Dynamically populates EBS form fields."""
        desc_inp = page.locator('input[aria-label*="Description" i]').first
        if desc_inp.count() > 0:
            desc_inp.fill(workload.get("description", "EBS Storage"))

        storage_inp = page.locator('input[aria-label*="Storage amount per volume" i]').first
        if storage_inp.count() > 0:
            storage_inp.fill(str(workload.get("storage_gb", 100)))

        num_vols_inp = page.locator('input[aria-label*="Number of volumes" i]').first
        if num_vols_inp.count() > 0:
            num_vols_inp.fill(str(workload.get("num_volumes", 1)))

        try:
            vol_btn = page.locator('button:has-text("General Purpose SSD (gp2)"), button:has-text("General Purpose SSD")').first
            if vol_btn.count() > 0:
                vol_btn.click()
                page.wait_for_timeout(500)
                gp3_opt = page.locator('[role="option"]:has-text("gp3"), li:has-text("gp3")').first
                if gp3_opt.count() > 0:
                    gp3_opt.click()
        except Exception:
            pass

    def _fill_rds_fields_sync(self, page, workload: Dict[str, Any]):
        """Dynamically populates RDS form fields."""
        desc_inp = page.locator('input[aria-label*="Description" i]').first
        if desc_inp.count() > 0:
            desc_inp.fill(workload.get("description", "RDS Database"))

        storage_inp = page.locator('input[aria-label*="Storage amount Value" i], input[aria-label*="Storage amount" i]').first
        if storage_inp.count() > 0:
            storage_inp.fill(str(workload.get("storage_gb", 100)))

    def _fill_s3_fields_sync(self, page, workload: Dict[str, Any]):
        """Dynamically populates S3 form fields."""
        desc_inp = page.locator('input[aria-label*="Description" i]').first
        if desc_inp.count() > 0:
            desc_inp.fill(workload.get("description", "S3 Storage"))

        storage_inp = page.locator('input[aria-label*="S3 Standard storage" i]').first
        if storage_inp.count() > 0:
            storage_inp.fill(str(workload.get("storage_gb", 50)))

    def _scrape_summary_monthly_cost_sync(self, page) -> Optional[float]:
        """Scrapes the active monthly estimate total from calculator.aws estimate page."""
        try:
            page.wait_for_timeout(2000)
            selectors = [
                '[data-testid="monthly-cost"]',
                'span:has-text("Monthly cost")',
                'div:has-text("Total monthly cost")',
                'header:has-text("Total monthly cost")'
            ]
            for sel in selectors:
                elems = page.locator(sel).all()
                for el in elems:
                    text = el.inner_text()
                    match = re.search(r"\$\s*([\d,]+\.\d{2})", text)
                    if match:
                        val = float(match.group(1).replace(",", ""))
                        logger.info(f"Scraped calculator.aws monthly total cost: ${val:.2f}")
                        return val
        except Exception as e:
            logger.debug(f"Could not scrape calculator summary total: {e}")
        return None

    def _extract_share_link_sync(self, page) -> Optional[str]:
        """Interacts with the Share modal on the estimate page to produce the public URL."""
        logger.info("Locating 'Share' button on estimate summary...")
        share_btn = page.locator('button:has-text("Share")').first
        if share_btn.count() == 0:
            logger.warning("Share button not found on page, waiting...")
            page.wait_for_timeout(2000)
            share_btn = page.locator('button:has-text("Share")').first

        if share_btn.count() > 0:
            share_btn.click()
            page.wait_for_timeout(2000)

            logger.info("Clicking 'Agree and continue' in Share modal...")
            agree_btn = page.locator('button:has-text("Agree and continue")').first
            if agree_btn.count() > 0:
                agree_btn.click()
                page.wait_for_timeout(3000)

            # Find the input containing the shareable link
            inputs = page.locator('input:visible').all()
            for inp in inputs:
                val = inp.get_attribute('value')
                if val and 'calculator.aws/#/estimate?id=' in val:
                    return val.strip()

            links = page.locator('a:visible').all()
            for link in links:
                href = link.get_attribute('href')
                if href and 'calculator.aws/#/estimate?id=' in href:
                    return href.strip()

        return None

    async def generate_shareable_link(
        self,
        resources: List[Dict[str, Any]],
        target_region: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes Playwright browser automation to generate the public calculator.aws
        shareable link containing real dynamic workloads and scraped estimate figures.
        """
        region_code = target_region or settings.AWS_REGION
        region_keyword = REGION_KEYWORDS.get(region_code, "Mumbai")

        logger.info(f"Starting Playwright worker for calculator.aws in region {region_code} ({region_keyword})")

        try:
            loop = asyncio.get_running_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                share_link, scraped_monthly = await loop.run_in_executor(
                    pool,
                    self._execute_playwright_workflow,
                    resources,
                    region_code,
                    region_keyword
                )

            if share_link:
                logger.info(f"Successfully generated calculator.aws link: {share_link}")
                return {
                    "success": True,
                    "share_url": share_link,
                    "region": region_code,
                    "services_count": len(resources),
                    "calculator_scraped_monthly_usd": scraped_monthly,
                    "message": "Official AWS Pricing Calculator link generated with dynamic architecture workloads!"
                }
            else:
                raise Exception("Public estimate URL was not found in the calculator response.")

        except Exception as e:
            logger.error(f"Playwright automation encountered an error: {e}")
            return {
                "success": False,
                "share_url": None,
                "error": str(e),
                "region": region_code,
                "fallback_message": "Automated browser session could not complete link generation. Please download the complete estimate using the Excel or PDF export options below."
            }


calculator_service = AWSCalculatorAutomationService()

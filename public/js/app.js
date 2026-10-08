let uploadedFile = null;
let parsedResources = [];
let billingPeriod = null;
let selectedProvider = "auto";
let detectedProvider = "Cloud";
let detectedCurrency = "USD";
let currencySymbol = "$";
let exchangeRateToUSD = 1.0;

let currentCalcData = null;
let currentCurrencyView = "usd"; // 'usd' | 'source' | 'dual'

// DOM Elements
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileStatus = document.getElementById("fileStatus");
const fileIcon = document.getElementById("fileIcon");
const detectedProviderBadge = document.getElementById("detectedProviderBadge");
const providerPills = document.querySelectorAll(".provider-pill");

const calculateBtn = document.getElementById("calculateBtn");
const resetBtn = document.getElementById("resetBtn");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loadingText");
const loadingSubtext = document.getElementById("loadingSubtext");
const results = document.getElementById("results");

// Currency Bar Elements
const currencyBar = document.getElementById("currencyBar");
const detectedCurrencyBadge = document.getElementById("detectedCurrencyBadge");
const exchangeRatePill = document.getElementById("exchangeRatePill");
const sourceCurrBtn = document.getElementById("sourceCurrBtn");
const currencyToggleBtns = document.querySelectorAll(".curr-btn");

// Banner Elements
const migrationBanner = document.getElementById("migrationBanner");
const bannerIcon = document.getElementById("bannerIcon");
const bannerTitle = document.getElementById("bannerTitle");
const bannerDesc = document.getElementById("bannerDesc");
const bannerSavingsValue = document.getElementById("bannerSavingsValue");
const bannerSavingsBadge = document.getElementById("bannerSavingsBadge");

// Metric Elements
const sourceProviderLabel = document.getElementById("sourceProviderLabel");
const sourceProviderSub = document.getElementById("sourceProviderSub");
const sourceCostValue = document.getElementById("sourceCostValue");
const awsCostValue = document.getElementById("awsCostValue");
const deltaCostValue = document.getElementById("deltaCostValue");
const deltaCostSub = document.getElementById("deltaCostSub");
const workloadCount = document.getElementById("workloadCount");
const billingPeriodValue = document.getElementById("billingPeriodValue");
const matchedCountPill = document.getElementById("matchedCountPill");
const resourcesList = document.getElementById("resourcesList");

console.log("🚀 Multi-Cloud to AWS Migration App Initialized with Multi-Currency Normalization");

// Provider Pill Click Handlers
providerPills.forEach((pill) => {
    pill.addEventListener("click", () => {
        providerPills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        selectedProvider = pill.getAttribute("data-provider");
        console.log("Selected cloud provider:", selectedProvider);

        if (uploadedFile) {
            uploadFile(uploadedFile);
        }
    });
});

// Currency View Toggle Handlers
currencyToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        currencyToggleBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentCurrencyView = btn.getAttribute("data-view");
        console.log("Switched currency view mode to:", currentCurrencyView);

        if (currentCalcData) {
            renderResults(currentCalcData);
        }
    });
});

// Drag and Drop Listeners
uploadArea.addEventListener("click", () => fileInput.click());

uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

function handleFile(file) {
    uploadedFile = file;
    fileName.textContent = file.name;

    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
        fileIcon.className = "fas fa-file-pdf text-danger";
    } else if (ext === "json") {
        fileIcon.className = "fas fa-file-code text-warning";
    } else if (ext === "csv") {
        fileIcon.className = "fas fa-file-csv text-success";
    } else {
        fileIcon.className = "fas fa-file-invoice";
    }

    fileInfo.classList.remove("hidden");
    uploadArea.style.display = "none";
    fileStatus.textContent = "⏳ Analyzing bill with Gemini AI...";
    calculateBtn.disabled = true;

    uploadFile(file);
}

function clearFile() {
    uploadedFile = null;
    parsedResources = [];
    billingPeriod = null;
    currentCalcData = null;
    fileInfo.classList.add("hidden");
    uploadArea.style.display = "block";
    calculateBtn.disabled = true;
    fileInput.value = "";
    results.classList.add("hidden");
    currencyBar.classList.add("hidden");
    fileStatus.textContent = "";
    detectedProviderBadge.classList.add("hidden");
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("cloudProvider", selectedProvider);

    try {
        const response = await fetch("/api/upload-bill", {
            method: "POST",
            body: formData,
        });

        const data = await response.json();

        if (data.success) {
            parsedResources = data.resources || [];
            billingPeriod = data.billingPeriod;
            detectedProvider = data.detectedProvider || data.cloudProvider || "Cloud";
            detectedCurrency = data.detectedCurrency || "USD";
            currencySymbol = data.currencySymbol || "$";
            exchangeRateToUSD = Number(data.exchangeRateToUSD || 1.0);

            const isMultiCurrency = detectedCurrency !== "USD";
            const currencyTag = isMultiCurrency ? ` [${detectedCurrency} ${currencySymbol}]` : "";

            fileStatus.textContent = `✅ ${parsedResources.length} workload(s) extracted from ${detectedProvider}${currencyTag}`;
            detectedProviderBadge.textContent = `${detectedProvider}${currencyTag}`;
            detectedProviderBadge.className = `detected-badge tag-${detectedProvider.toLowerCase()}`;
            detectedProviderBadge.classList.remove("hidden");

            calculateBtn.disabled = false;
        } else {
            fileStatus.textContent = "❌ Error: " + data.error;
            alert("Error parsing file: " + data.error);
        }
    } catch (error) {
        console.error("Upload error:", error);
        fileStatus.textContent = "❌ Upload failed: " + error.message;
        alert("Upload failed: " + error.message);
    }
}

// Calculate Migration Costs
calculateBtn.addEventListener("click", async () => {
    if (!parsedResources || parsedResources.length === 0) {
        alert("No resources available to calculate.");
        return;
    }

    loading.classList.remove("hidden");
    results.classList.add("hidden");
    currencyBar.classList.add("hidden");
    loadingText.textContent = "Calculating Live AWS Migration Pricing...";
    loadingSubtext.textContent = "Querying live AWS Price List API & intelligent catalog fallbacks...";

    try {
        const response = await fetch("/api/calculate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                resources: parsedResources,
                billingPeriod: billingPeriod || { days: 31 },
                detectedCurrency,
                currencySymbol,
                exchangeRateToUSD,
            }),
        });

        const data = await response.json();

        if (data.success) {
            currentCalcData = data;
            displayResults(data);
        } else {
            alert("Calculation error: " + data.error);
        }
    } catch (error) {
        console.error("Calculation error:", error);
        alert("Error calculating costs: " + error.message);
    } finally {
        loading.classList.add("hidden");
    }
});

function displayResults(data) {
    results.classList.remove("hidden");
    renderResults(data);
    results.scrollIntoView({ behavior: "smooth" });
}

function renderResults(data) {
    const isMultiCurr = data.isMultiCurrency || (data.detectedCurrency && data.detectedCurrency !== "USD");
    const sym = data.currencySymbol || "₹";
    const currCode = data.detectedCurrency || "INR";
    const rate = Number(data.exchangeRateToUSD || 1.0);
    const currPerUsd = Number(data.sourceCurrencyPerUSD || (1 / rate));

    // Update Currency Bar
    if (isMultiCurr) {
        currencyBar.classList.remove("hidden");
        detectedCurrencyBadge.textContent = `${currCode} (${sym})`;
        exchangeRatePill.textContent = `Exchange Rate: 1 USD = ${sym}${currPerUsd.toFixed(2)} ${currCode} (1 ${currCode} = $${rate.toFixed(6)})`;
        if (sourceCurrBtn) {
            sourceCurrBtn.textContent = `${currCode} (${sym})`;
        }
    } else {
        currencyBar.classList.add("hidden");
    }

    const provider = data.sourceProvider || detectedProvider || "Current Cloud";
    const isAwsNative = provider.toUpperCase() === "AWS";

    // Totals in USD
    const totalSourceUSD = Number(data.totalSourceCostUSD ?? data.totalSourceCost ?? 0);
    const totalAwsUSD = Number(data.totalAwsCostUSD ?? data.totalAwsCost ?? 0);
    const monthlySavingsUSD = Number(data.monthlySavingsUSD ?? data.monthlySavings ?? 0);
    const percentageSavings = Number(data.percentageSavings || 0);

    // Totals in Source Currency
    const totalSourceOrig = Number(data.totalSourceCostOriginal ?? totalSourceUSD);
    const totalAwsInSource = Number(data.totalAwsCostInSourceCurrency ?? totalAwsUSD);
    const monthlySavingsInSource = Number(data.monthlySavingsSourceCurrency ?? (totalSourceOrig - totalAwsInSource));

    // 1. Update Migration Highlights Banner
    if (isAwsNative) {
        migrationBanner.className = "migration-banner";
        bannerIcon.innerHTML = `<i class="fab fa-aws"></i>`;
        bannerTitle.textContent = `AWS Invoice Analysis ($${totalAwsUSD.toFixed(2)} / month)`;
        bannerDesc.textContent = `All ${data.resources?.length || 0} AWS services verified with real-time AWS Price List API rates.`;
        bannerSavingsValue.textContent = `$${totalAwsUSD.toFixed(2)}`;
        bannerSavingsBadge.textContent = `Live AWS Pricing`;
    } else if (monthlySavingsUSD > 0) {
        migrationBanner.className = "migration-banner";
        bannerIcon.innerHTML = `<i class="fas fa-piggy-bank"></i>`;

        if (currentCurrencyView === "source" && isMultiCurr) {
            bannerTitle.textContent = `Save ${sym}${monthlySavingsInSource.toFixed(2)} ${currCode}/mo by migrating to AWS`;
            bannerSavingsValue.textContent = `${sym}${monthlySavingsInSource.toFixed(2)}`;
        } else if (currentCurrencyView === "dual" && isMultiCurr) {
            bannerTitle.textContent = `Save $${monthlySavingsUSD.toFixed(2)} USD (${sym}${monthlySavingsInSource.toFixed(2)} ${currCode})/mo on AWS`;
            bannerSavingsValue.textContent = `$${monthlySavingsUSD.toFixed(2)}`;
        } else {
            bannerTitle.textContent = `Save $${monthlySavingsUSD.toFixed(2)} USD/mo by migrating to AWS`;
            bannerSavingsValue.textContent = `$${monthlySavingsUSD.toFixed(2)}`;
        }

        bannerDesc.textContent = `Migrating your ${provider} workloads to AWS reduces your monthly infrastructure spend by ${percentageSavings}%.`;
        bannerSavingsBadge.textContent = `${percentageSavings}% Savings`;
    } else if (monthlySavingsUSD < 0) {
        migrationBanner.className = "migration-banner banner-increase";
        bannerIcon.innerHTML = `<i class="fas fa-scale-balanced"></i>`;
        const absUsd = Math.abs(monthlySavingsUSD);
        const absSrc = Math.abs(monthlySavingsInSource);

        if (currentCurrencyView === "source" && isMultiCurr) {
            bannerTitle.textContent = `AWS Cost Equivalent: ${sym}${totalAwsInSource.toFixed(2)} ${currCode}/mo`;
            bannerSavingsValue.textContent = `+${sym}${absSrc.toFixed(2)}`;
        } else {
            bannerTitle.textContent = `AWS Cost Equivalent: $${totalAwsUSD.toFixed(2)} USD/mo`;
            bannerSavingsValue.textContent = `+$${absUsd.toFixed(2)}`;
        }

        bannerDesc.textContent = `High-availability AWS equivalent configuration costs $${absUsd.toFixed(2)} more compared to your baseline.`;
        bannerSavingsBadge.textContent = `+${Math.abs(percentageSavings)}% Delta`;
    } else {
        migrationBanner.className = "migration-banner";
        bannerIcon.innerHTML = `<i class="fas fa-handshake"></i>`;
        bannerTitle.textContent = `Workload Costs are Parity on AWS ($${totalAwsUSD.toFixed(2)}/mo)`;
        bannerDesc.textContent = `Running these workloads on AWS is equivalent in monthly operating costs.`;
        bannerSavingsValue.textContent = `$0.00`;
        bannerSavingsBadge.textContent = `Cost Parity`;
    }

    // 2. Update Metric Cards
    sourceProviderLabel.textContent = isAwsNative ? "Invoice Billed Total" : `${provider} Bill Total`;

    if (currentCurrencyView === "source" && isMultiCurr) {
        sourceCostValue.textContent = `${sym}${totalSourceOrig.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        awsCostValue.textContent = `${sym}${totalAwsInSource.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        sourceProviderSub.textContent = `Source bill in ${currCode} ($${totalSourceUSD.toFixed(2)} USD equivalent)`;
        deltaCostValue.textContent = `${monthlySavingsUSD >= 0 ? "-" : "+"}${sym}${Math.abs(monthlySavingsInSource).toFixed(2)}`;
        deltaCostSub.textContent = monthlySavingsUSD >= 0 ? `Monthly savings in ${currCode}` : `Additional spend in ${currCode}`;
    } else if (currentCurrencyView === "dual" && isMultiCurr) {
        sourceCostValue.innerHTML = `${sym}${totalSourceOrig.toFixed(2)} <span class="price-subtext">($${totalSourceUSD.toFixed(2)} USD)</span>`;
        awsCostValue.innerHTML = `$${totalAwsUSD.toFixed(2)} <span class="price-subtext">(${sym}${totalAwsInSource.toFixed(2)} ${currCode})</span>`;
        sourceProviderSub.textContent = `Billed ${currCode} with live USD normalization`;
        deltaCostValue.innerHTML = `${monthlySavingsUSD >= 0 ? "-" : "+"}$${Math.abs(monthlySavingsUSD).toFixed(2)} <span class="price-subtext">(${sym}${Math.abs(monthlySavingsInSource).toFixed(2)})</span>`;
        deltaCostSub.textContent = monthlySavingsUSD >= 0 ? "Monthly savings on AWS" : "Additional spend on AWS";
    } else { // default: "usd"
        sourceCostValue.innerHTML = `$${totalSourceUSD.toFixed(2)} ${isMultiCurr ? `<span class="price-subtext">(${sym}${totalSourceOrig.toFixed(2)} ${currCode})</span>` : ""}`;
        awsCostValue.innerHTML = `$${totalAwsUSD.toFixed(2)} ${isMultiCurr ? `<span class="price-subtext">(${sym}${totalAwsInSource.toFixed(2)} ${currCode})</span>` : ""}`;
        sourceProviderSub.textContent = isMultiCurr ? `Converted from ${sym}${totalSourceOrig.toFixed(2)} ${currCode}` : "Actual billed amount";
        deltaCostValue.textContent = `${monthlySavingsUSD >= 0 ? "-" : "+"}$${Math.abs(monthlySavingsUSD).toFixed(2)}`;
        deltaCostSub.textContent = monthlySavingsUSD >= 0 ? "Monthly savings on AWS" : "Additional monthly spend";
    }

    workloadCount.textContent = data.resources?.length || 0;
    billingPeriodValue.textContent = `${data.billingPeriodDays || 31}-Day Billing Cycle`;
    matchedCountPill.textContent = `${data.resources?.length || 0} Workloads Calculated`;

    // 3. Render Workload Cards
    resourcesList.innerHTML = "";

    if (data.resources && data.resources.length > 0) {
        data.resources.forEach((r, idx) => {
            const card = document.createElement("div");
            card.className = "workload-card";

            const srcProvider = r.sourceProvider || provider || "Cloud";
            const srcCostOrig = Number(r.sourceCostOriginal ?? r.sourceCost ?? 0);
            const srcCostUSD = Number(r.sourceCostUSD ?? r.sourceCost ?? 0);
            const rCurrency = r.sourceCurrency || currCode;
            const rSymbol = r.sourceCurrencySymbol || sym;
            const rIsMulti = rCurrency !== "USD";

            const awsCostUSD = Number(r.awsCostUSD ?? r.monthlyEstimatedCost ?? r.totalEstimatedCost ?? 0);
            const awsCostInSrc = Number(r.awsCostInSourceCurrency ?? (rIsMulti ? awsCostUSD / rate : awsCostUSD));

            const savingsUSD = Number(r.savingsUSD ?? (srcCostUSD - awsCostUSD));
            const savingsInSrc = Number(r.savingsSourceCurrency ?? (srcCostOrig - awsCostInSrc));
            const pctSavings = Number(r.percentSavings || 0);

            // Spec chips
            const chips = [];
            if (r.sourceSpecs?.vcpu || r.vcpu) chips.push(`${r.sourceSpecs?.vcpu || r.vcpu} vCPU`);
            if (r.sourceSpecs?.ramGb || r.ramGb) chips.push(`${r.sourceSpecs?.ramGb || r.ramGb} GB RAM`);
            if (r.sourceSpecs?.os) chips.push(r.sourceSpecs.os);
            if (r.sourceSpecs?.storageGb) chips.push(`${r.sourceSpecs.storageGb} GB`);
            if (r.sourceSpecs?.engine) chips.push(r.sourceSpecs.engine);
            if (r.usageAmount) chips.push(`${r.usageAmount} ${r.usageUnit || "hrs"}`);
            if (r.sourceRegion) chips.push(r.sourceRegion);

            // Left: Source Workload Price Display
            let srcPriceHtml = "";
            if (srcCostOrig > 0) {
                if (rIsMulti) {
                    if (currentCurrencyView === "source") {
                        srcPriceHtml = `<span class="workload-price">${rSymbol}${srcCostOrig.toFixed(2)}</span>
                                        <div class="price-subtext">$${srcCostUSD.toFixed(2)} USD</div>`;
                    } else if (currentCurrencyView === "dual") {
                        srcPriceHtml = `<span class="workload-price">${rSymbol}${srcCostOrig.toFixed(2)}</span>
                                        <div class="price-subtext">($${srcCostUSD.toFixed(2)} USD)</div>`;
                    } else {
                        srcPriceHtml = `<span class="workload-price">$${srcCostUSD.toFixed(2)}</span>
                                        <div class="price-subtext">Billed: ${rSymbol}${srcCostOrig.toFixed(2)} ${rCurrency}</div>`;
                    }
                } else {
                    srcPriceHtml = `<span class="workload-price">$${srcCostUSD.toFixed(2)}</span>`;
                }
            } else {
                srcPriceHtml = `<span class="workload-price">Metered</span>`;
            }

            // Right: AWS Target Price Display
            let awsPriceHtml = "";
            if (currentCurrencyView === "source" && rIsMulti) {
                awsPriceHtml = `<span class="workload-price" style="color:#d97706;">${rSymbol}${awsCostInSrc.toFixed(2)}</span>
                                <div class="price-subtext">$${awsCostUSD.toFixed(2)} USD</div>`;
            } else if (currentCurrencyView === "dual" && rIsMulti) {
                awsPriceHtml = `<span class="workload-price" style="color:#d97706;">$${awsCostUSD.toFixed(2)}</span>
                                <div class="price-subtext">(${rSymbol}${awsCostInSrc.toFixed(2)} ${rCurrency})</div>`;
            } else {
                awsPriceHtml = `<span class="workload-price" style="color:#d97706;">$${awsCostUSD.toFixed(2)}</span>
                                ${rIsMulti ? `<div class="price-subtext">~${rSymbol}${awsCostInSrc.toFixed(2)} ${rCurrency}</div>` : ""}`;
            }

            // Delta tag
            let deltaTagHtml = "";
            if (srcCostUSD > 0) {
                if (savingsUSD > 0) {
                    const saveText = (currentCurrencyView === "source" && rIsMulti)
                        ? `Save ${rSymbol}${savingsInSrc.toFixed(2)} (${pctSavings}%)`
                        : (currentCurrencyView === "dual" && rIsMulti)
                            ? `Save $${savingsUSD.toFixed(2)} (${rSymbol}${savingsInSrc.toFixed(2)} • ${pctSavings}%)`
                            : `Save $${savingsUSD.toFixed(2)} (${pctSavings}%)`;

                    deltaTagHtml = `<div class="delta-tag delta-save"><i class="fas fa-arrow-down"></i> ${saveText}</div>`;
                } else if (savingsUSD < 0) {
                    const diffText = (currentCurrencyView === "source" && rIsMulti)
                        ? `+${rSymbol}${Math.abs(savingsInSrc).toFixed(2)}`
                        : `+$${Math.abs(savingsUSD).toFixed(2)}`;

                    deltaTagHtml = `<div class="delta-tag delta-more"><i class="fas fa-arrow-up"></i> ${diffText}</div>`;
                } else {
                    deltaTagHtml = `<div class="delta-tag delta-same"><i class="fas fa-equals"></i> Cost Parity</div>`;
                }
            }

            // Multi-machine breakdown
            let machineHtml = "";
            if (r.machines && r.machines.length > 1) {
                machineHtml = `
                    <div class="machine-breakdown-box">
                        <div class="machine-breakdown-title">
                            <i class="fas fa-server"></i> Multi-Instance Breakdown (${r.numberOfMachines} instances split over ${r.maxHoursPerMachine}h/mo):
                        </div>
                        ${r.machines.map((m) => `
                            <div class="machine-row">
                                <span>Instance #${m.machine}</span>
                                <span>${m.hours.toFixed(1)} hrs @ $${m.hourlyPrice.toFixed(4)}/hr = <strong>$${m.cost.toFixed(2)}</strong></span>
                            </div>
                        `).join("")}
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="workload-columns">
                    <!-- Left: Source Workload -->
                    <div class="source-side">
                        <div class="side-header">
                            <span class="provider-tag tag-${srcProvider.toLowerCase()}">${srcProvider}</span>
                            <div>${srcPriceHtml}</div>
                        </div>
                        <div class="workload-name">${r.sourceServiceName || r.serviceName || "Source Workload"}</div>
                        <div style="font-size:0.85rem;color:#64748b;font-weight:600;">${r.sourceSku || r.instanceType || "Default SKU"}</div>
                        <div class="spec-chips">
                            ${chips.map((c) => `<span class="chip">${c}</span>`).join("")}
                        </div>
                    </div>

                    <!-- Center: Transition Column -->
                    <div class="mapping-arrow-col">
                        <div class="arrow-icon-circle">
                            <i class="fas fa-arrow-right"></i>
                        </div>
                        <div class="rationale-tag">
                            ${r.migrationRationale || "Mapped to equivalent AWS SKU"}
                        </div>
                    </div>

                    <!-- Right: AWS Equivalent -->
                    <div class="target-side">
                        <div class="side-header">
                            <span class="provider-tag tag-aws"><i class="fab fa-aws"></i> AWS Target</span>
                            <div>${awsPriceHtml}</div>
                        </div>
                        <div class="workload-name">Amazon ${r.targetAwsService || r.service}</div>
                        <div style="font-size:0.85rem;color:#475569;font-weight:700;">
                            ${r.targetAwsInstanceType || r.targetAwsVolumeType || r.instanceType || r.pricing?.sku || "On-Demand SKU"}
                            <span style="font-weight:400;color:#94a3b8;font-size:0.75rem;">(${r.targetAwsRegion || r.region || "us-east-1"})</span>
                        </div>
                        <div style="font-size:0.8rem;color:#64748b;margin-top:6px;">
                            Rate: $${(r.pricing?.hourlyPrice || r.pricing?.unitPrice || 0).toFixed(6)} / ${r.pricing?.unit || "hr"}
                            <span style="font-size:0.7rem;color:#94a3b8;">(${r.pricing?.source || "Catalog Rate"})</span>
                        </div>
                        ${deltaTagHtml}
                    </div>
                </div>
                ${machineHtml}
            `;

            resourcesList.appendChild(card);
        });
    }
}

resetBtn.addEventListener("click", () => {
    clearFile();
    window.scrollTo({ top: 0, behavior: "smooth" });
});

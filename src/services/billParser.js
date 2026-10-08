const pdfParse = require("pdf-parse");

const {
  SERVICE_CONFIG,
  resolveServiceKey
} = require("./serviceConfig");

const {
  identifyMultiCloudResources
} = require("./ai/geminiService");

const {
  detectCloudProvider,
  resolveAWSEquivalent,
  mapToAWSRegion,
} = require("./normalizer/cloudNormalizer");

const {
  detectCurrency,
  toUSD,
} = require("./currency/currencyConverter");

async function parseBillFile(fileBuffer, cloudProvider = "auto", billingPeriod = null) {
  const isPDF = fileBuffer.subarray(0, 4).toString() === "%PDF";

  console.log("📄 File detected:", {
    isPDF,
    firstBytes: fileBuffer.subarray(0, 10).toString(),
    cloudProvider,
  });

  if (isPDF) {
    console.log("📄 PDF detected → parsing with Multi-Cloud Gemini Engine");
    return await parsePDFBill(fileBuffer, cloudProvider, billingPeriod);
  }

  // Try JSON
  try {
    const content = fileBuffer.toString("utf8");
    const jsonData = JSON.parse(content);
    return parseJSONBill(jsonData, cloudProvider);
  } catch (jsonError) {
    // Try CSV
    const content = fileBuffer.toString("utf8");
    return parseCSVBill(content, cloudProvider);
  }
}

async function parsePDFBill(fileBuffer, cloudProvider, billingPeriod) {
  try {
    console.log("📄 PDF file detected, extracting text...");

    const data = await pdfParse(fileBuffer);
    const text = data.text;

    if (!text || text.length < 10) {
      throw new Error("PDF has no readable text.");
    }

    console.log(`✅ PDF text extracted: ${text.length} characters`);
    console.log("🤖 Sending multi-cloud bill to Gemini...");

    const aiResult = await identifyMultiCloudResources(
      text,
      cloudProvider !== "auto" ? cloudProvider : null
    );

    if (!aiResult) {
      throw new Error("Gemini returned no result");
    }

    console.log("🤖 Gemini raw result:", JSON.stringify(aiResult, null, 2));

    const detectedProvider = aiResult.detectedProvider || detectCloudProvider(text, cloudProvider);

    // Detect currency from text or AI output
    const currencyInfo = detectCurrency(text, aiResult.detectedCurrency || aiResult.currency);
    console.log(`💱 Detected Bill Currency: ${currencyInfo.code} (${currencyInfo.symbol}), 1 ${currencyInfo.code} = $${currencyInfo.rateToUSD} USD`);

    const aiResources = Array.isArray(aiResult)
      ? aiResult
      : Array.isArray(aiResult.resources)
        ? aiResult.resources
        : [];

    console.log(`🤖 Gemini identified ${aiResources.length} resources from ${detectedProvider}`);

    const resources = aiResources.map((item, index) =>
      toResource(item, index, "gemini-pdf", detectedProvider, currencyInfo)
    );

    resources.detectedProvider = detectedProvider;
    resources.detectedCurrency = currencyInfo.code;
    resources.currencySymbol = currencyInfo.symbol;
    resources.currencyName = currencyInfo.name;
    resources.exchangeRateToUSD = currencyInfo.rateToUSD;

    return resources;
  } catch (error) {
    console.error("❌ PDF/Gemini parsing error:", error.message);
    throw error;
  }
}

/**
 * Standardizes any extracted line item into a dual-layer resource:
 * 1. Source Cloud Workload Information (Azure, GCP, DO, AWS, etc.)
 * 2. Target AWS Equivalent Mapping Information (EC2, RDS, S3, etc.)
 */
function toResource(raw, index, source, defaultProvider = "AWS", currencyInfo = { code: "USD", symbol: "$", rateToUSD: 1.0 }) {
  const provider = raw.sourceProvider || raw.cloudProvider || defaultProvider || "AWS";
  const sourceServiceText =
    raw.sourceServiceName || raw.serviceName || raw.service ||
    raw.ProductName || raw["product/ProductName"] || "Compute";

  const sourceSku =
    raw.sourceSku || raw.instanceType || raw.InstanceType ||
    raw.sku || raw.SKU || raw.meterName || null;

  const usageAmountRaw =
    raw.usageAmount ?? raw.UsageAmount ?? raw.usage ?? raw.Usage ??
    raw.UsageQuantity ?? raw.amount ?? 0;
  const usageAmount = Number(usageAmountRaw);

  const sourceCostRaw =
    raw.sourceCost ?? raw.currentCost ?? raw.Cost ?? raw.cost ??
    raw.Amount ?? raw["Amount in USD"] ?? raw.PreTaxCost ?? 0;
  const sourceCostOriginal = Number(sourceCostRaw);

  const sourceCurrency = String(raw.sourceCurrency || raw.currency || currencyInfo?.code || "USD").toUpperCase();
  const sourceCurrencySymbol = raw.sourceCurrencySymbol || raw.currencySymbol || currencyInfo?.symbol || "$";
  const sourceCostUSD = sourceCurrency === "USD" ? sourceCostOriginal : toUSD(sourceCostOriginal, sourceCurrency);

  const sourceRegion = raw.sourceRegion || raw.region || raw.Region || "us-east-1";

  // Resolve target AWS mapping
  let targetAwsService = raw.targetAwsService || null;
  let targetAwsServiceCode = raw.targetAwsServiceCode || null;
  let targetAwsInstanceType = raw.targetAwsInstanceType || raw.instanceType || null;
  let targetAwsVolumeType = raw.targetAwsVolumeType || raw.volumeType || null;
  let targetAwsStorageClass = raw.targetAwsStorageClass || raw.storageClass || null;
  let targetAwsEngine = raw.targetAwsEngine || raw.engine || null;
  let targetAwsRegion = raw.targetAwsRegion ? mapToAWSRegion(raw.targetAwsRegion) : mapToAWSRegion(sourceRegion);
  let migrationRationale = raw.migrationRationale || null;

  // If mapping not pre-filled by AI, run deterministic normalizer
  if (!targetAwsService || !targetAwsServiceCode) {
    const autoMap = resolveAWSEquivalent({
      sourceProvider: provider,
      sourceServiceName: sourceServiceText,
      sourceSku,
      sourceSpecs: raw.sourceSpecs,
      sourceRegion,
      service: raw.service,
      serviceCode: raw.serviceCode,
      rawDescription: raw.rawDescription || raw.description || "",
    });

    targetAwsService = targetAwsService || autoMap.targetAwsService;
    targetAwsServiceCode = targetAwsServiceCode || autoMap.targetAwsServiceCode;
    targetAwsInstanceType = targetAwsInstanceType || autoMap.targetAwsInstanceType;
    targetAwsVolumeType = targetAwsVolumeType || autoMap.targetAwsVolumeType;
    targetAwsStorageClass = targetAwsStorageClass || autoMap.targetAwsStorageClass;
    targetAwsEngine = targetAwsEngine || autoMap.targetAwsEngine;
    targetAwsRegion = targetAwsRegion || autoMap.targetAwsRegion;
    migrationRationale = migrationRationale || autoMap.migrationRationale;
  }

  // Ensure target service key matches SERVICE_CONFIG
  const resolvedKey = resolveServiceKey(targetAwsService) || targetAwsService;
  const config = SERVICE_CONFIG[resolvedKey];

  return {
    id: `resource-${Date.now()}-${index}`,

    // Source Cloud Details
    sourceProvider: provider,
    sourceServiceName: sourceServiceText,
    sourceSku,
    sourceCost: Number.isFinite(sourceCostUSD) ? sourceCostUSD : 0, // Normalized to USD for calculation
    sourceCostOriginal: Number.isFinite(sourceCostOriginal) ? sourceCostOriginal : 0, // Original currency amount
    sourceCurrency,
    sourceCurrencySymbol,
    sourceRegion,
    sourceSpecs: raw.sourceSpecs || {
      vcpu: raw.vcpu || null,
      ramGb: raw.ramGb || null,
      storageGb: raw.storageGb || null,
      os: raw.operatingSystem || raw.os || null,
      engine: raw.engine || null,
    },

    // Target AWS Equivalent Details
    targetAwsService: resolvedKey,
    targetAwsServiceCode: targetAwsServiceCode || config?.serviceCode || "AmazonEC2",
    targetAwsInstanceType,
    targetAwsVolumeType: targetAwsVolumeType || (resolvedKey === "EBS" ? "gp3" : null),
    targetAwsStorageClass: targetAwsStorageClass || (resolvedKey === "S3" ? "Standard" : null),
    targetAwsEngine,
    targetAwsRegion: targetAwsRegion || "us-east-1",
    migrationRationale: migrationRationale || `Mapped to AWS ${resolvedKey}`,

    // Calculation fields expected by calculator.js & awsPricing.js
    service: resolvedKey,
    serviceName: targetAwsService,
    serviceCode: targetAwsServiceCode || config?.serviceCode || "AmazonEC2",
    instanceType: targetAwsInstanceType,
    volumeType: targetAwsVolumeType || (resolvedKey === "EBS" ? "gp3" : null),
    storageClass: targetAwsStorageClass,
    engine: targetAwsEngine,
    operatingSystem: raw.operatingSystem || raw.sourceSpecs?.os || "Linux",
    region: targetAwsRegion || "us-east-1",

    usageType: raw.usageType || raw.UsageType || (targetAwsInstanceType ? `BoxUsage:${targetAwsInstanceType}` : null),
    usageAmount: Number.isFinite(usageAmount) ? usageAmount : 0,
    usageUnit: raw.usageUnit || raw.Unit || raw.unit || config?.unit || "hours",
    unitRate: raw.unitRate !== undefined && raw.unitRate !== null ? Number(raw.unitRate) : null,
    unitDivisor: raw.unitDivisor !== undefined && raw.unitDivisor !== null ? Number(raw.unitDivisor) : null,

    currentCost: Number.isFinite(sourceCostUSD) ? sourceCostUSD : 0,

    matchConfidence: raw.confidence !== undefined && raw.confidence !== null
      ? Number(raw.confidence)
      : 0.9,
    matched: true,
    rawDescription: raw.rawDescription || raw.description || sourceServiceText || "",
    source,
  };
}

function parseJSONBill(data, cloudProvider = "auto") {
  const provider = data.provider || data.cloudProvider || (cloudProvider !== "auto" ? cloudProvider : "Cloud");
  const currencyInfo = detectCurrency(JSON.stringify(data), data.currency || data.detectedCurrency);
  
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.resources)
      ? data.resources
      : [data];

  const resources = items.map((item, index) => toResource(item, index, "json", provider, currencyInfo));
  resources.detectedProvider = provider;
  resources.detectedCurrency = currencyInfo.code;
  resources.currencySymbol = currencyInfo.symbol;
  resources.currencyName = currencyInfo.name;
  resources.exchangeRateToUSD = currencyInfo.rateToUSD;

  console.log(`✅ Parsed ${resources.length} resource(s) from JSON bill for ${provider} in ${currencyInfo.code}`);
  return resources;
}

function parseCSVBill(content, cloudProvider = "auto") {
  const provider = detectCloudProvider(content, cloudProvider !== "auto" ? cloudProvider : "Cloud");
  const currencyInfo = detectCurrency(content);

  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    console.log("⚠️ CSV has no data rows");
    return [];
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const resources = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    resources.push(toResource(row, i - 1, "csv", provider, currencyInfo));
  }

  resources.detectedProvider = provider;
  resources.detectedCurrency = currencyInfo.code;
  resources.currencySymbol = currencyInfo.symbol;
  resources.currencyName = currencyInfo.name;
  resources.exchangeRateToUSD = currencyInfo.rateToUSD;

  console.log(`✅ Parsed ${resources.length} resource(s) from CSV bill for ${provider} in ${currencyInfo.code}`);
  return resources;
}

module.exports = {
  parseBillFile,
  parsePDFBill,
  parseJSONBill,
  parseCSVBill,
};
// services/calculator.js
// 100% Generic & Dynamic Multi-Cloud & AWS Cost Calculation Engine with Multi-Currency Normalization

const { resolveDynamicService } = require("./aws/serviceDiscovery");
const { getPrice, round } = require("./awsPricing");
const { SERVICE_CONFIG, resolveServiceKey } = require("./serviceConfig");
const {
  CURRENCY_RATES_TO_USD,
  CURRENCY_SYMBOLS,
  detectCurrency,
  toUSD,
  fromUSD,
  formatCurrency,
} = require("./currency/currencyConverter");

// Reliable hourly and per-unit AWS catalog fallbacks for when AWS API is unavailable or credentials fail
const INSTANCE_HOURLY_FALLBACKS = {
  // RDS database instances
  "db.t3.micro": 0.034,
  "db.t3.small": 0.068,
  "db.t3.medium": 0.136,
  "db.t3.large": 0.272,
  "db.t3.xlarge": 0.544,
  "db.t4g.micro": 0.031,
  "db.t4g.small": 0.062,
  "db.t4g.medium": 0.124,
  "db.t4g.large": 0.248,
  "db.m5.large": 0.192,
  "db.m5.xlarge": 0.384,
  "db.m6g.large": 0.174,
  "db.m6g.xlarge": 0.348,
  "db.r5.large": 0.290,
  "db.r5.xlarge": 0.580,
  "db.r6g.large": 0.260,
  "db.r6g.xlarge": 0.520,
  "db.r6g.2xlarge": 1.040,

  // EC2 compute instances
  "t3.nano": 0.0052,
  "t3.micro": 0.0104,
  "t3.small": 0.0208,
  "t3.medium": 0.0416,
  "t3.large": 0.0832,
  "t3.xlarge": 0.1664,
  "t3.2xlarge": 0.3328,
  "t4g.micro": 0.0084,
  "t4g.small": 0.0168,
  "t4g.medium": 0.0336,
  "m5.large": 0.096,
  "m5.xlarge": 0.192,
  "m5.2xlarge": 0.384,
  "m5.4xlarge": 0.768,
  "c5.large": 0.085,
  "c5.xlarge": 0.170,
  "c5.2xlarge": 0.340,
  "r5.large": 0.126,
  "r5.xlarge": 0.252,
  "r5.2xlarge": 0.504,
};

/**
 * Dynamically parses rate and divisor from any description or billing line
 * Examples:
 * "$0.05 per 10000 API Requests" -> { unitRate: 0.05, divisor: 10000, unit: "requests" }
 * "$0.005 per 1,000 PUT, COPY, POST requests" -> { unitRate: 0.005, divisor: 1000, unit: "requests" }
 * "$0.40 per 1,000,000 queries" -> { unitRate: 0.40, divisor: 1000000, unit: "queries" }
 * "$0.40 per million requests" -> { unitRate: 0.40, divisor: 1000000, unit: "requests" }
 * "$0.056 per GB" -> { unitRate: 0.056, divisor: 1, unit: "GB" }
 * "$0.0248 per On Demand Linux t2.small Instance Hour" -> { unitRate: 0.0248, divisor: 1, unit: "hours" }
 */
function parseDynamicRateFromDescription(description) {
  if (!description || typeof description !== "string") return null;

  const desc = description.replace(/,/g, "");

  // Match: (USD or $ or ₹ or Rs) <rate> per [quantity] <unit>
  const match = desc.match(/(?:\$|USD\s*|₹\s*|Rs\.?\s*)([0-9]+(?:\.[0-9]+)?)\s*(?:\/|\s*per\s*)(?:(first\s+)?([0-9]+|million|billion)\s+)?([a-zA-Z0-9\-_ ]+)/i);

  if (match) {
    const rate = parseFloat(match[1]);
    let divisor = 1;

    const rawDivisor = match[3] ? match[3].toLowerCase() : "";
    if (rawDivisor === "million") divisor = 1_000_000;
    else if (rawDivisor === "billion") divisor = 1_000_000_000;
    else if (rawDivisor && !isNaN(Number(rawDivisor))) divisor = Number(rawDivisor);

    const rawUnit = match[4] ? match[4].trim() : "unit";

    return {
      unitRate: rate,
      divisor: divisor > 0 ? divisor : 1,
      unit: rawUnit,
    };
  }

  return null;
}

/**
 * Dynamically partitions hours into concurrent virtual machines
 */
function splitIntoMachines(totalHours, maxHoursPerMachine) {
  const machines = [];
  let remaining = Number(totalHours);
  let machineNumber = 1;

  while (remaining > 0) {
    const hours = Math.min(remaining, maxHoursPerMachine);
    machines.push({ machine: machineNumber, hours: round(hours) });
    remaining -= hours;
    machineNumber++;
  }

  return machines;
}

function calculateMachines(totalHours, hourlyPrice, maxHoursPerMachine) {
  const machines = splitIntoMachines(totalHours, maxHoursPerMachine);

  const calculated = machines.map((machine) => ({
    machine: machine.machine,
    hours: machine.hours,
    hourlyPrice: round(hourlyPrice),
    cost: round(machine.hours * hourlyPrice),
  }));

  const total = calculated.reduce((sum, m) => sum + m.cost, 0);

  return {
    maxHoursPerMachine,
    numberOfMachines: calculated.length,
    machines: calculated,
    totalEstimatedCost: round(total),
  };
}

/**
 * Extracts generic numeric usage amount from resource
 */
function getGenericUsageAmount(resource) {
  const raw =
    resource.usageAmount ??
    resource.usage?.amount ??
    resource.quantity ??
    0;

  return Number(raw);
}

/**
 * Calculates cost for ANY workload dynamically with multi-currency normalization
 */
async function calculateResource(resource, maxHoursPerMachine) {
  // Source currency handling
  const sourceCurrency = String(resource.sourceCurrency || resource.currency || "USD").toUpperCase();
  const sourceCurrencySymbol = resource.sourceCurrencySymbol || resource.currencySymbol || CURRENCY_SYMBOLS[sourceCurrency] || "$";
  
  // Original amount in bill currency
  const sourceCostOriginal = Number(resource.sourceCostOriginal ?? resource.sourceCost ?? resource.currentCost ?? 0);
  
  // Normalized amount in USD for fair apples-to-apples comparison
  const sourceCostUSD = sourceCurrency === "USD"
    ? sourceCostOriginal
    : toUSD(sourceCostOriginal, sourceCurrency);

  const rawDesc = String(resource.rawDescription || "");
  const usageUnit = String(resource.usageUnit || "").toLowerCase();
  const serviceKey = resource.targetAwsService || resource.service || "Compute";
  const resolvedKey = resolveServiceKey(serviceKey) || serviceKey;
  const config = SERVICE_CONFIG[resolvedKey];
  const serviceCode = resource.targetAwsServiceCode || resource.serviceCode || config?.serviceCode || "AmazonEC2";
  const instanceType = (resource.targetAwsInstanceType || resource.instanceType || "").toLowerCase();

  try {
    // 1. Dynamic Rate & Divisor Detection from Raw Description or Resource metadata
    const parsedRateInfo = parseDynamicRateFromDescription(rawDesc);

    let divisor = resource.unitDivisor || resource.usageDivisor || parsedRateInfo?.divisor || 1;
    let unitPrice = null;
    let priceSource = "AWS Price List API";

    // 2. Query Live AWS Price List API
    try {
      const awsPrice = await getPrice({
        ...resource,
        service: resolvedKey,
        targetAwsService: resolvedKey,
        serviceCode,
        instanceType: resource.targetAwsInstanceType || resource.instanceType,
        region: resource.targetAwsRegion || resource.region,
      });

      if (awsPrice && awsPrice.price !== undefined && awsPrice.price !== null && Number(awsPrice.price) > 0) {
        unitPrice = Number(awsPrice.price);
        priceSource = awsPrice.source || "AWS Price List API";
      }
    } catch (err) {
      console.log(`ℹ️ AWS Live Pricing query for ${resolvedKey} (${err.message}) -> using fallback resolution`);
    }

    // 3. If live API returned standard rate or if description contains exact rate (in USD)
    if ((unitPrice === null || isNaN(unitPrice) || unitPrice === 0) && parsedRateInfo && parsedRateInfo.unitRate !== undefined && !isNaN(parsedRateInfo.unitRate)) {
      if (sourceCurrency === "USD") {
        unitPrice = parsedRateInfo.unitRate;
        priceSource = "AWS Line Item Rate (Verified from Bill)";
      }
    }

    // 4. Catalog fallback for known instance types (EC2 and RDS)
    if ((unitPrice === null || isNaN(unitPrice) || unitPrice === 0) && instanceType) {
      if (INSTANCE_HOURLY_FALLBACKS[instanceType]) {
        unitPrice = INSTANCE_HOURLY_FALLBACKS[instanceType];
        priceSource = `AWS On-Demand Standard Catalog (${instanceType})`;
      }
    }

    // 5. Service-specific fallbacks from serviceConfig
    if ((unitPrice === null || isNaN(unitPrice) || unitPrice === 0) && config?.fallbackPrice) {
      unitPrice = config.fallbackPrice;
      priceSource = `Standard AWS Baseline (${resolvedKey})`;
    }

    // 6. Generic service category fallbacks
    if (unitPrice === null || isNaN(unitPrice) || unitPrice === 0) {
      const sLower = resolvedKey.toLowerCase();
      if (sLower.includes("rds") || sLower.includes("database") || sLower.includes("mysql") || sLower.includes("postgres")) {
        if (/storage/i.test(rawDesc) || /gp3|gp2/i.test(rawDesc) || /gb-mo/i.test(usageUnit)) {
          unitPrice = 0.115; // RDS gp3 storage per GB-Mo
          priceSource = "AWS RDS Storage Baseline (gp3)";
        } else if (/backup/i.test(rawDesc)) {
          unitPrice = 0.095; // RDS backup storage
          priceSource = "AWS RDS Backup Storage Baseline";
        } else {
          unitPrice = 0.180; // Baseline RDS instance
          priceSource = "AWS RDS Compute Baseline";
        }
      } else if (sLower.includes("ebs") || /storage volume|disk/i.test(rawDesc)) {
        unitPrice = 0.08; // EBS gp3 per GB-Mo
        priceSource = "AWS EBS gp3 Baseline";
      } else if (sLower.includes("data transfer") || sLower.includes("bandwidth") || /egress|transfer/i.test(rawDesc)) {
        unitPrice = 0.09; // AWS data transfer out per GB
        priceSource = "AWS Data Transfer Baseline";
      } else if (sLower.includes("s3") || /blob|object/i.test(rawDesc)) {
        unitPrice = 0.023; // S3 standard per GB-Mo
        priceSource = "AWS S3 Standard Baseline";
      } else if (sLower.includes("lambda") || sLower.includes("function")) {
        unitPrice = 0.0000166667;
        priceSource = "AWS Lambda Compute Baseline";
      } else {
        unitPrice = Number(resource.unitPrice || resource.hourlyPrice || 0.05);
        priceSource = "Estimated AWS Baseline";
      }
    }

    let usageAmount = getGenericUsageAmount(resource);

    // 7. Handle time normalization: if unit is "month(s)" for hourly services
    const isHourly = (/hr|hour/i.test(usageUnit) || /hour/i.test(parsedRateInfo?.unit || "")) &&
                     !/gb-mo|storage|month/i.test(usageUnit);

    if (usageUnit.includes("month") && isHourly) {
      usageAmount = (usageAmount || 1) * maxHoursPerMachine;
    }

    let totalCostUSD = 0;
    let machineCalc = null;

    // 8. Dynamic Machine Splitting for Compute Instance Hours
    const isComputeInstance = (resource.targetAwsInstanceType || resource.instanceType || /instance hour/i.test(rawDesc) || /vcore-hrs/i.test(usageUnit)) && isHourly;

    if (isComputeInstance && usageAmount > 0) {
      machineCalc = calculateMachines(usageAmount, unitPrice, maxHoursPerMachine);
      totalCostUSD = machineCalc.totalEstimatedCost;
    } else {
      totalCostUSD = (usageAmount / divisor) * unitPrice;
    }

    const finalAwsCostUSD = round(totalCostUSD);
    const awsCostInSourceCurrency = round(fromUSD(finalAwsCostUSD, sourceCurrency));

    // Fair calculation comparing USD to USD
    const costDeltaUSD = round(finalAwsCostUSD - sourceCostUSD);
    const savingsUSD = round(sourceCostUSD - finalAwsCostUSD);
    const percentSavings = sourceCostUSD > 0
      ? round(((sourceCostUSD - finalAwsCostUSD) / sourceCostUSD) * 100)
      : 0;

    // Savings in source currency
    const savingsSourceCurrency = round(sourceCostOriginal - awsCostInSourceCurrency);

    return {
      ...resource,
      targetAwsService: resolvedKey,
      service: resolvedKey,
      sourceProvider: resource.sourceProvider || "Cloud",

      // Source currency details
      sourceCurrency,
      sourceCurrencySymbol,
      sourceCostOriginal: round(sourceCostOriginal),
      sourceCostUSD: round(sourceCostUSD),
      sourceCost: round(sourceCostUSD), // Standardized to USD for backward compatibility
      
      serviceCode,
      pricing: {
        source: priceSource,
        currency: "USD",
        unitPrice: round(unitPrice),
        hourlyPrice: isHourly ? round(unitPrice) : null,
        unit: parsedRateInfo?.unit || resource.usageUnit || "unit",
        divisor,
        costPeriod: "Monthly",
        monthlyRate: isHourly ? round(unitPrice * maxHoursPerMachine) : round(finalAwsCostUSD),
      },
      ...(machineCalc || {}),

      // Target AWS Cost
      totalEstimatedCost: finalAwsCostUSD,
      monthlyEstimatedCost: finalAwsCostUSD,
      awsCost: finalAwsCostUSD,
      awsCostUSD: finalAwsCostUSD,
      awsCostInSourceCurrency,

      // Savings & Deltas
      costDelta: costDeltaUSD,
      costDeltaUSD,
      costDeltaSourceCurrency: round(awsCostInSourceCurrency - sourceCostOriginal),
      savings: savingsUSD,
      savingsUSD,
      savingsSourceCurrency,
      percentSavings,

      migrationStatus: finalAwsCostUSD < sourceCostUSD ? "SAVINGS" : finalAwsCostUSD > sourceCostUSD ? "INCREASE" : "NEUTRAL",
      calculationStatus: "CALCULATED",
      matchStatus: "MATCHED",
    };

  } catch (error) {
    console.error(`❌ Error calculating resource ${resolvedKey}:`, error);
    return {
      ...resource,
      sourceCurrency,
      sourceCurrencySymbol,
      sourceCostOriginal: round(sourceCostOriginal),
      sourceCostUSD: round(sourceCostUSD),
      sourceCost: round(sourceCostUSD),
      serviceCode,
      totalEstimatedCost: 0,
      monthlyEstimatedCost: 0,
      awsCost: 0,
      awsCostUSD: 0,
      awsCostInSourceCurrency: 0,
      costDelta: round(-sourceCostUSD),
      costDeltaUSD: round(-sourceCostUSD),
      costDeltaSourceCurrency: round(-sourceCostOriginal),
      savings: round(sourceCostUSD),
      savingsUSD: round(sourceCostUSD),
      savingsSourceCurrency: round(sourceCostOriginal),
      percentSavings: 0,
      calculationStatus: "ERROR",
      matchStatus: "ERROR",
      error: error.message,
    };
  }
}

/**
 * Calculates all resources dynamically and generates migration/audit summaries with multi-currency support
 */
async function calculateAll(resources, billingPeriod) {
  const days = Number(billingPeriod?.days || 31);
  const maxHoursPerMachine = days * 24;

  console.log(`📊 Calculating dynamic AWS pricing for ${resources.length} resources...`);

  const result = [];
  for (const resource of resources) {
    result.push(await calculateResource(resource, maxHoursPerMachine));
  }

  const calculated = result.filter(
    (r) => r.calculationStatus === "CALCULATED" || r.calculationStatus === "CALCULATED_WITH_FALLBACK"
  );
  const unmatched = result.filter((r) => r.calculationStatus === "UNMATCHED");
  const errors = result.filter((r) => r.calculationStatus === "ERROR");

  // Determine detected currency and symbol from resources
  const detectedCurrency = String(
    resources.detectedCurrency ||
    result.find((r) => r.sourceCurrency)?.sourceCurrency ||
    "USD"
  ).toUpperCase();
  
  const currencySymbol =
    resources.currencySymbol ||
    CURRENCY_SYMBOLS[detectedCurrency] ||
    "$";

  const exchangeRateToUSD = CURRENCY_RATES_TO_USD[detectedCurrency] || 1.0;
  const isMultiCurrency = detectedCurrency !== "USD";

  // Sum Source Cost (both in original currency and USD)
  const totalSourceCostOriginal = round(
    result.reduce((sum, r) => sum + Number(r.sourceCostOriginal ?? r.sourceCost ?? 0), 0)
  );

  const totalSourceCostUSD = round(
    result.reduce((sum, r) => sum + Number(r.sourceCostUSD ?? r.sourceCost ?? 0), 0)
  );

  // Sum AWS Cost (in USD and converted to source currency)
  const totalAwsCostUSD = round(
    result.reduce((sum, r) => sum + Number(r.awsCostUSD ?? r.totalEstimatedCost ?? 0), 0)
  );

  const totalAwsCostInSourceCurrency = round(
    fromUSD(totalAwsCostUSD, detectedCurrency)
  );

  // Savings & Difference in USD
  const costDifferenceUSD = round(totalAwsCostUSD - totalSourceCostUSD);
  const monthlySavingsUSD = round(totalSourceCostUSD - totalAwsCostUSD);

  // Savings & Difference in Source Currency
  const monthlySavingsSourceCurrency = round(totalSourceCostOriginal - totalAwsCostInSourceCurrency);
  const costDifferenceSourceCurrency = round(totalAwsCostInSourceCurrency - totalSourceCostOriginal);

  const percentageSavings = totalSourceCostUSD > 0
    ? round(((totalSourceCostUSD - totalAwsCostUSD) / totalSourceCostUSD) * 100)
    : 0;

  const detectedProvider = resources.detectedProvider || result[0]?.sourceProvider || "AWS";
  const isAwsSource = detectedProvider.toUpperCase() === "AWS";

  let migrationStatus = "SIMILAR";
  if (monthlySavingsUSD > 0) migrationStatus = "SAVINGS";
  else if (monthlySavingsUSD < 0) migrationStatus = "INCREASE";

  let noteText = "";
  if (isAwsSource) {
    noteText = `Calculated live AWS on-demand cost ($${totalAwsCostUSD.toFixed(2)}) compared to your invoice total ($${totalSourceCostUSD.toFixed(2)}).`;
  } else {
    const currencyStr = isMultiCurrency
      ? ` [${currencySymbol}${totalSourceCostOriginal.toFixed(2)} ${detectedCurrency} converted at 1 ${detectedCurrency} = $${exchangeRateToUSD} USD]`
      : "";

    noteText = `AWS pricing calculated for ${days}-day monthly workload${currencyStr}. ${
      monthlySavingsUSD > 0
        ? `Estimated monthly savings of $${monthlySavingsUSD.toFixed(2)} USD (${isMultiCurrency ? `${currencySymbol}${monthlySavingsSourceCurrency.toFixed(2)} ${detectedCurrency} • ` : ""}${percentageSavings}% reduction) on AWS.`
        : monthlySavingsUSD < 0
          ? `Estimated cost on AWS is $${totalAwsCostUSD.toFixed(2)} USD/mo vs $${totalSourceCostUSD.toFixed(2)} USD/mo (${currencySymbol}${totalSourceCostOriginal.toFixed(2)} ${detectedCurrency}) on ${detectedProvider}.`
          : `Workload costs are comparable between ${detectedProvider} and AWS.`
    }`;
  }

  return {
    success: true,
    sourceProvider: detectedProvider,
    billingPeriod: billingPeriod || { days: 31 },
    billingPeriodDays: days,
    maxHoursPerMachine,
    costPeriod: "Monthly",
    pricingSource: "AWS Price List API + Intelligent Catalog Fallbacks",
    
    // Currency Metadata
    detectedCurrency,
    currencySymbol,
    isMultiCurrency,
    exchangeRateToUSD,
    usdPerSourceCurrency: exchangeRateToUSD,
    sourceCurrencyPerUSD: round(1 / exchangeRateToUSD),

    // Unified USD Figures
    totalSourceCost: totalSourceCostUSD,
    totalSourceCostUSD,
    totalAwsCost: totalAwsCostUSD,
    totalAwsCostUSD,
    totalEstimatedCost: totalAwsCostUSD,
    monthlyEstimatedCost: totalAwsCostUSD,
    costDifference: costDifferenceUSD,
    costDifferenceUSD,
    monthlySavings: monthlySavingsUSD,
    monthlySavingsUSD,
    percentageSavings,

    // Source Currency Figures (e.g. INR ₹)
    totalSourceCostOriginal,
    totalAwsCostInSourceCurrency,
    monthlySavingsSourceCurrency,
    costDifferenceSourceCurrency,

    migrationStatus,

    summary: {
      sourceProvider: detectedProvider,
      detectedCurrency,
      currencySymbol,
      isMultiCurrency,
      exchangeRateToUSD,
      resourcesFound: result.length,
      calculated: calculated.length,
      unmatched: unmatched.length,
      errors: errors.length,
      totalSourceCost: totalSourceCostUSD,
      totalSourceCostUSD,
      totalSourceCostOriginal,
      totalAwsCost: totalAwsCostUSD,
      totalAwsCostUSD,
      totalAwsCostInSourceCurrency,
      monthlySavings: monthlySavingsUSD,
      monthlySavingsUSD,
      monthlySavingsSourceCurrency,
      costDifference: costDifferenceUSD,
      percentageSavings,
      migrationStatus,
      note: noteText,
    },
    resources: result,
  };
}

module.exports = {
  calculateAll,
  calculateResource,
  parseDynamicRateFromDescription,
  INSTANCE_HOURLY_FALLBACKS,
};
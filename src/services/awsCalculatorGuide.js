// src/services/awsCalculatorGuide.js
// Generates official AWS Pricing Calculator input specifications and traceability mappings for every workload.

const { REGION_NAMES } = require("./aws/productMatcher");

const OFFICIAL_CALCULATOR_URL = "https://calculator.aws/#/";
const CALCULATOR_SERVICE_URLS = {
  EC2: "https://calculator.aws/#/createConfiguration/EC2",
  RDS: "https://calculator.aws/#/createConfiguration/RDS",
  EBS: "https://calculator.aws/#/createConfiguration/EBS",
  S3: "https://calculator.aws/#/createConfiguration/S3",
  ALB: "https://calculator.aws/#/createConfiguration/ElasticLoadBalancing",
  NLB: "https://calculator.aws/#/createConfiguration/ElasticLoadBalancing",
  "NAT Gateway": "https://calculator.aws/#/createConfiguration/VPC",
  "Data Transfer": "https://calculator.aws/#/createConfiguration/DataTransfer",
  Lambda: "https://calculator.aws/#/createConfiguration/Lambda",
  CloudWatch: "https://calculator.aws/#/createConfiguration/CloudWatch",
};

/**
 * Maps region code (e.g. ap-south-1) to official AWS Calculator friendly region name
 */
function getCalculatorRegionName(regionCode = "us-east-1") {
  if (REGION_NAMES[regionCode]) {
    return REGION_NAMES[regionCode];
  }

  const map = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "ap-south-1": "Asia Pacific (Mumbai)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-southeast-2": "Asia Pacific (Sydney)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
    "eu-west-1": "Europe (Ireland)",
    "eu-central-1": "Europe (Frankfurt)",
    "eu-west-2": "Europe (London)",
    "ca-central-1": "Canada (Central)",
    "sa-east-1": "South America (Sao Paulo)",
  };

  return map[regionCode] || "US East (N. Virginia)";
}

/**
 * Generates exact inputs needed to recreate an estimate in AWS Pricing Calculator
 */
function generateCalculatorInputs(resource, days = 31) {
  const service = resource.targetAwsService || resource.service || "EC2";
  const regionCode = resource.targetAwsRegion || resource.region || "us-east-1";
  const regionName = getCalculatorRegionName(regionCode);
  const hoursPerMonth = days * 24;
  const usageAmount = Number(resource.usageAmount || 0);
  const rawDesc = String(resource.rawDescription || "");

  let inputs = {
    serviceName: `Amazon ${service}`,
    officialServiceCode: resource.targetAwsServiceCode || "AmazonEC2",
    calculatorUrl: CALCULATOR_SERVICE_URLS[service] || OFFICIAL_CALCULATOR_URL,
    region: regionName,
    regionCode,
    fields: [],
    assumptions: [],
    estimatedMonthlyCostUSD: Number(resource.awsCostUSD ?? resource.totalEstimatedCost ?? 0),
    traceability: {
      sourceProvider: resource.sourceProvider || "Cloud",
      sourceServiceName: resource.sourceServiceName || resource.serviceName || "Source Workload",
      sourceSku: resource.sourceSku || resource.instanceType || "Default SKU",
      sourceCostOriginal: resource.sourceCostOriginal ?? resource.sourceCost ?? 0,
      sourceCurrency: resource.sourceCurrency || "USD",
      sourceUsage: `${usageAmount} ${resource.usageUnit || "units"}`,
      awsEquivalent: `Amazon ${service} (${resource.targetAwsInstanceType || resource.targetAwsVolumeType || "On-Demand"})`,
    }
  };

  if (service === "EC2") {
    const instanceType = resource.targetAwsInstanceType || resource.instanceType || "t3.medium";
    const os = resource.operatingSystem || "Linux";
    const instancesCount = resource.numberOfMachines || 1;

    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Operating System", value: os },
      { label: "Tenancy", value: "Shared Instances" },
      { label: "Instance Type", value: instanceType },
      { label: "Pricing Strategy", value: "On-Demand" },
      { label: "Number of Instances", value: `${instancesCount}` },
      { label: "Usage", value: `${Math.round(usageAmount || hoursPerMonth)} Hours/Month` },
      { label: "Storage (EBS)", value: "gp3 - 30 GB Baseline (or attached volume)" }
    ];

    inputs.assumptions = [
      `Monthly period calculated for ${days} days (${hoursPerMonth} hours/machine)`,
      "Standard AWS On-Demand hourly rate without long-term commitment",
      "Shared Tenancy with standard AWS virtual networking"
    ];
  } else if (service === "RDS") {
    const instanceClass = resource.targetAwsInstanceType || resource.instanceType || "db.r6g.large";
    const engine = resource.targetAwsEngine || resource.engine || (/mysql/i.test(rawDesc) ? "MySQL" : "PostgreSQL");
    const isStorageOnly = /storage/i.test(rawDesc) || /gb-mo/i.test(resource.usageUnit);

    if (isStorageOnly) {
      inputs.fields = [
        { label: "Region", value: regionName },
        { label: "Database Engine", value: `Amazon RDS for ${engine}` },
        { label: "Deployment Option", value: "Single-AZ" },
        { label: "Storage Type", value: "General Purpose SSD (gp3)" },
        { label: "Allocated Storage", value: `${Math.round(usageAmount || 100)} GB-Mo` },
      ];
      inputs.assumptions = [
        "Allocated gp3 storage billed per GB-month",
        "Single-AZ deployment configuration"
      ];
    } else {
      inputs.fields = [
        { label: "Region", value: regionName },
        { label: "Database Engine", value: `Amazon RDS for ${engine}` },
        { label: "Deployment Option", value: "Single-AZ" },
        { label: "DB Instance Class", value: instanceClass },
        { label: "Pricing Model", value: "On-Demand" },
        { label: "Quantity", value: "1 DB Instance" },
        { label: "Usage Hours", value: `${Math.round(usageAmount || hoursPerMonth)} Hours/Month` },
      ];
      inputs.assumptions = [
        `Single-AZ deployment running ${engine}`,
        `Calculated based on ${usageAmount || hoursPerMonth} active instance hours per month`
      ];
    }
  } else if (service === "EBS") {
    const volumeType = resource.targetAwsVolumeType || "gp3";
    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Volume Type", value: `General Purpose SSD (${volumeType})` },
      { label: "Storage Amount", value: `${usageAmount} GB-Month` },
      { label: "Baseline IOPS", value: "3,000 IOPS (included free with gp3)" },
      { label: "Baseline Throughput", value: "125 MB/s (included free with gp3)" }
    ];
    inputs.assumptions = [
      "Standard gp3 configuration with baseline 3,000 IOPS and 125 MB/s included at zero extra cost"
    ];
  } else if (service === "S3") {
    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Storage Class", value: resource.targetAwsStorageClass || "S3 Standard" },
      { label: "Storage Amount", value: `${usageAmount} GB / Month` },
      { label: "Data Requests", value: "Standard API read/write operations" }
    ];
    inputs.assumptions = [
      "Amazon S3 Standard general purpose object storage tier"
    ];
  } else if (service === "Data Transfer" || /bandwidth|transfer/i.test(service)) {
    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Service", value: "AWS Data Transfer" },
      { label: "Transfer Type", value: "Internet Outbound Data Transfer (Egress)" },
      { label: "Data Volume", value: `${usageAmount} GB` }
    ];
    inputs.assumptions = [
      "Standard internet data transfer out from AWS region"
    ];
  } else if (service === "NAT Gateway") {
    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Number of NAT Gateways", value: "1" },
      { label: "Active Usage Hours", value: `${Math.round(usageAmount || hoursPerMonth)} Hours` },
      { label: "Data Processed", value: "Per GB processed through NAT Gateway" }
    ];
    inputs.assumptions = [
      "Standard AWS VPC NAT Gateway hourly charge + data processing rates"
    ];
  } else {
    inputs.fields = [
      { label: "Region", value: regionName },
      { label: "Service", value: `Amazon ${service}` },
      { label: "Quantity / Amount", value: `${usageAmount} ${resource.usageUnit || "Units"}` },
      { label: "Pricing Model", value: "AWS On-Demand Standard" }
    ];
    inputs.assumptions = [
      `Billed dynamically per ${resource.usageUnit || "unit"} based on AWS Price List API rates`
    ];
  }

  return inputs;
}

module.exports = {
  OFFICIAL_CALCULATOR_URL,
  CALCULATOR_SERVICE_URLS,
  getCalculatorRegionName,
  generateCalculatorInputs,
};

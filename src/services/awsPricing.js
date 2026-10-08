const {
  findProductPrice,
  REGION_NAMES,
} = require("./aws/productMatcher");
const { getAttributeNames, getAttributeValues } = require("./aws/attributeDiscovery");
const { discoverServices, resolveDynamicService } = require("./aws/serviceDiscovery");

function round(value) {
  return Number(Number(value || 0).toFixed(6));
}

const REGION_CODES = {
  "Asia Pacific (Mumbai)": "ap-south-1",
  "US East (N. Virginia)": "us-east-1",
  "US East (Northern Virginia)": "us-east-1",
  "US West (Oregon)": "us-west-2",
  "Europe (Ireland)": "eu-west-1",
  "EU (Ireland)": "eu-west-1",
  "Europe (Frankfurt)": "eu-central-1",
  "EU (Frankfurt)": "eu-central-1",
  "Asia Pacific (Singapore)": "ap-southeast-1",
  "Asia Pacific (Tokyo)": "ap-northeast-1",
  "Asia Pacific (Sydney)": "ap-southeast-2",
  "South America (Sao Paulo)": "sa-east-1",
};

function normalizeRegion(region) {
  if (!region) return "us-east-1";
  const value = String(region).trim();

  if (/^[a-z]{2}-[a-z]+-\d+$/.test(value)) return value;
  if (REGION_CODES[value]) return REGION_CODES[value];

  const found = Object.keys(REGION_CODES).find(
    (name) => name.toLowerCase() === value.toLowerCase()
  );
  if (found) return REGION_CODES[found];

  if (value.toLowerCase() === "any" || value.toLowerCase() === "global") {
    return "us-east-1";
  }

  return "us-east-1";
}

function normalizeOperatingSystem(value) {
  if (!value) return "Linux";
  const v = String(value).toLowerCase();

  if (
    v.includes("linux") ||
    v.includes("unix") ||
    v.includes("ubuntu") ||
    v.includes("debian") ||
    v.includes("centos") ||
    v.includes("amazon")
  ) {
    if (v.includes("rhel") || v.includes("red hat")) return "RHEL";
    if (v.includes("suse")) return "SUSE";
    return "Linux";
  }
  if (v.includes("windows")) return "Windows";
  if (v.includes("rhel") || v.includes("red hat")) return "RHEL";
  if (v.includes("suse")) return "SUSE";

  return "Linux";
}

function normalizeDatabaseEngine(value) {
  if (!value) return "PostgreSQL";
  const v = String(value).toLowerCase();

  if (v.includes("postgres") || v.includes("pgsql") || v.includes("aurora-postgresql")) return "PostgreSQL";
  if (v.includes("mysql") || v.includes("aurora-mysql") || v.includes("mariadb")) return "MySQL";
  if (v.includes("sqlserver") || v.includes("sql server") || v.includes("mssql")) return "SQL Server";
  if (v.includes("oracle")) return "Oracle";

  return "PostgreSQL";
}

function inferStructuralAttributes(resource) {
  const usageType = String(resource.usageType || "");
  const patch = {};

  if (/EBS:VolumeUsage/i.test(usageType) && !resource.volumeType) {
    const m = usageType.match(/VolumeUsage\.(\w+)/i);
    if (m) patch.volumeApiName = m[1];
  }

  if (/InstanceUsage:db\./i.test(usageType) && !resource.deploymentOption) {
    patch.deploymentOption = "Single-AZ";
  }

  return patch;
}

const serviceCodeCache = new Map();

async function resolveValidServiceCode(resource) {
  const given = resource.serviceCode;
  const cacheKey = given || `name:${resource.serviceName || resource.service || ""}`;

  if (serviceCodeCache.has(cacheKey)) {
    return serviceCodeCache.get(cacheKey);
  }

  const services = await discoverServices();
  let resolved = null;

  if (given) {
    const exact = services.find((s) => s.serviceCode === given);
    if (exact) resolved = exact.serviceCode;

    if (!resolved) {
      const ci = services.find((s) => s.serviceCode.toLowerCase() === given.toLowerCase());
      if (ci) resolved = ci.serviceCode;
    }
  }

  if (!resolved) {
    const nameText = resource.serviceName || resource.service || resource.rawDescription || "";

    try {
      const discovered = await resolveDynamicService(nameText);
      if (discovered) {
        resolved = discovered.serviceCode;
        console.log(`🔧 Corrected invalid serviceCode "${given}" -> "${resolved}" via ${discovered.matchType} match`);
      }
    } catch (err) {
      console.log(`⚠️ resolveDynamicService threw while correcting "${given}": ${err.message}`);
    }
  }

  resolved = resolved || given || "AmazonEC2";
  serviceCodeCache.set(cacheKey, resolved);
  return resolved;
}

const USAGE_TYPE_HINTS = [
  [/BoxUsage/i, ["instance", "compute"]],
  [/NatGateway/i, ["nat", "gateway"]],
  [/EBS:SnapshotUsage/i, ["snapshot", "storage"]],
  [/EBS:VolumeUsage/i, ["storage", "volume"]],
  [/InstanceUsage:db\./i, ["database", "instance"]],
  [/ChargedBackupUsage/i, ["backup", "storage", "snapshot"]],
  [/RDS:GP[23]-Storage/i, ["storage", "database"]],
  [/PublicIPv4/i, ["ip", "address"]],
  [/(DataTransfer|Bandwidth|-Out-Bytes|-In-Bytes)/i, ["data", "transfer"]],
  [/DashboardHour/i, ["dashboard"]],
  [/AlarmMonitorUsage/i, ["alarm"]],
  [/MetricMonitorUsage/i, ["metric"]],
  [/PutLogEvents/i, ["log", "data"]],
  [/TimedStorage-ByteHrs/i, ["storage", "timed"]],
  [/LCUUsage/i, ["load", "balancer", "capacity"]],
  [/(ApplicationLoadBalancerUsage|NetworkLoadBalancerUsage|LoadBalancerUsage)/i, ["load", "balancer"]],
  [/Requests?-Tier/i, ["request", "api"]],
  [/DNS-Queries/i, ["dns", "query"]],
  [/HostedZone/i, ["hosted", "zone"]],
  [/KMS-Keys/i, ["key"]],
  [/KMS-Requests/i, ["request"]],
  [/RuleV2/i, ["rule"]],
  [/WebACLV2/i, ["web", "acl"]],
  [/RequestV2/i, ["request"]],
  [/Secrets/i, ["secret"]],
  [/APIRequest/i, ["api", "request"]],
  [/StepCount/i, ["step", "automation"]],
  [/ScriptDuration/i, ["automation", "duration"]],
  [/IssuePublicCertificateDomain/i, ["certificate"]],
  [/ProcessResourceHandlers/i, ["handler", "operation"]],
  [/ECS-EC2-GB-Hours/i, ["storage", "hours"]],
  [/ECS-EC2-vCPU-Hours/i, ["cpu", "compute"]],
  [/GeneralPurposeBuckets/i, ["bucket", "storage"]],
];

function buildProductFamilyHaystack(resource) {
  const usageType = String(resource.usageType || "");
  const hints = USAGE_TYPE_HINTS
    .filter(([pattern]) => pattern.test(usageType))
    .flatMap(([, words]) => words);

  return `${usageType} ${hints.join(" ")}`.toLowerCase();
}

async function resolveProductFamily(serviceCode, resource) {
  if (resource.productFamily) return resource.productFamily;

  let values;
  try {
    values = await getAttributeValues(serviceCode, "productFamily");
  } catch (err) {
    return undefined;
  }

  if (!values || !values.length) return undefined;

  const haystack = buildProductFamilyHaystack(resource);
  let best = null;
  let bestScore = -1;
  let bestMatched = -1;

  for (const value of values) {
    const words = value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);

    if (!words.length) continue;

    let matched = 0;
    for (const word of words) {
      if (haystack.includes(word)) matched++;
    }

    if (matched === 0) continue;
    const score = matched / words.length;

    if (score > bestScore || (score === bestScore && matched > bestMatched)) {
      bestScore = score;
      bestMatched = matched;
      best = value;
    }
  }

  return best || undefined;
}

async function getAWSProductPrice({ serviceCode, region, filters = [] }) {
  if (!serviceCode) throw new Error("AWS serviceCode is required");

  const regionCode = normalizeRegion(region);
  const result = await findProductPrice({ serviceCode, region: regionCode, filters });

  console.log(
    `💰 AWS Price: ${serviceCode} | ${regionCode} | $${result.price}/${result.unit}`
  );

  return { ...result, region: regionCode, serviceCode };
}

function buildGenericFilters(resource, attributeNames = []) {
  const available = new Set(attributeNames);

  const candidates = {
    operation: resource.operation,
    productFamily: resource.productFamily,
    instanceType: resource.instanceType || resource.targetAwsInstanceType,
    operatingSystem: normalizeOperatingSystem(resource.operatingSystem),
    tenancy: resource.tenancy,
    capacitystatus: resource.capacitystatus || resource.capacityStatus,
    preInstalledSw: resource.preInstalledSw,
    databaseEngine: normalizeDatabaseEngine(resource.databaseEngine || resource.engine),
    deploymentOption: resource.deploymentOption,
    volumeApiName: resource.volumeApiName || resource.volumeType,
    storageClass: resource.storageClass,
    group: resource.group,
    transferType: resource.transferType,
    fromLocation: resource.fromLocation,
    toLocation: resource.toLocation,
  };

  return Object.entries(candidates)
    .filter(([field, value]) => {
      if (!available.has(field)) return false;
      return value !== undefined && value !== null && String(value).trim() !== "";
    })
    .map(([Field, Value]) => ({
      Type: "TERM_MATCH",
      Field,
      Value: String(Value),
    }));
}

async function getGenericPrice(resource) {
  if (!resource.serviceCode) {
    throw new Error(
      `Dynamic pricing requires serviceCode for "${resource.service || "unknown service"}"`
    );
  }

  const serviceCode = await resolveValidServiceCode(resource);
  const attributeNames = await getAttributeNames(serviceCode);
  const structural = inferStructuralAttributes(resource);

  let productFamily;
  if (attributeNames.includes("productFamily")) {
    productFamily = await resolveProductFamily(serviceCode, { ...structural, ...resource });
  }

  const enrichedResource = {
    ...structural,
    ...resource,
    ...(productFamily ? { productFamily } : {}),
  };

  const filters = buildGenericFilters(enrichedResource, attributeNames) || [];

  const result = await getAWSProductPrice({
    serviceCode,
    region: resource.region,
    filters: filters || [],
  });

  return {
    ...result,
    matchType: "dynamic",
    matchedAttributes: (filters || []).map((f) => f.Field),
  };
}

async function getPrice(resource) {
  const { SERVICE_CONFIG } = require("./serviceConfig");
  const serviceKey = resource.targetAwsService || resource.service;
  const config = SERVICE_CONFIG[serviceKey];
  const region = resource.targetAwsRegion || resource.region || "us-east-1";

  // 1. Try dedicated service config filters first
  if (config && typeof config.buildFilters === "function") {
    const serviceCode = resource.serviceCode || config.serviceCode || "AmazonEC2";
    const filters = config.buildFilters(resource);
    console.log(`🔎 Dedicated pricing lookup for ${serviceKey} in ${region}:`, filters);
    try {
      const res = await getAWSProductPrice({ serviceCode, region, filters });
      return { ...res, matchType: "configured" };
    } catch (err) {
      console.log(`⚠️ Dedicated filter query failed for ${serviceKey} (${err.message}). Trying generic resolution...`);
    }
  }

  // 2. Fall back to generic dynamic resolution
  return await getGenericPrice(resource);
}

module.exports = {
  REGION_NAMES,
  REGION_CODES,
  normalizeRegion,
  normalizeOperatingSystem,
  normalizeDatabaseEngine,
  resolveValidServiceCode,
  resolveProductFamily,
  getAWSProductPrice,
  getGenericPrice,
  getPrice,
  round,
};
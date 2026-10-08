// services/serviceConfig.js
//
// ONE object per AWS service. This is the single place you touch to add,
// fix, or extend a service — awsPricing.js, calculator.js, and billParser.js
// all read from this file instead of having their own per-service code.

const { normalizeOperatingSystem, normalizeDatabaseEngine } = require("./awsPricing");

const SERVICE_CONFIG = {
  EC2: {
    aliases: [
      "ec2",
      "elastic compute cloud",
      "instance hour",
      "virtual machines",
      "compute engine",
      "droplets",
      "vm instances",
      "virtual machine",
      "azure vm",
      "gcp compute",
      "vps",
    ],
    serviceCode: "AmazonEC2",
    unit: "hours",
    splitByMaxHours: true,
    usageField: "usageHours",
    fallbackPrice: 0.0116,
    buildFilters: (r) => [
      { Type: "TERM_MATCH", Field: "instanceType", Value: r.instanceType || r.targetAwsInstanceType || "t3.micro" },
      { Type: "TERM_MATCH", Field: "operatingSystem", Value: normalizeOperatingSystem(r.operatingSystem) },
      { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
      { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
      { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
    ],
    extractAttributes: (description) => {
      const m = description.match(/(t\d+\.\w+|m\d+\.\w+|c\d+\.\w+|r\d+\.\w+)/i);
      if (!m) return null;
      const operatingSystem = /windows/i.test(description) ? "Windows" : "Linux";
      return { instanceType: m[1].toLowerCase(), operatingSystem };
    },
  },

  RDS: {
    aliases: [
      "rds",
      "relational database service",
      "db.",
      "azure sql",
      "cloud sql",
      "managed database",
      "postgresql",
      "mysql database",
    ],
    serviceCode: "AmazonRDS",
    unit: "hours",
    splitByMaxHours: true,
    usageField: "usageHours",
    fallbackPrice: 0.0529,
    buildFilters: (r) => [
      { Type: "TERM_MATCH", Field: "instanceType", Value: r.instanceType || r.targetAwsInstanceType || "db.t3.small" },
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: normalizeDatabaseEngine(r.engine || r.targetAwsEngine) },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: r.deploymentOption || "Single-AZ" },
    ],
    extractAttributes: (description) => {
      const m = description.match(/(db\.\w+\.\w+)/i);
      if (!m) return null;
      const engine = /mysql/i.test(description) ? "MySQL" : "PostgreSQL";
      return { instanceType: m[1].toLowerCase(), engine };
    },
  },

  EBS: {
    aliases: [
      "ebs",
      "elastic block store",
      "gp2",
      "gp3",
      "managed disk",
      "persistent disk",
      "block storage",
      "disk storage",
      "snapshot",
    ],
    serviceCode: "AmazonEC2",
    unit: "GB-Mo",
    usageField: "storageGBMonth",
    fallbackPrice: 0.10,
    buildFilters: (r) => [
      { Type: "TERM_MATCH", Field: "volumeApiName", Value: r.volumeType || r.targetAwsVolumeType || "gp3" },
    ],
    extractAttributes: (description) => {
      if (!/GB-Mo|GB-month/i.test(description)) return null;
      let volumeType = "gp3";
      if (/gp2/i.test(description)) volumeType = "gp2";
      else if (/snapshot/i.test(description)) volumeType = "snapshot";
      return { volumeType };
    },
  },

  "NAT Gateway": {
    aliases: ["nat gateway", "cloud nat", "azure nat", "natgateway"],
    serviceCode: "AmazonEC2",
    unit: "hours",
    usageField: "usageHours",
    fallbackPrice: 0.056,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "NAT Gateway" }],
  },

  ALB: {
    aliases: [
      "application load balancer",
      "application loadbalancer",
      "alb",
      "azure app gateway",
      "cloud load balancing",
    ],
    serviceCode: "AWSELB",
    unit: "hours",
    usageField: "usageHours",
    fallbackPrice: 0.0239,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Application Load Balancer" }],
  },

  NLB: {
    aliases: ["network load balancer", "network loadbalancer", "nlb"],
    serviceCode: "AWSELB",
    unit: "hours",
    usageField: "usageHours",
    fallbackPrice: 0.0239,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Network Load Balancer" }],
  },

  "Elastic Load Balancing": {
    aliases: ["elastic load balancing", "load balancing", "load balancer"],
    serviceCode: "AWSELB",
    unit: "hours",
    usageField: "usageHours",
    fallbackPrice: 0.0239,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Load Balancing" }],
  },

  CloudWatch: {
    aliases: ["cloudwatch", "azure monitor", "cloud logging", "log analytics", "stackdriver"],
    serviceCode: "AmazonCloudWatch",
    unit: "per metric-month",
    usageField: "metrics",
    fallbackPrice: 0.30,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "CloudWatch" }],
  },

  "Public IPv4": {
    aliases: [
      "public ipv4",
      "elastic ip",
      "public ip",
      "static ip",
      "pip",
    ],
    serviceCode: "AmazonVPC",
    unit: "hours",
    usageField: "usageHours",
    defaultUsage: 744,
    fallbackPrice: 0.005,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Public IPv4 Address" }],
  },

  "Virtual Private Cloud": {
    aliases: ["virtual private cloud", "vpc", "vnet", "virtual network"],
    serviceCode: "AmazonVPC",
    unit: "hours",
    usageField: "usageHours",
    defaultUsage: 744,
    fallbackPrice: 0.005,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Public IPv4 Address" }],
  },

  ECR: {
    aliases: [
      "ec2 container registry",
      "elastic container registry",
      "artifact registry",
      "container registry",
      "ecr",
    ],
    serviceCode: "AmazonECR",
    unit: "GB-Mo",
    usageField: "storageGBMonth",
    fallbackPrice: 0.10,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "ECR Storage" }],
  },

  S3: {
    aliases: [
      "simple storage service",
      "blob",
      "blob storage",
      "cloud storage",
      "spaces",
      "object storage",
      "gcs",
      "s3",
    ],
    serviceCode: "AmazonS3",
    unit: "GB-Mo",
    usageField: "storageGBMonth",
    fallbackPrice: 0.025,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Storage" }],
  },

  "S3 Tier 1 Requests": {
    aliases: ["s3 tier 1", "s3 put", "s3 post", "s3 copy", "s3 list"],
    serviceCode: "AmazonS3",
    unit: "per 1,000 requests",
    usageField: "requests",
    usageDivisor: 1_000,
    fallbackPrice: 0.005,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Requests" }],
  },

  "S3 Tier 2 Requests": {
    aliases: ["s3 tier 2", "s3 get", "s3 other requests"],
    serviceCode: "AmazonS3",
    unit: "per 10,000 requests",
    usageField: "requests",
    usageDivisor: 10_000,
    fallbackPrice: 0.004,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Requests" }],
  },

  "S3 Requests": {
    aliases: ["s3 requests", "blob requests", "storage operations"],
    serviceCode: "AmazonS3",
    unit: "per 1M requests",
    usageField: "requests",
    usageDivisor: 1_000_000,
    fallbackPrice: 0.0007,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Requests" }],
  },

  Lambda: {
    aliases: [
      "lambda",
      "azure functions",
      "cloud functions",
      "serverless functions",
      "cloud run",
    ],
    serviceCode: "AWSLambda",
    unit: "per 1M requests",
    usageField: "requests",
    usageDivisor: 1_000_000,
    fallbackPrice: 0.20,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "AWS Lambda" }],
    computeCost: (r) => {
      const requestsCost = ((r.requests || 0) / 1_000_000) * 0.20;
      const gbSeconds = (r.gbSeconds || 0);
      const durationCost = gbSeconds * 0.0000166667;
      return requestsCost + durationCost;
    },
  },

  SQS: {
    aliases: ["simple queue service", "service bus", "cloud pub/sub queue", "sqs"],
    serviceCode: "AmazonSQS",
    unit: "per 1M requests",
    usageField: "requests",
    usageDivisor: 1_000_000,
    fallbackPrice: 0.40,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Amazon SQS" }],
  },

  SNS: {
    aliases: ["simple notification service", "event grid", "cloud pub/sub", "sns"],
    serviceCode: "AmazonSNS",
    unit: "per 1M notifications",
    usageField: "notifications",
    usageDivisor: 1_000_000,
    fallbackPrice: 0.50,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Amazon SNS" }],
  },

  "Route 53": {
    aliases: ["route 53", "route53", "azure dns", "cloud dns", "dns routing"],
    serviceCode: "AmazonRoute53",
    unit: "per 1M queries",
    usageField: "queries",
    usageDivisor: 1_000_000,
    fallbackPrice: 0.40,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "DNS" }],
    regionOverride: "us-east-1",
    computeCost: (r) => {
      const hostedZones = (r.hostedZones || 0) * 0.50;
      const queries = ((r.queries || 0) / 1_000_000) * 0.40;
      return hostedZones + queries;
    },
  },

  KMS: {
    aliases: ["key management service", "key vault", "cloud kms", "kms"],
    serviceCode: "AWSKMS",
    unit: "requests",
    usageField: "requests",
    usageDivisor: 10_000,
    defaultUsage: 0,
    fallbackPrice: 0.03,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "AWS Key Management Service" }],
  },

  "Secrets Manager": {
    aliases: ["secrets manager", "secret manager", "azure secret"],
    serviceCode: "SecretsManager",
    unit: "per secret",
    usageField: "secrets",
    defaultUsage: 1,
    fallbackPrice: 0.40,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Secrets Manager" }],
    computeCost: (r) => (r.secrets || 1) * 0.40,
  },

  "Secrets Manager API Requests": {
    aliases: ["secrets manager api", "secrets manager request", "secretsmanagerapirequest"],
    serviceCode: "SecretsManager",
    unit: "per 10k requests",
    usageField: "requests",
    usageDivisor: 10_000,
    fallbackPrice: 0.05,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Secrets Manager" }],
  },

  WAF: {
    aliases: ["web application firewall", "azure waf", "cloud armor", "waf"],
    serviceCode: "WAFV2",
    unit: "per web ACL",
    usageField: "webACLs",
    defaultUsage: 1,
    fallbackPrice: 5.0,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "AWS WAF" }],
    computeCost: (r) => {
      const webACLs = (r.webACLs || 1) * 5.0;
      const rules = (r.rules || 0) * 1.0;
      return webACLs + rules;
    },
  },

  "Data Transfer": {
    aliases: ["data transfer", "bandwidth", "egress", "network egress"],
    serviceCode: "AWSDataTransfer",
    unit: "GB",
    usageField: "dataGB",
    defaultUsage: 0,
    fallbackPrice: 0.086,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Data Transfer" }],
  },

  ECS: {
    aliases: ["elastic container service", "azure container instances", "cloud run container", "ecs"],
    serviceCode: "AmazonECS",
    unit: "GB-Hr",
    usageField: "gbHours",
    defaultUsage: 0,
    fallbackPrice: 0.004445,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Amazon Elastic Container Service" }],
  },

  Glue: {
    aliases: ["data factory", "cloud dataflow", "glue"],
    serviceCode: "AWSGlue",
    unit: "per request",
    usageField: "requests",
    defaultUsage: 0,
    fallbackPrice: 0.44,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "AWS Glue" }],
  },

  CloudFormation: {
    aliases: ["cloudformation", "arm template", "cloud deployment manager"],
    serviceCode: "AWSCloudFormation",
    unit: "handlers",
    usageField: "handlers",
    defaultUsage: 0,
    fallbackPrice: 0.0000021,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "AWS CloudFormation" }],
  },

  "Certificate Manager": {
    aliases: ["certificate manager", "acm", "app service certificates"],
    serviceCode: "ACM",
    unit: "per certificate",
    usageField: "certificates",
    defaultUsage: 1,
    fallbackPrice: 0,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "ACM" }],
  },

  "Systems Manager": {
    aliases: ["systems manager", "ssm", "azure automation"],
    serviceCode: "AWSSystemsManager",
    unit: "per step",
    usageField: "steps",
    defaultUsage: 100,
    fallbackPrice: 0.002,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "Systems Manager" }],
  },

  CloudFront: {
    aliases: ["cloudfront", "azure cdn", "azure front door", "google cloud cdn", "cdn"],
    serviceCode: "AmazonCloudFront",
    unit: "GB",
    usageField: "dataGB",
    defaultUsage: 0,
    fallbackPrice: 0.085,
    buildFilters: () => [{ Type: "TERM_MATCH", Field: "productFamily", Value: "CloudFront" }],
  },
};

function resolveServiceKey(rawText) {
  if (!rawText) return null;
  const text = rawText.toLowerCase().trim();

  // 1. Direct exact key match
  const exactKey = Object.keys(SERVICE_CONFIG).find(
    (key) => key.toLowerCase() === text
  );
  if (exactKey) return exactKey;

  // 2. Exact alias match
  for (const key of Object.keys(SERVICE_CONFIG)) {
    if (SERVICE_CONFIG[key].aliases.some((alias) => alias.toLowerCase() === text)) {
      return key;
    }
  }

  // 3. Word boundary / token match (prevent "ecr" matching inside "secrets", "s3" inside "vps3", etc.)
  for (const key of Object.keys(SERVICE_CONFIG)) {
    for (const alias of SERVICE_CONFIG[key].aliases) {
      const aliasClean = alias.toLowerCase();
      if (aliasClean.length <= 4) {
        const regex = new RegExp(`\\b${aliasClean}\\b`, "i");
        if (regex.test(text)) return key;
      } else {
        if (text.includes(aliasClean)) return key;
      }
    }
  }

  return null;
}

module.exports = { SERVICE_CONFIG, resolveServiceKey };
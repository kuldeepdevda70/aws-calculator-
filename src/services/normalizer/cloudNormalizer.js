// src/services/normalizer/cloudNormalizer.js
//
// Heuristic and deterministic mapping engine for translating non-AWS cloud resources
// (Azure, Google Cloud Platform, DigitalOcean, etc.) into equivalent AWS resources and configurations.

const REGION_MAPPING = {
  // Azure -> AWS
  "eastus": "us-east-1",
  "eastus2": "us-east-1",
  "centralus": "us-east-2",
  "northcentralus": "us-east-2",
  "southcentralus": "us-east-2",
  "westus": "us-west-1",
  "westus2": "us-west-2",
  "westus3": "us-west-2",
  "centralindia": "ap-south-1",
  "southindia": "ap-south-1",
  "westindia": "ap-south-1",
  "westeurope": "eu-west-1",
  "northeurope": "eu-west-1",
  "germanywestcentral": "eu-central-1",
  "southeastasia": "ap-southeast-1",
  "eastasia": "ap-southeast-1",
  "australiaeast": "ap-southeast-2",
  "japaneast": "ap-northeast-1",
  "brazilsouth": "sa-east-1",

  // GCP -> AWS
  "us-central1": "us-east-2",
  "us-east1": "us-east-1",
  "us-east4": "us-east-1",
  "us-west1": "us-west-1",
  "us-west2": "us-west-2",
  "us-west3": "us-west-2",
  "us-west4": "us-west-2",
  "europe-west1": "eu-west-1",
  "europe-west3": "eu-central-1",
  "europe-west4": "eu-west-1",
  "asia-south1": "ap-south-1",
  "asia-south2": "ap-south-1",
  "asia-southeast1": "ap-southeast-1",
  "asia-southeast2": "ap-southeast-2",
  "asia-east1": "ap-southeast-1",
  "asia-northeast1": "ap-northeast-1",
  "southamerica-east1": "sa-east-1",

  // DigitalOcean -> AWS
  "nyc1": "us-east-1",
  "nyc2": "us-east-1",
  "nyc3": "us-east-1",
  "sfo1": "us-west-1",
  "sfo2": "us-west-1",
  "sfo3": "us-west-1",
  "ams2": "eu-west-1",
  "ams3": "eu-west-1",
  "fra1": "eu-central-1",
  "lon1": "eu-west-1",
  "sgp1": "ap-southeast-1",
  "blr1": "ap-south-1",
  "tor1": "ca-central-1",
  "syd1": "ap-southeast-2",
};

// Azure VM SKU -> AWS EC2 equivalent instance type
const AZURE_VM_MAPPING = {
  // General Purpose B-series (Burstable) -> t3 / t4g
  "standard_b1ls": "t3.nano",
  "standard_b1s": "t3.micro",
  "standard_b1ms": "t3.small",
  "standard_b2s": "t3.medium",
  "standard_b2ms": "t3.medium",
  "standard_b4ms": "t3.xlarge",
  "standard_b8ms": "t3.2xlarge",

  // General Purpose D-series -> m5 / t3
  "standard_d2s_v3": "t3.large",
  "standard_d2s_v4": "m5.large",
  "standard_d2s_v5": "m5.large",
  "standard_d2as_v4": "m5a.large",
  "standard_d4s_v3": "m5.xlarge",
  "standard_d4s_v4": "m5.xlarge",
  "standard_d4s_v5": "m5.xlarge",
  "standard_d4as_v4": "m5a.xlarge",
  "standard_d8s_v3": "m5.2xlarge",
  "standard_d8s_v4": "m5.2xlarge",
  "standard_d8s_v5": "m5.2xlarge",
  "standard_d16s_v3": "m5.4xlarge",
  "standard_d16s_v4": "m5.4xlarge",
  "standard_d32s_v3": "m5.8xlarge",

  // Compute Optimized F-series -> c5
  "standard_f2s_v2": "c5.large",
  "standard_f4s_v2": "c5.xlarge",
  "standard_f8s_v2": "c5.2xlarge",
  "standard_f16s_v2": "c5.4xlarge",
  "standard_f32s_v2": "c5.8xlarge",

  // Memory Optimized E-series -> r5
  "standard_e2s_v3": "r5.large",
  "standard_e2s_v4": "r5.large",
  "standard_e4s_v3": "r5.xlarge",
  "standard_e4s_v4": "r5.xlarge",
  "standard_e8s_v3": "r5.2xlarge",
  "standard_e8s_v4": "r5.2xlarge",
  "standard_e16s_v3": "r5.4xlarge",
  "standard_e32s_v3": "r5.8xlarge",
};

// GCP Machine Type -> AWS EC2 equivalent instance type
const GCP_MACHINE_MAPPING = {
  // Shared-core / Burstable -> t3
  "f1-micro": "t3.nano",
  "g1-small": "t3.micro",
  "e2-micro": "t3.micro",
  "e2-small": "t3.small",
  "e2-medium": "t3.medium",

  // E2 Standard -> t3 / m5
  "e2-standard-2": "m5.large",
  "e2-standard-4": "m5.xlarge",
  "e2-standard-8": "m5.2xlarge",
  "e2-standard-16": "m5.4xlarge",
  "e2-standard-32": "m5.8xlarge",

  // N1 / N2 Standard -> m5
  "n1-standard-1": "t3.medium",
  "n1-standard-2": "m5.large",
  "n1-standard-4": "m5.xlarge",
  "n1-standard-8": "m5.2xlarge",
  "n1-standard-16": "m5.4xlarge",
  "n2-standard-2": "m5.large",
  "n2-standard-4": "m5.xlarge",
  "n2-standard-8": "m5.2xlarge",
  "n2-standard-16": "m5.4xlarge",

  // Compute-optimized C2 -> c5
  "c2-standard-4": "c5.xlarge",
  "c2-standard-8": "c5.2xlarge",
  "c2-standard-16": "c5.4xlarge",

  // Memory-optimized N2 HighMem / M1 -> r5
  "n2-highmem-2": "r5.large",
  "n2-highmem-4": "r5.xlarge",
  "n2-highmem-8": "r5.2xlarge",
  "n2-highmem-16": "r5.4xlarge",
};

// DigitalOcean Droplet -> AWS EC2 equivalent
const DO_DROPLET_MAPPING = {
  "s-1vcpu-512mb": "t3.nano",
  "s-1vcpu-1gb": "t3.micro",
  "s-1vcpu-2gb": "t3.small",
  "s-2vcpu-2gb": "t3.small",
  "s-2vcpu-4gb": "t3.medium",
  "s-4vcpu-8gb": "t3.xlarge",
  "s-8vcpu-16gb": "t3.2xlarge",
  "c-2": "c5.large",
  "c-4": "c5.xlarge",
  "c-8": "c5.2xlarge",
  "g-2vcpu-8gb": "m5.large",
  "g-4vcpu-16gb": "m5.xlarge",
  "g-8vcpu-32gb": "m5.2xlarge",
  "m-2vcpu-16gb": "r5.large",
  "m-4vcpu-32gb": "r5.xlarge",
};

/**
 * Maps arbitrary vCPU + RAM specs to the best matching AWS EC2 instance type
 */
function findClosestEC2Instance(vcpu = 2, ramGb = 4, category = "general") {
  const v = Number(vcpu) || 2;
  const r = Number(ramGb) || 4;

  if (category === "compute" || v >= 4 && r <= v * 2) {
    if (v <= 2) return "c5.large";
    if (v <= 4) return "c5.xlarge";
    if (v <= 8) return "c5.2xlarge";
    if (v <= 16) return "c5.4xlarge";
    return "c5.9xlarge";
  }

  if (category === "memory" || r >= v * 8) {
    if (v <= 2) return "r5.large";
    if (v <= 4) return "r5.xlarge";
    if (v <= 8) return "r5.2xlarge";
    if (v <= 16) return "r5.4xlarge";
    return "r5.8xlarge";
  }

  // Burstable / lightweight
  if (v === 1 && r <= 1) return "t3.micro";
  if (v === 1 && r <= 2) return "t3.small";
  if (v === 2 && r <= 4) return "t3.medium";
  if (v === 2 && r <= 8) return "t3.large";
  if (v === 4 && r <= 16) return "t3.xlarge";

  // General Purpose M5
  if (v <= 2) return "m5.large";
  if (v <= 4) return "m5.xlarge";
  if (v <= 8) return "m5.2xlarge";
  if (v <= 16) return "m5.4xlarge";
  return "m5.8xlarge";
}

/**
 * Normalizes any cloud region to its closest AWS region equivalent
 */
function mapToAWSRegion(rawRegion = "") {
  if (!rawRegion) return "us-east-1";
  const clean = String(rawRegion).toLowerCase().trim().replace(/[^a-z0-9-]/g, "");

  if (REGION_MAPPING[clean]) {
    return REGION_MAPPING[clean];
  }

  // If already an AWS region format (e.g. us-east-1, ap-south-1)
  if (/^[a-z]{2}-[a-z]+-\d+$/.test(clean)) {
    return clean;
  }

  // Broad geo heuristics
  if (clean.includes("india") || clean.includes("mumbai")) return "ap-south-1";
  if (clean.includes("singapore") || clean.includes("asia-southeast")) return "ap-southeast-1";
  if (clean.includes("sydney") || clean.includes("australia")) return "ap-southeast-2";
  if (clean.includes("tokyo") || clean.includes("japan")) return "ap-northeast-1";
  if (clean.includes("ireland") || clean.includes("europe-west1") || clean.includes("westeurope")) return "eu-west-1";
  if (clean.includes("frankfurt") || clean.includes("germany")) return "eu-central-1";
  if (clean.includes("london") || clean.includes("uk")) return "eu-west-2";
  if (clean.includes("westus") || clean.includes("oregon") || clean.includes("california")) return "us-west-2";
  if (clean.includes("eastus") || clean.includes("virginia")) return "us-east-1";

  return "us-east-1";
}

/**
 * Resolves source provider from text or metadata
 */
function detectCloudProvider(text = "", defaultProvider = "aws") {
  const content = String(text).toLowerCase();
  
  if (content.includes("microsoft azure") || content.includes("azure") || content.includes("microsoft.compute")) {
    return "Azure";
  }
  if (content.includes("google cloud") || content.includes("gcp") || content.includes("google.cloud") || content.includes("compute engine")) {
    return "GCP";
  }
  if (content.includes("digitalocean") || content.includes("droplet") || content.includes("digital ocean")) {
    return "DigitalOcean";
  }
  if (content.includes("amazon web services") || content.includes("aws") || content.includes("amazonec2")) {
    return "AWS";
  }
  
  return defaultProvider ? defaultProvider.toUpperCase() : "Cloud";
}

/**
 * Resolves target AWS Equivalent for non-AWS resource specifications
 */
function resolveAWSEquivalent(sourceResource = {}) {
  const provider = (sourceResource.sourceProvider || sourceResource.cloudProvider || "").toUpperCase();
  const serviceName = String(sourceResource.sourceServiceName || sourceResource.serviceName || sourceResource.service || "").toLowerCase();
  const sku = String(sourceResource.sourceSku || sourceResource.instanceType || "").toLowerCase();
  const rawDesc = String(sourceResource.rawDescription || "").toLowerCase();

  let targetAwsService = "EC2";
  let targetAwsServiceCode = "AmazonEC2";
  let targetAwsInstanceType = null;
  let targetAwsVolumeType = null;
  let targetAwsStorageClass = null;
  let targetAwsEngine = null;
  let rationale = "";

  // 1. COMPUTE / VIRTUAL MACHINES
  if (
    serviceName.includes("virtual machine") ||
    serviceName.includes("compute engine") ||
    serviceName.includes("droplet") ||
    serviceName.includes("instance") ||
    serviceName.includes("vm") ||
    sku.startsWith("standard_") ||
    sku.startsWith("e2-") ||
    sku.startsWith("n1-") ||
    sku.startsWith("n2-") ||
    sku.startsWith("s-")
  ) {
    targetAwsService = "EC2";
    targetAwsServiceCode = "AmazonEC2";

    if (AZURE_VM_MAPPING[sku]) {
      targetAwsInstanceType = AZURE_VM_MAPPING[sku];
      rationale = `Mapped Azure ${sourceResource.sourceSku || sku} to equivalent AWS EC2 ${targetAwsInstanceType}`;
    } else if (GCP_MACHINE_MAPPING[sku]) {
      targetAwsInstanceType = GCP_MACHINE_MAPPING[sku];
      rationale = `Mapped GCP ${sourceResource.sourceSku || sku} to equivalent AWS EC2 ${targetAwsInstanceType}`;
    } else if (DO_DROPLET_MAPPING[sku]) {
      targetAwsInstanceType = DO_DROPLET_MAPPING[sku];
      rationale = `Mapped DigitalOcean ${sourceResource.sourceSku || sku} to equivalent AWS EC2 ${targetAwsInstanceType}`;
    } else if (sourceResource.sourceSpecs?.vcpu || sourceResource.vcpu) {
      const vcpu = sourceResource.sourceSpecs?.vcpu || sourceResource.vcpu;
      const ram = sourceResource.sourceSpecs?.ramGb || sourceResource.ramGb || sourceResource.ram;
      targetAwsInstanceType = findClosestEC2Instance(vcpu, ram);
      rationale = `Mapped ${vcpu} vCPU / ${ram || (vcpu*2)}GB RAM workload to AWS EC2 ${targetAwsInstanceType}`;
    } else {
      targetAwsInstanceType = "t3.medium";
      rationale = `Mapped general compute workload to baseline AWS EC2 t3.medium`;
    }
  }
  // 2. DISK / BLOCK STORAGE
  else if (
    serviceName.includes("disk") ||
    serviceName.includes("storage volume") ||
    serviceName.includes("persistent disk") ||
    serviceName.includes("managed disk") ||
    rawDesc.includes("managed disk") ||
    rawDesc.includes("persistent disk")
  ) {
    targetAwsService = "EBS";
    targetAwsServiceCode = "AmazonEC2";
    targetAwsVolumeType = "gp3";
    rationale = `Mapped block storage disk to high-performance AWS EBS gp3 volume`;
  }
  // 3. OBJECT STORAGE
  else if (
    serviceName.includes("blob") ||
    serviceName.includes("cloud storage") ||
    serviceName.includes("spaces") ||
    serviceName.includes("bucket") ||
    serviceName.includes("s3")
  ) {
    targetAwsService = "S3";
    targetAwsServiceCode = "AmazonS3";
    targetAwsStorageClass = "Standard";
    rationale = `Mapped object storage to Amazon S3 Standard`;
  }
  // 4. DATABASE / SQL
  else if (
    serviceName.includes("sql") ||
    serviceName.includes("database") ||
    serviceName.includes("cosmos") ||
    serviceName.includes("cloud sql") ||
    serviceName.includes("postgres") ||
    serviceName.includes("mysql")
  ) {
    targetAwsService = "RDS";
    targetAwsServiceCode = "AmazonRDS";
    targetAwsInstanceType = "db.t3.medium";
    targetAwsEngine = rawDesc.includes("postgres") || serviceName.includes("postgres") ? "PostgreSQL" : "MySQL";
    rationale = `Mapped managed database to AWS RDS ${targetAwsEngine} (db.t3.medium)`;
  }
  // 5. LOAD BALANCER
  else if (serviceName.includes("load balancer") || serviceName.includes("load balancing") || serviceName.includes("app gateway")) {
    targetAwsService = "ALB";
    targetAwsServiceCode = "AWSELB";
    rationale = `Mapped load balancing traffic to AWS Application Load Balancer`;
  }
  // 6. NAT GATEWAY / NETWORK
  else if (serviceName.includes("nat") || serviceName.includes("gateway")) {
    targetAwsService = "NAT Gateway";
    targetAwsServiceCode = "AmazonEC2";
    rationale = `Mapped outbound NAT traffic to AWS NAT Gateway`;
  }
  // 7. PUBLIC IP / EGRESS
  else if (serviceName.includes("ip") || serviceName.includes("public ipv4") || serviceName.includes("pip")) {
    targetAwsService = "Public IPv4";
    targetAwsServiceCode = "AmazonVPC";
    rationale = `Mapped static public IP to AWS Public IPv4 Address`;
  }
  // 8. SERVERLESS FUNCTIONS
  else if (serviceName.includes("function") || serviceName.includes("cloud run") || serviceName.includes("lambda")) {
    targetAwsService = "Lambda";
    targetAwsServiceCode = "AWSLambda";
    rationale = `Mapped serverless compute to AWS Lambda`;
  }
  // 9. DNS / CDN
  else if (serviceName.includes("dns")) {
    targetAwsService = "Route 53";
    targetAwsServiceCode = "AmazonRoute53";
    rationale = `Mapped DNS routing to Amazon Route 53`;
  } else if (serviceName.includes("cdn") || serviceName.includes("front door")) {
    targetAwsService = "CloudFront";
    targetAwsServiceCode = "AmazonCloudFront";
    rationale = `Mapped content delivery to Amazon CloudFront`;
  }
  // 10. KEY VAULT / SECRETS
  else if (serviceName.includes("key vault") || serviceName.includes("kms") || serviceName.includes("secret")) {
    targetAwsService = "KMS";
    targetAwsServiceCode = "AWSKMS";
    rationale = `Mapped encryption / key vault to AWS Key Management Service (KMS)`;
  }
  // DEFAULT
  else {
    targetAwsService = sourceResource.service || "EC2";
    targetAwsServiceCode = sourceResource.serviceCode || "AmazonEC2";
    rationale = `Mapped resource to matching AWS ${targetAwsService} service`;
  }

  return {
    targetAwsService,
    targetAwsServiceCode,
    targetAwsInstanceType,
    targetAwsVolumeType,
    targetAwsStorageClass,
    targetAwsEngine,
    targetAwsRegion: mapToAWSRegion(sourceResource.sourceRegion || sourceResource.region),
    migrationRationale: rationale,
  };
}

module.exports = {
  REGION_MAPPING,
  AZURE_VM_MAPPING,
  GCP_MACHINE_MAPPING,
  DO_DROPLET_MAPPING,
  findClosestEC2Instance,
  mapToAWSRegion,
  detectCloudProvider,
  resolveAWSEquivalent,
};

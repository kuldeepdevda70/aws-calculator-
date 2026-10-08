const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Candidate models supported by Google GenAI API
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
].filter(Boolean);

const FALLBACK_MODELS = [...new Set(CANDIDATE_MODELS)];

// Helper delay function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function identifyMultiCloudResources(billText, specifiedProvider = null) {
  if (!billText || !billText.trim()) {
    throw new Error("Bill text is empty");
  }

  const prompt = `
You are an expert Cloud Billing Extraction & AWS Cost Calculation Engine.

Analyze the cloud billing document text below dynamically. The bill may be an AWS bill OR a multi-cloud bill (Azure, GCP, DigitalOcean, Hostinger, Oracle, On-Premises).

CRITICAL INSTRUCTIONS:
1. DETECT THE SOURCE CLOUD PROVIDER:
   - Identify the source provider dynamically from the bill header/text ("AWS", "Azure", "GCP", "DigitalOcean", "Hostinger", etc.).

2. DETECT THE BILLING CURRENCY ACCURATELY:
   - Identify the currency of the document:
     * Indian Rupee (INR / ₹) if bill contains ₹, INR, Rs., GSTIN, Indian tax, etc.
     * US Dollar (USD / $) if bill is in USD or $
     * Euro (EUR / €)
     * British Pound (GBP / £)
     * Australian Dollar (AUD / A$)
     * Canadian Dollar (CAD / C$)
   - Return detectedCurrency (e.g. "INR", "USD", "EUR", "GBP") and currencySymbol (e.g. "₹", "$", "€", "£").

3. EXTRACT EVERY REAL LINE ITEM / WORKLOAD DYNAMICALLY:
   - Extract EVERY individual billed service, resource, and charge from the document.
   - Do NOT omit any billed line item.
   - Do NOT invent or hallucinate services that are not in the document.

4. FOR EVERY EXTRACTED RESOURCE, RETURN:
   - sourceProvider: string ("AWS", "Azure", "GCP", "DigitalOcean", "Hostinger", etc.)
   - sourceServiceName: string (e.g. "Elastic Compute Cloud", "Relational Database Service", "CloudWatch", "Virtual Private Cloud", "Secrets Manager", "Simple Storage Service", "Virtual Machines", "Compute Engine", "VPS", "Azure Database for MySQL")
   - sourceSku: string or null (e.g. "t3.micro", "t2.small", "Standard_D2s_v3", "db.t3.small", "gp2", "gp3", "db.r6g.large", "Memory Optimized Compute vCore")
   - sourceCost: numeric amount in the ORIGINAL DOCUMENT CURRENCY (e.g., if bill is in INR ₹12909.68, return 12909.68, DO NOT convert or assume it is USD!)
   - sourceCurrency: string ("INR", "USD", "EUR", "GBP", etc.)
   - sourceCurrencySymbol: string ("₹", "$", "€", "£", etc.)
   - usageAmount: exact numeric quantity from the bill (e.g. 743.092, 5821.22, 135473, 149937, 744, 414.75, 1152)
   - usageUnit: string (e.g. "Hrs", "vCore-Hrs", "GB-Mo", "LCU-Hrs", "Metrics", "Requests", "GB", "Secrets", "Keys", "Alarms", "HostedZone")
   - unitRate: numeric unit price if present on the line (in document currency)
   - unitDivisor: numeric divisor for rates billed per batch (e.g. 10000 for "per 10,000 requests", 1000 for "per 1,000 requests", 1 for standard per-unit)
   - sourceRegion: string (e.g. "Asia Pacific (Mumbai)", "IN Central", "Central India", "US East (N. Virginia)", "East US")
   - instanceType: string or null
   - operatingSystem: string or null ("Linux", "Windows")
   - engine: string or null ("PostgreSQL", "MySQL")
   - volumeType: string or null ("gp3", "gp2", "snapshot")
   - storageClass: string or null ("Standard")
   - rawDescription: string (exact line description from the bill)

5. DYNAMIC AWS TARGET MAPPING:
   - targetAwsService: string (e.g. "EC2", "RDS", "EBS", "CloudWatch", "ALB", "NLB", "Public IPv4", "ECR", "Data Transfer", "Secrets Manager", "KMS", "WAF", "SQS", "S3", "Route 53", "Lambda", "Systems Manager")
   - targetAwsServiceCode: string (e.g. "AmazonEC2", "AmazonRDS", "AmazonCloudWatch", "AWSELB", "AmazonVPC", "AmazonECR", "AWSDataTransfer", "SecretsManager", "AWSKMS", "WAFV2", "AmazonSQS", "AmazonS3", "AmazonRoute53", "AWSLambda", "AWSSystemsManager")
   - targetAwsInstanceType: string or null (e.g. "db.r6g.large", "t3.medium", "m5.large", "db.t3.small")
   - targetAwsVolumeType: string or null
   - targetAwsEngine: string or null
   - targetAwsRegion: standard AWS region code (e.g. "ap-south-1", "us-east-1", "ap-southeast-1", "eu-west-1")
   - migrationRationale: string
   - confidence: number (0.0 to 1.0)

Return clean JSON matching:
{
  "detectedProvider": "Azure",
  "detectedCurrency": "INR",
  "currencySymbol": "₹",
  "resources": [ ... ]
}

BILL DOCUMENT TEXT:
${billText}
`;

  let lastError = null;

  for (const modelName of FALLBACK_MODELS) {
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`🤖 Attempting Gemini extraction with model: ${modelName} (attempt ${attempts}/${maxAttempts})...`);

        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        if (!response.text) {
          throw new Error(`Model ${modelName} returned empty text`);
        }

        const parsed = JSON.parse(response.text);
        console.log(`✅ Gemini successfully extracted ${parsed.resources?.length || 0} items using ${modelName}`);
        return parsed;
      } catch (err) {
        console.warn(`⚠️ Gemini model ${modelName} (attempt ${attempts}) failed: ${err.message}`);
        lastError = err;

        const isTransient = /503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED/i.test(err.message);
        if (isTransient && attempts < maxAttempts) {
          console.log(`⏳ Model ${modelName} is temporarily busy. Retrying in 2 seconds...`);
          await sleep(2000);
        } else {
          break; // Move to next model
        }
      }
    }
  }

  throw new Error(`All Gemini AI models failed. Last error: ${lastError?.message}`);
}

module.exports = {
  identifyAWSResources: identifyMultiCloudResources,
  identifyMultiCloudResources,
};

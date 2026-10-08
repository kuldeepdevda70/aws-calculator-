const { GetProductsCommand } = require("@aws-sdk/client-pricing");
const { pricingClient } = require("./awsPricingClient");
const { extractOnDemandPrice } = require("./priceExtractor");

// AWS Pricing API filters on the human-readable region name, not the region
// code. This is the reverse of the map in awsPricing.js's REGION_CODES.
const REGION_NAMES = {
  "us-east-1": "US East (N. Virginia)",
  "us-west-2": "US West (Oregon)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "eu-west-1": "Europe (Ireland)",
  "eu-central-1": "Europe (Frankfurt)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
  "sa-east-1": "South America (Sao Paulo)",
};

/**
 * Query AWS Price List API for a product matching the given service code,
 * region, and TERM_MATCH filters, and return its on-demand USD price.
 *
 * This is the piece awsPricing.js's getAWSProductPrice() actually calls —
 * it was missing before (productMatcher.js had serviceDiscovery.js's content
 * copy-pasted into it instead of this).
 */
async function findProductPrice({ serviceCode, region, filters = [] }) {
  const regionName = REGION_NAMES[region];

  if (!regionName) {
    throw new Error(`No AWS Pricing API region name mapped for region code: ${region}`);
  }

  const command = new GetProductsCommand({
    ServiceCode: serviceCode,
    Filters: [
      ...filters,
      { Type: "TERM_MATCH", Field: "location", Value: regionName },
    ],
    MaxResults: 100,
  });

  const response = await pricingClient.send(command);

  if (!response.PriceList || response.PriceList.length === 0) {
    // If no results with the region filter, try without it for global services
    if (regionName !== "Any") {
      console.log(
        `📦 ${serviceCode}: No results in ${regionName}, trying global query without region filter...`
      );
      
      const globalCommand = new GetProductsCommand({
        ServiceCode: serviceCode,
        Filters,
        MaxResults: 100,
      });

      const globalResponse = await pricingClient.send(globalCommand);
      
      if (globalResponse.PriceList && globalResponse.PriceList.length > 0) {
        console.log(
          `📦 ${serviceCode}: Found ${globalResponse.PriceList.length} global product(s) without region filter`
        );
        return extractOnDemandPrice(globalResponse.PriceList);
      }
    }

    throw new Error(
      `No AWS products found for ${serviceCode} in ${regionName} with filters: ${JSON.stringify(filters)}`
    );
  }

  // Unconditional (not just on failure) — log the actual shape of the first
  // returned product so a "No on-demand" failure is diagnosable from the
  // very next run, regardless of how many resources hit it.
  try {
    const first = typeof response.PriceList[0] === "string"
      ? JSON.parse(response.PriceList[0])
      : response.PriceList[0];

    console.log(
      `📦 ${serviceCode}: ${response.PriceList.length} product(s) returned. First product shape:`,
      JSON.stringify({
        sku: first?.product?.sku,
        productFamily: first?.product?.productFamily,
        topLevelKeys: Object.keys(first || {}),
        termsKeys: first?.terms ? Object.keys(first.terms) : "NO 'terms' KEY AT ALL",
      })
    );
  } catch (logErr) {
    console.log(`📦 ${serviceCode}: ${response.PriceList.length} product(s) returned, but couldn't inspect first one: ${logErr.message}`);
  }

  return extractOnDemandPrice(response.PriceList);
}

module.exports = { findProductPrice, REGION_NAMES };
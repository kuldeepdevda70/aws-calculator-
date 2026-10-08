const { PricingClient } = require("@aws-sdk/client-pricing");
require("dotenv").config();

/**
 * AWS Price List Query API is normally queried through a pricing endpoint
 * rather than the workload region. Keep this separate from the bill region.
 */
const pricingClient = new PricingClient({
  region: process.env.AWS_PRICING_API_REGION || "us-east-1",
});

module.exports = { pricingClient };

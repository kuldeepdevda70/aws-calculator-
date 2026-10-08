const { GetAttributeValuesCommand } = require("@aws-sdk/client-pricing");
const { pricingClient } = require("./awsPricingClient");
const { getServiceMetadata } = require("./serviceDiscovery");

async function getAttributeNames(serviceCode) {
  const metadata = await getServiceMetadata(serviceCode);
  return metadata?.attributeNames || [];
}

// Simple in-memory cache — productFamily values in particular get looked up
// once per service and reused across every resource of that service in a
// single bill (e.g. every EC2 line), so this avoids a GetAttributeValues
// round trip per resource.
const valuesCache = new Map();
const VALUES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getAttributeValues(serviceCode, attributeName, maxResults = 100) {
  const cacheKey = `${serviceCode}::${attributeName}`;
  const cached = valuesCache.get(cacheKey);

  if (cached && Date.now() - cached.at < VALUES_CACHE_TTL_MS) {
    return cached.values;
  }

  const values = [];
  let NextToken;

  do {
    const response = await pricingClient.send(
      new GetAttributeValuesCommand({
        ServiceCode: serviceCode,
        AttributeName: attributeName,
        MaxResults: maxResults,
        ...(NextToken ? { NextToken } : {}),
      })
    );

    for (const item of response.AttributeValues || []) {
      if (item.Value) values.push(item.Value);
    }

    NextToken = response.NextToken;
  } while (NextToken);

  valuesCache.set(cacheKey, { values, at: Date.now() });
  return values;
}

module.exports = {
  getAttributeNames,
  getAttributeValues,
};
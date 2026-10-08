const {
  DescribeServicesCommand,
} = require("@aws-sdk/client-pricing");

const { pricingClient } = require("./awsPricingClient");

let serviceCache = null;
let serviceCacheAt = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * "Elastic Load Balancing" -> "elb", "Virtual Private Cloud" -> "vpc".
 * AWS service codes for these are acronyms (AWSELB, AmazonVPC) that share
 * no substring with the spelled-out name, so the token/containment scoring
 * below never matched them. Building the initials lets the matcher catch
 * exactly this case.
 */
function acronym(text = "") {
  return String(text)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toLowerCase();
}

async function discoverServices({ force = false } = {}) {
  if (!force && serviceCache && Date.now() - serviceCacheAt < CACHE_TTL_MS) {
    return serviceCache;
  }

  const services = [];
  let NextToken;

  do {
    const response = await pricingClient.send(
      new DescribeServicesCommand({
        FormatVersion: "aws_v1",
        MaxResults: 100,
        ...(NextToken ? { NextToken } : {}),
      })
    );

    for (const service of response.Services || []) {
      services.push({
        serviceCode: service.ServiceCode,
        attributeNames: service.AttributeNames || [],
      });
    }

    NextToken = response.NextToken;
  } while (NextToken);

  serviceCache = services;
  serviceCacheAt = Date.now();

  console.log(`✅ AWS Pricing API discovered ${services.length} services`);
  return services;
}

async function getServiceMetadata(serviceCode) {
  const services = await discoverServices();
  return services.find((service) => service.serviceCode === serviceCode) || null;
}

async function resolveDynamicService(serviceText = "") {
  const target = normalize(serviceText);
  if (!target) return null;

  const services = await discoverServices();

  // 1. Exact service-code match
  const exact = services.find((service) => normalize(service.serviceCode) === target);
  if (exact) return { ...exact, matchType: "EXACT", confidence: 1 };

  // 2. Remove common prefixes ("Amazon"/"AWS")
  const strippedTarget = target.replace(/^amazon/, "").replace(/^aws/, "");

  const prefixMatch = services.find((service) => {
    const code = normalize(service.serviceCode);
    const strippedCode = code.replace(/^amazon/, "").replace(/^aws/, "");
    return code === strippedTarget || strippedCode === strippedTarget;
  });
  if (prefixMatch) return { ...prefixMatch, matchType: "PREFIX", confidence: 0.95 };

  // 3. Acronym match — "Elastic Load Balancing" -> "elb" against a
  // prefix-stripped service code like "AWSELB" -> "elb".
  const targetAcronym = acronym(serviceText);

  if (targetAcronym.length >= 2) {
    const acronymMatch = services.find((service) => {
      const strippedCode = normalize(service.serviceCode)
        .replace(/^amazon/, "")
        .replace(/^aws/, "");
      return strippedCode === targetAcronym;
    });
    if (acronymMatch) {
      return { ...acronymMatch, matchType: "ACRONYM", confidence: 0.9 };
    }
  }

  // 4. Token-based fuzzy matching
  const targetTokens = String(serviceText)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let bestMatch = null;
  let bestScore = 0;

  for (const service of services) {
    const code = normalize(service.serviceCode);
    let score = 0;

    if (code.includes(target) || target.includes(code)) {
      score += 0.7;
    }

    for (const token of targetTokens) {
      if (token.length < 2) continue;
      if (code.includes(token)) score += 0.15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = service;
    }
  }

  if (bestMatch && bestScore >= 0.7) {
    return {
      ...bestMatch,
      matchType: "FUZZY",
      confidence: Math.min(Number(bestScore.toFixed(2)), 0.94),
    };
  }

  return null;
}

module.exports = {
  discoverServices,
  getServiceMetadata,
  resolveDynamicService,
};
const { GetProductsCommand } = require("@aws-sdk/client-pricing");
const { pricingClient } = require("./awsPricingClient");

// Cache discovered products
const productCache = new Map();

/**
 * Dynamically discover AWS product from usage type
 * Searches AWS Pricing API using the usage type as a text match
 */
async function discoverProductFromUsage(usageType, region, serviceCode = null) {
  if (!usageType) return null;
  
  const cacheKey = `${usageType}:${region}:${serviceCode || 'any'}`;
  if (productCache.has(cacheKey)) {
    return productCache.get(cacheKey);
  }

  // Remove common prefixes to get clean search terms
  const cleanUsage = usageType
    .replace(/^(APS3|USE1|USE2|USW2|EUC1|APN1|APS1|APS2|SAE1|CAC1|MES1|AFS1)-/i, '')
    .replace(/^[a-z]{2}-[a-z]+-\d+-/i, '');
  
  // Build search filters
  const filters = [
    { Type: "TERM_MATCH", Field: "location", Value: getRegionName(region) }
  ];

  // Add service code filter if provided
  if (serviceCode) {
    filters.push({ Type: "TERM_MATCH", Field: "serviceCode", Value: serviceCode });
  }

  // Search for products with description containing the usage type
  try {
    const command = new GetProductsCommand({
      ServiceCode: serviceCode || undefined,
      Filters: filters,
      MaxResults: 100,
    });

    const response = await pricingClient.send(command);
    
    if (!response.PriceList || response.PriceList.length === 0) {
      productCache.set(cacheKey, null);
      return null;
    }

    // Parse and score products
    const scoredProducts = [];
    
    for (const priceString of response.PriceList) {
      let product;
      try {
        product = typeof priceString === 'string' ? JSON.parse(priceString) : priceString;
      } catch {
        continue;
      }

      const attributes = product?.product?.attributes || {};
      const description = attributes?.description || attributes?.skuDescription || '';
      const productFamily = product?.product?.productFamily || '';
      const termType = Object.keys(product?.terms || {});
      
      // Calculate relevance score
      let score = 0;
      const searchTerms = cleanUsage.split(/[:\.\-]/);
      
      for (const term of searchTerms) {
        if (term.length < 2) continue;
        
        // Check if term appears in description or product family
        if (description.toLowerCase().includes(term.toLowerCase())) {
          score += 10;
        }
        if (productFamily.toLowerCase().includes(term.toLowerCase())) {
          score += 5;
        }
        if (attributes?.usageType?.toLowerCase().includes(term.toLowerCase())) {
          score += 8;
        }
        if (attributes?.operation?.toLowerCase().includes(term.toLowerCase())) {
          score += 6;
        }
        
        // Specific matching for known patterns
        if (term.match(/^t\d+\.\w+$/i)) {
          // Instance type match
          score += 20;
        }
        if (term.match(/^db\./i)) {
          score += 15;
        }
        if (term.toLowerCase() === 'gp2' || term.toLowerCase() === 'gp3' || term.toLowerCase() === 'io1') {
          score += 15;
        }
        if (term.toLowerCase() === 'linux' || term.toLowerCase() === 'windows') {
          score += 10;
        }
        if (term.toLowerCase() === 'natgateway' || term.toLowerCase() === 'publicipv4') {
          score += 10;
        }
      }

      // Boost score for OnDemand products
      if (termType.includes('OnDemand')) {
        score += 30;
      }

      // Boost score for products with valid USD price
      let hasUsdPrice = false;
      if (product?.terms?.OnDemand) {
        for (const term of Object.values(product.terms.OnDemand)) {
          for (const dimension of Object.values(term?.priceDimensions || {})) {
            if (dimension?.pricePerUnit?.USD) {
              hasUsdPrice = true;
              break;
            }
          }
          if (hasUsdPrice) break;
        }
      }
      if (hasUsdPrice) score += 20;

      scoredProducts.push({
        product,
        score,
        description,
        productFamily,
        termType,
        hasUsdPrice,
        attributes,
        sku: product?.product?.sku,
      });
    }

    // Sort by score descending
    scoredProducts.sort((a, b) => b.score - a.score);

    if (scoredProducts.length === 0 || scoredProducts[0].score === 0) {
      productCache.set(cacheKey, null);
      return null;
    }

    // Return the best match
    const best = scoredProducts[0];
    console.log(`✅ Discovered product for "${usageType}": ${best.productFamily} (score: ${best.score})`);
    console.log(`   Description: ${best.description}`);

    const result = {
      product: best.product,
      productFamily: best.productFamily,
      description: best.description,
      serviceCode: best.product?.product?.productFamily ? 
        best.product.product.productFamily.replace(/\s/g, '') : 
        'Unknown',
      attributes: best.attributes,
      sku: best.sku,
      score: best.score,
      termType: best.termType,
    };

    productCache.set(cacheKey, result);
    return result;
    
  } catch (error) {
    console.error(`Error discovering product from usage:`, error.message);
    productCache.set(cacheKey, null);
    return null;
  }
}

function getRegionName(region) {
  const regionMap = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-1': 'US West (N. California)',
    'us-west-2': 'US West (Oregon)',
    'ap-south-1': 'Asia Pacific (Mumbai)',
    'ap-southeast-1': 'Asia Pacific (Singapore)',
    'ap-southeast-2': 'Asia Pacific (Sydney)',
    'ap-northeast-1': 'Asia Pacific (Tokyo)',
    'ap-northeast-2': 'Asia Pacific (Seoul)',
    'eu-west-1': 'Europe (Ireland)',
    'eu-west-2': 'Europe (London)',
    'eu-west-3': 'Europe (Paris)',
    'eu-central-1': 'Europe (Frankfurt)',
    'eu-north-1': 'Europe (Stockholm)',
    'sa-east-1': 'South America (Sao Paulo)',
    'ca-central-1': 'Canada (Central)',
    'me-south-1': 'Middle East (Bahrain)',
    'af-south-1': 'Africa (Cape Town)',
  };
  return regionMap[region] || region;
}

module.exports = { discoverProductFromUsage };
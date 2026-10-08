function extractOnDemandPrice(priceList = []) {
  if (!priceList || priceList.length === 0) {
    throw new Error("Empty price list provided to extractOnDemandPrice");
  }

  const seenShapes = [];
  let fallbackPrice = null; // Reserve a Reserved Instance price as fallback
  let allDimensions = []; // Track all dimensions found for diagnostics

  for (const priceString of priceList) {
    let product;

    try {
      product = typeof priceString === "string"
        ? JSON.parse(priceString)
        : priceString;
    } catch (parseErr) {
      console.log(`⚠️ Could not parse product: ${parseErr.message}`);
      continue;
    }

    if (!product) continue;

    // ----- TRY: OnDemand pricing first -----
    const onDemandTerms = product?.terms?.OnDemand;
    if (onDemandTerms) {
      for (const term of Object.values(onDemandTerms)) {
        for (const dimension of Object.values(term?.priceDimensions || {})) {
          const usd = dimension?.pricePerUnit?.USD;
          
          if (usd !== undefined && usd !== "") {
            allDimensions.push({
              type: "OnDemand",
              unit: dimension.unit,
              price: Number(usd),
            });

            return {
              price: Number(usd),
              unit: dimension.unit,
              description: dimension.description,
              sku: product?.product?.sku,
              productFamily: product?.product?.productFamily,
              attributes: product?.product?.attributes || {},
              offerTermCode: term?.offerTermCode,
              beginRange: dimension?.beginRange,
              endRange: dimension?.endRange,
              rateCode: dimension?.rateCode,
              pricingModel: "OnDemand",
            };
          }
        }
      }
    }

    // ----- FALLBACK: Reserved Instance pricing (1-year non-convertible) -----
    if (!fallbackPrice) {
      const reservedTerms = product?.terms?.Reserved;
      if (reservedTerms) {
        // Look for 1yr, all-upfront Reserved Instance pricing
        for (const term of Object.values(reservedTerms)) {
          const termDesc = (term?.description || "").toLowerCase();
          // Match "1yr all upfront" or similar patterns
          if (termDesc.includes("1yr") && termDesc.includes("all upfront")) {
            for (const dimension of Object.values(term?.priceDimensions || {})) {
              const usd = dimension?.pricePerUnit?.USD;
              if (usd !== undefined && usd !== "") {
                // Convert 1yr price to hourly equivalent
                const hourlyPrice = Number(usd) / 8760; // 365 * 24 hours
                
                allDimensions.push({
                  type: "Reserved-1yr",
                  unit: dimension.unit,
                  price: Number(usd),
                  hourlyEquivalent: hourlyPrice,
                });

                if (!fallbackPrice || hourlyPrice < fallbackPrice.price) {
                  fallbackPrice = {
                    price: hourlyPrice,
                    unit: "Hrs",
                    description: `Reserved Instance (${term?.description || "1yr all-upfront"}) - hourly equivalent`,
                    sku: product?.product?.sku,
                    productFamily: product?.product?.productFamily,
                    attributes: product?.product?.attributes || {},
                    offerTermCode: term?.offerTermCode,
                    rateCode: dimension?.rateCode,
                    pricingModel: "Reserved-1yr-AllUpfront",
                  };
                }
              }
            }
          }
        }
      }
    }

    // Collect a small sample of structure for diagnostics
    if (seenShapes.length < 3) {
      seenShapes.push({
        sku: product?.product?.sku,
        productFamily: product?.product?.productFamily,
        termsAvailable: product?.terms ? Object.keys(product.terms) : "none",
        hasOnDemand: !!product?.terms?.OnDemand,
        hasReserved: !!product?.terms?.Reserved,
      });
    }
  }

  // ----- If we found a Reserved price fallback, use it -----
  if (fallbackPrice) {
    console.log(
      `📦 No OnDemand pricing found, falling back to Reserved Instance pricing: $${fallbackPrice.price.toFixed(6)}/hr`
    );
    return fallbackPrice;
  }

  // ----- Total failure: no pricing found in any model -----
  console.log(`⚠️ extractOnDemandPrice: Examined ${priceList.length} product(s)`);
  console.log(`⚠️ Found ${allDimensions.length} dimensions across all products:`, 
    JSON.stringify(allDimensions.slice(0, 5))); // Show first 5
  console.log(`⚠️ Sample product structures:`, JSON.stringify(seenShapes, null, 2));

  throw new Error(
    `No on-demand or reserved USD price dimension found (examined ${priceList.length} product(s), found ${allDimensions.length} dimensions)`
  );
}

module.exports = { extractOnDemandPrice };
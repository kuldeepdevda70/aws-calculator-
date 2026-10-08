// src/services/currency/currencyConverter.js
// Universal Multi-Cloud Currency Detection and Conversion Engine

const CURRENCY_RATES_TO_USD = {
  USD: 1.0,
  INR: 0.011905,  // 1 USD = 84.00 INR (1 INR = $0.011905 USD)
  EUR: 1.085,     // 1 EUR = $1.085 USD
  GBP: 1.285,     // 1 GBP = $1.285 USD
  AUD: 0.655,     // 1 AUD = $0.655 USD
  CAD: 0.735,     // 1 CAD = $0.735 USD
  SGD: 0.760,     // 1 SGD = $0.760 USD
  JPY: 0.0066,    // 1 JPY = $0.0066 USD (~151.5 JPY/USD)
  BRL: 0.180,     // 1 BRL = $0.180 USD
  AED: 0.2723,    // 1 AED = $0.2723 USD
  CNY: 0.138,     // 1 CNY = $0.138 USD
  CHF: 1.130,     // 1 CHF = $1.130 USD
};

const CURRENCY_SYMBOLS = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  JPY: "¥",
  BRL: "R$",
  AED: "AED",
  CNY: "¥",
  CHF: "CHF",
};

const CURRENCY_NAMES = {
  USD: "US Dollar",
  INR: "Indian Rupee",
  EUR: "Euro",
  GBP: "British Pound",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  SGD: "Singapore Dollar",
  JPY: "Japanese Yen",
  BRL: "Brazilian Real",
  AED: "UAE Dirham",
  CNY: "Chinese Yuan",
  CHF: "Swiss Franc",
};

/**
 * Detects currency from bill text or metadata
 */
function detectCurrency(text = "", explicitCurrency = null) {
  if (explicitCurrency && CURRENCY_RATES_TO_USD[explicitCurrency.toUpperCase()]) {
    const code = explicitCurrency.toUpperCase();
    return {
      code,
      symbol: CURRENCY_SYMBOLS[code] || "$",
      name: CURRENCY_NAMES[code] || code,
      rateToUSD: CURRENCY_RATES_TO_USD[code],
    };
  }

  const str = String(text);

  // Check Indian Rupee (₹, INR, Rs., Rs, GSTIN, India)
  if (
    /₹|INR|\bRs\.?\b|Rupees?|\bGSTIN\b|State Code:\s*\d+/i.test(str) ||
    /Central GST|State GST|Integrated GST|CGST|SGST|IGST/i.test(str)
  ) {
    return {
      code: "INR",
      symbol: "₹",
      name: "Indian Rupee",
      rateToUSD: CURRENCY_RATES_TO_USD.INR,
    };
  }

  // Check Euro (€, EUR)
  if (/€|\bEUR\b|Euro/i.test(str)) {
    return {
      code: "EUR",
      symbol: "€",
      name: "Euro",
      rateToUSD: CURRENCY_RATES_TO_USD.EUR,
    };
  }

  // Check British Pound (£, GBP)
  if (/£|\bGBP\b|Pound Sterling/i.test(str)) {
    return {
      code: "GBP",
      symbol: "£",
      name: "British Pound",
      rateToUSD: CURRENCY_RATES_TO_USD.GBP,
    };
  }

  // Check Australian Dollar (A$, AUD)
  if (/A\$|\bAUD\b/i.test(str)) {
    return {
      code: "AUD",
      symbol: "A$",
      name: "Australian Dollar",
      rateToUSD: CURRENCY_RATES_TO_USD.AUD,
    };
  }

  // Check Canadian Dollar (C$, CAD)
  if (/C\$|\bCAD\b/i.test(str)) {
    return {
      code: "CAD",
      symbol: "C$",
      name: "Canadian Dollar",
      rateToUSD: CURRENCY_RATES_TO_USD.CAD,
    };
  }

  // Check Japanese Yen (¥, JPY)
  if (/¥|\bJPY\b|Yen/i.test(str)) {
    return {
      code: "JPY",
      symbol: "¥",
      name: "Japanese Yen",
      rateToUSD: CURRENCY_RATES_TO_USD.JPY,
    };
  }

  // Check Singapore Dollar (S$, SGD)
  if (/S\$|\bSGD\b/i.test(str)) {
    return {
      code: "SGD",
      symbol: "S$",
      name: "Singapore Dollar",
      rateToUSD: CURRENCY_RATES_TO_USD.SGD,
    };
  }

  // Check UAE Dirham (AED)
  if (/\bAED\b|Dirham/i.test(str)) {
    return {
      code: "AED",
      symbol: "AED",
      name: "UAE Dirham",
      rateToUSD: CURRENCY_RATES_TO_USD.AED,
    };
  }

  // Default to USD
  return {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    rateToUSD: 1.0,
  };
}

/**
 * Converts any currency amount to USD
 */
function toUSD(amount, fromCurrency = "USD") {
  const code = String(fromCurrency || "USD").toUpperCase();
  const rate = CURRENCY_RATES_TO_USD[code] || 1.0;
  return Number((Number(amount || 0) * rate).toFixed(6));
}

/**
 * Converts USD amount to target currency
 */
function fromUSD(amountUSD, toCurrency = "USD") {
  const code = String(toCurrency || "USD").toUpperCase();
  const rate = CURRENCY_RATES_TO_USD[code] || 1.0;
  if (rate === 0) return 0;
  return Number((Number(amountUSD || 0) / rate).toFixed(6));
}

/**
 * Converts between any two supported currencies
 */
function convertCurrency(amount, fromCurrency, toCurrency) {
  const usd = toUSD(amount, fromCurrency);
  return fromUSD(usd, toCurrency);
}

/**
 * Formats amount with appropriate currency symbol
 */
function formatCurrency(amount, currencyCode = "USD", decimals = 2) {
  const code = String(currencyCode || "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] || "$";
  const num = Number(amount || 0);
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (code === "AED") {
    return `${symbol} ${formatted}`;
  }
  return `${symbol}${formatted}`;
}

module.exports = {
  CURRENCY_RATES_TO_USD,
  CURRENCY_SYMBOLS,
  CURRENCY_NAMES,
  detectCurrency,
  toUSD,
  fromUSD,
  convertCurrency,
  formatCurrency,
};

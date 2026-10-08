const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const { calculateAll } = require("../services/calculator");
const { parseBillFile } = require("../services/billParser");

router.post("/calculate", async (req, res) => {
  try {
    const { resources, billingPeriod, detectedCurrency, currencySymbol, exchangeRateToUSD } = req.body;
    
    if (!resources || resources.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No resources provided for calculation",
      });
    }

    if (detectedCurrency) resources.detectedCurrency = detectedCurrency;
    if (currencySymbol) resources.currencySymbol = currencySymbol;
    if (exchangeRateToUSD) resources.exchangeRateToUSD = exchangeRateToUSD;

    const result = await calculateAll(resources, billingPeriod);
    res.json(result);
  } catch (error) {
    console.error("Calculation API error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/upload-bill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const cloudProvider = req.body.cloudProvider || "auto";
    const billingPeriod = req.body.billingPeriod ? JSON.parse(req.body.billingPeriod) : null;
    
    const parsedResources = await parseBillFile(req.file.buffer, cloudProvider, billingPeriod);
    const detectedProvider = parsedResources.detectedProvider || cloudProvider;

    res.json({
      success: true,
      cloudProvider: detectedProvider,
      detectedProvider,
      detectedCurrency: parsedResources.detectedCurrency || "USD",
      currencySymbol: parsedResources.currencySymbol || "$",
      currencyName: parsedResources.currencyName || "US Dollar",
      exchangeRateToUSD: parsedResources.exchangeRateToUSD || 1.0,
      resources: parsedResources,
      billingPeriod: parsedResources.billingPeriod || billingPeriod,
    });
  } catch (error) {
    console.error("Upload bill API error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "Multi-Cloud to AWS Migration Cost Estimator",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const apiRoutes = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.use("/api", apiRoutes);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 AWS Cost Calculator API is ready`);
});

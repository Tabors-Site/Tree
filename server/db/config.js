const mongoose = require("mongoose");
require("dotenv").config();
const mongooseUri = process.env.MONGODB_LOCAL;

mongoose
  .connect(mongooseUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

module.exports = mongoose;

const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const TransactionSchema = new mongoose.Schema({
    _id: {
        type: String, 
        default: uuidv4, 
      },
    nodeAId: { type: String, ref: "Node", required: true }, // First node in the transaction
    nodeBId: { type: String, ref: "Node", required: true }, // Second node in the transaction
    versionAIndex: { type: Number, required: true }, // Version index of Node A involved in the transaction
    versionBIndex: { type: Number, required: true }, // Version index of Node B involved in the transaction
    valuesTraded: { 
      nodeA: { type: Map, of: Number, required: true }, 
      nodeB: { type: Map, of: Number, required: true }, 
    },
    date: { type: Date, default: Date.now }, 
  });
  
  const Transaction = mongoose.model("Transaction", TransactionSchema);
  module.exports = Transaction;
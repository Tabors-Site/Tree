/**
 * Re-exports from the transactions extension.
 * Falls back to stubs if the extension is not installed.
 */

const notInstalled = () => { throw new Error("Transactions extension not installed"); };

let mod;
try {
  mod = await import("../../extensions/transactions/core.js");
} catch {
  mod = {
    setTransactionPolicy: notInstalled,
    createTransaction: notInstalled,
    getTransactions: notInstalled,
    executeTransaction: notInstalled,
    buildApprovalGroups: notInstalled,
    applyApproval: notInstalled,
    denyTransaction: notInstalled,
    checkAllGroupsResolved: () => false,
    getTransactionWithContributions: notInstalled,
  };
}

export const {
  setTransactionPolicy,
  createTransaction,
  getTransactions,
  executeTransaction,
  buildApprovalGroups,
  applyApproval,
  denyTransaction,
  checkAllGroupsResolved,
  getTransactionWithContributions,
} = mod;

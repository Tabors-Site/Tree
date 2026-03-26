import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Stripe from "stripe";
import { processPurchase } from "./core/processPurchase.js";
import { logContribution } from "../../seed/tree/contributions.js";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export async function stripeWebhook(req, res) {
  if (!stripe) return sendError(res, 500, ERR.INTERNAL, "Stripe is not configured");
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
 log.error("Billing", "Webhook signature failed");
    return res.status(400).send("Webhook Error");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const userId = session.metadata.userId;
    const plan = session.metadata.plan || null;
    const energyAmount = Number(session.metadata.energyAmount || 0);

    try {
      await logContribution({
        userId,
        nodeId: "SYSTEM",
        nodeVersion: "0",
        action: "purchase",

        purchaseMeta: {
          stripeSessionId: session.id,
          paymentIntentId: session.payment_intent,
          stripeEventId: event.id,
          plan,
          energyAmount,
          totalCents: session.amount_total,
          currency: session.currency,
        },
      });
    } catch (err) {
      if (
        err?.code === 11000 ||
        err?.message?.toLowerCase().includes("duplicate")
      ) {
 log.verbose("Billing", "Duplicate purchase webhook ignored:", session.id);
        return sendOk(res, { received: true });
      }

 log.error("Billing", "Contribution logging failed:", err);
      return sendError(res, 500, ERR.INTERNAL, "Contribution logging failed");
    }

    await processPurchase({
      userId,
      plan,
      energyAmount,
    });
  }

  sendOk(res, { received: true });
}

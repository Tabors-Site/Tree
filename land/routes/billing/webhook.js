import Stripe from "stripe";
import { processPurchase } from "../../extensions/billing/core/processPurchase.js";
import { logContribution } from "../../db/utils.js";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export async function stripeWebhook(req, res) {
  if (!stripe) return res.status(503).json({ error: "Stripe is not configured" });
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed");
    return res.status(400).send("Webhook Error");
  }

  /* ===============================
     HANDLE EVENTS
  =============================== */

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const userId = session.metadata.userId;
    const plan = session.metadata.plan || null;
    const energyAmount = Number(session.metadata.energyAmount || 0);

    /* ===============================
       ⭐ CREATE PURCHASE CONTRIBUTION
       (IDEMPOTENCY LOCK)
    =============================== */

    try {
      await logContribution({
        userId,
        nodeId: "SYSTEM",      // system-level event
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
      // ⭐ If duplicate Stripe retry, ignore safely
      if (
        err?.code === 11000 ||
        err?.message?.toLowerCase().includes("duplicate")
      ) {
        console.log("Duplicate purchase webhook ignored:", session.id);
        return res.json({ received: true });
      }

      console.error("Contribution logging failed:", err);
      return res.status(500).json({ error: "Contribution logging failed" });
    }

    /* ===============================
       EXISTING LOGIC (UNCHANGED)
    =============================== */

    await processPurchase({
      userId,
      plan,
      energyAmount,
    });
  }

  res.json({ received: true });
}

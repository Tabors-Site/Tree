import Stripe from "stripe";
import User from "../../db/models/user.js";
import { validatePurchase } from "./core/validatePurchase.js";
import { getLandUrl } from "../../canopy/identity.js";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export async function createPurchaseSession(req, res) {
  if (!stripe) return res.status(503).json({ error: "Stripe is not configured" });
  try {
    const { userId, plan, energyAmount } = req.body;

    /* ===============================
       LOAD USER
    =============================== */

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = user.htmlShareToken || "";

    /* ===============================
       PRE-VALIDATE BEFORE STRIPE
    =============================== */

    try {
      validatePurchase(user, { plan, energyAmount });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    /* ===============================
       PRICE CALCULATION (UNCHANGED)
    =============================== */

    let totalCents = 0;

    if (plan === "standard") totalCents += 2000;
    if (plan === "premium") totalCents += 10000;

    if (energyAmount > 0) {
      totalCents += energyAmount * 1;
    }

    if (totalCents <= 0) {
      return res.status(400).json({ error: "Nothing to purchase" });
    }

    /* ===============================
       🔥 SMART PRODUCT NAME (NEW)
    =============================== */

  let productName = "Purchase";

if (plan && energyAmount > 0) {
  // 🔥 PLAN + ENERGY COMBOS
  if (plan === "standard") {
    productName = "Standard Plan — 1 Month + Energy";
  } else if (plan === "premium") {
    productName = "Premium Plan — 1 Month + Energy";
  } else {
    productName = "Plan + Energy Purchase";
  }

} else if (plan === "standard") {
  productName = "Standard Plan — 1 Month";

} else if (plan === "premium") {
  // ⭐ PREMIUM ONLY OPTIONS
  productName = "Premium Plan — 1 Month";

} else if (energyAmount > 0) {
  // ⚡ ENERGY ONLY OPTIONS
  productName = energyAmount >= 500
    ? "Additional Energy Boost"
    : "Additional Energy Boost";
}

    /* ===============================
       STRIPE CHECKOUT SESSION
    =============================== */

    const successUrl =
`${getLandUrl()}/app`;

    const cancelUrl = successUrl;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productName, // ✅ dynamic naming
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],

      metadata: {
        userId,
        plan: plan || "",
        energyAmount: String(energyAmount || 0),
      },

      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}

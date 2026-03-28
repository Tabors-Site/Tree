import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Stripe from "stripe";
import User from "../../seed/models/user.js";
import { validatePurchase } from "./core/validatePurchase.js";
import { getLandUrl } from "../../canopy/identity.js";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export async function createPurchaseSession(req, res) {
  if (!stripe) return sendError(res, 500, ERR.INTERNAL, "Stripe is not configured");
  try {
    const { userId, plan, energyAmount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }

    try {
      validatePurchase(user, { plan, energyAmount });
    } catch (err) {
      return sendError(res, 400, ERR.INVALID_INPUT, err.message);
    }

    let totalCents = 0;

    if (plan === "standard") totalCents += 2000;
    if (plan === "premium") totalCents += 10000;

    if (energyAmount > 0) {
      totalCents += energyAmount * 1;
    }

    if (totalCents <= 0) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Nothing to purchase");
    }

    let productName = "Purchase";

    if (plan && energyAmount > 0) {
      if (plan === "standard") {
        productName = "Standard Plan, 1 Month + Energy";
      } else if (plan === "premium") {
        productName = "Premium Plan, 1 Month + Energy";
      } else {
        productName = "Plan + Energy Purchase";
      }
    } else if (plan === "standard") {
      productName = "Standard Plan, 1 Month";
    } else if (plan === "premium") {
      productName = "Premium Plan, 1 Month";
    } else if (energyAmount > 0) {
      productName = "Additional Energy Boost";
    }

    const successUrl = `${getLandUrl()}/dashboard`;
    const cancelUrl = successUrl;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productName,
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

    sendOk(res, { url: session.url });

  } catch (err) {
 log.error("Billing", "Stripe session error:", err);
    sendError(res, 500, ERR.INTERNAL, "Failed to create checkout session");
  }
}

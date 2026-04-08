const express = require("express");
const { Op } = require("sequelize");
const {
  Activity,
  User,
  Organisation,
  GuestUser,
  Chat,
  ChatMessage,
  Payment,
  ParticipationRequest,
} = require("../model");
const { verifyAuth } = require("../middleware/auth");
const {
  messageInclude,
  serializeMessage,
  buildSystemContent,
  formatUserName,
} = require("../utils/chatHelpers");
const { emitToRoom } = require("../ws/chatServer");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

const router = express.Router();

const getClientBaseUrl = () => {
  const direct =
    process.env.APP_BASE_URL ||
    process.env.CLIENT_BASE_URL ||
    process.env.FRONTEND_URL;
  if (direct) return direct.replace(/\/+$/, "");

  const origins = process.env.CORS_ORIGINS || "";
  const first = origins
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return (first || "http://localhost:5173").replace(/\/+$/, "");
};

const ensureStripeConfigured = (res) => {
  if (stripe) return true;
  res.status(500).json({ error: "Stripe is not configured." });
  return false;
};

const ensureActivityChat = async (activity) => {
  let chat = await activity.getChat();
  if (!chat) {
    chat = await Chat.create();
    await activity.setChat(chat);
  }
  return chat;
};

const countParticipants = async (activity) => {
  const [userCount, guestCount] = await Promise.all([
    activity.countUsers(),
    activity.countGuestUsers(),
  ]);
  return userCount + guestCount;
};

const defaultInclude = [
  {
    model: User,
    as: "hostUser",
    attributes: ["id", "firstname", "lastname", "pseudo"],
  },
  { model: Organisation, as: "hostOrganisation", attributes: ["id", "name"] },
  {
    model: User,
    as: "users",
    attributes: ["id", "firstname", "lastname", "pseudo"],
    through: { attributes: [] },
  },
  {
    model: GuestUser,
    as: "guestUsers",
    attributes: ["id", "name"],
    through: { attributes: [] },
  },
];

const getActivityPrice = (activity) => {
  const raw = activity?.price ?? 0;
  const priceNumber = Number(raw);
  return Number.isFinite(priceNumber) ? priceNumber : 0;
};

router.post("/checkout", verifyAuth, async (req, res) => {
  if (!ensureStripeConfigured(res)) return;
  const activityId = Number(req.body.activityId);
  if (!activityId) {
    return res.status(400).json({ error: "activityId is required" });
  }

  try {
    const activity = await Activity.findByPk(activityId);
    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    const priceNumber = getActivityPrice(activity);
    if (!priceNumber || priceNumber <= 0) {
      return res.status(400).json({ error: "Activity is free" });
    }

    const alreadyJoined = await activity.hasUser(req.user.id);
    if (alreadyJoined) {
      return res.status(400).json({ error: "Already joined" });
    }

    if (activity.private) {
      const existingRequest = await ParticipationRequest.findOne({
        where: { activityId: activity.id, userId: req.user.id },
      });
      if (existingRequest?.status === "pending") {
        return res.status(400).json({ error: "Request already pending" });
      }
      if (existingRequest?.status === "approved") {
        return res.status(400).json({ error: "Already approved" });
      }
    }

    const existingPayment = await Payment.findOne({
      where: {
        userId: req.user.id,
        activityId: activity.id,
        status: { [Op.in]: ["pending", "authorized", "paid"] },
      },
    });
    if (existingPayment) {
      return res.status(400).json({ error: "Payment already started" });
    }

    const seats = Number(activity.seats || 0);
    const participantCount = await countParticipants(activity);
    if (seats > 0 && participantCount >= seats) {
      return res.status(400).json({ error: "Activity is full" });
    }

    const baseUrl = getClientBaseUrl();
    const sessionPayload = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: activity.title,
              description: activity.description?.slice(0, 200) || undefined,
            },
            unit_amount: Math.round(priceNumber * 100),
          },
          quantity: 1,
        },
      ],
      client_reference_id: String(req.user.id),
      metadata: {
        activityId: String(activity.id),
        userId: String(req.user.id),
      },
      success_url: `${baseUrl}/activity/${activity.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/activity/${activity.id}?payment=cancel`,
    };

    if (activity.private) {
      sessionPayload.payment_intent_data = { capture_method: "manual" };
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    try {
      await Payment.create({
        userId: req.user.id,
        activityId: activity.id,
        sessionId: session.id,
        amount: priceNumber,
        currency: "eur",
        status: "pending",
      });
    } catch (err) {
      console.error("Payment record error:", err);
      return res.status(500).json({ error: "Unable to create payment record" });
    }

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(400).json({ error: err.message || "Stripe error" });
  }
});

router.post("/confirm", verifyAuth, async (req, res) => {
  if (!ensureStripeConfigured(res)) return;
  const sessionId = req.body.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const metadata = session.metadata || {};
    const activityId = Number(metadata.activityId);
    const userId = Number(metadata.userId);
    if (!activityId || !userId) {
      return res.status(400).json({ error: "Invalid session metadata" });
    }
    if (userId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const activity = await Activity.findByPk(activityId);
    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    const isPrivate = !!activity.private;

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
    if (isPrivate && !paymentIntentId) {
      return res.status(400).json({ error: "Payment intent missing" });
    }
    if (session.payment_status !== "paid") {
      if (!isPrivate) {
        return res.status(400).json({ error: "Payment not completed" });
      }
      try {
        const paymentIntent =
          await stripe.paymentIntents.retrieve(paymentIntentId);
        if (paymentIntent?.status !== "requires_capture") {
          return res.status(400).json({ error: "Payment not completed" });
        }
      } catch (err) {
        return res
          .status(400)
          .json({ error: err.message || "Payment not completed" });
      }
    }
    const sessionCurrency =
      typeof session.currency === "string" ? session.currency : "eur";
    const amountTotal =
      typeof session.amount_total === "number" ? session.amount_total : null;
    const amountValue =
      amountTotal !== null ? amountTotal / 100 : getActivityPrice(activity);
    const normalizedAmount = Number.isFinite(amountValue)
      ? amountValue
      : getActivityPrice(activity);

    let paymentRecord = await Payment.findOne({ where: { sessionId } });
    if (
      paymentRecord &&
      (paymentRecord.userId !== userId ||
        paymentRecord.activityId !== activityId)
    ) {
      return res.status(400).json({ error: "Invalid payment record" });
    }
    if (paymentRecord?.status === "refunded") {
      return res.status(400).json({ error: "Payment already refunded" });
    }
    if (paymentRecord?.status === "canceled") {
      return res.status(400).json({ error: "Payment was canceled" });
    }

    if (!paymentRecord) {
      paymentRecord = await Payment.create({
        userId,
        activityId,
        sessionId,
        amount: normalizedAmount,
        currency: sessionCurrency,
        status: isPrivate ? "authorized" : "paid",
        paymentIntentId: paymentIntentId || null,
        paidAt: isPrivate ? null : new Date(),
      });
    } else {
      const updates = {
        status: isPrivate ? "authorized" : "paid",
        amount: normalizedAmount,
        currency: sessionCurrency,
      };
      if (paymentIntentId) {
        updates.paymentIntentId = paymentIntentId;
      }
      if (!isPrivate) {
        updates.paidAt = paymentRecord.paidAt || new Date();
      }
      await paymentRecord.update(updates);
    }

    if (isPrivate) {
      const request = await ParticipationRequest.findOne({
        where: { activityId, userId },
      });
      if (request?.status === "approved") {
        return res.json({ status: "approved" });
      }
      if (request) {
        await request.update({
          status: "pending",
          paymentId: paymentRecord.id,
        });
      } else {
        await ParticipationRequest.create({
          activityId,
          userId,
          status: "pending",
          paymentId: paymentRecord.id,
        });
      }

      return res.json({ status: "request_pending" });
    }

    const alreadyJoined = await activity.hasUser(req.user.id);
    if (!alreadyJoined) {
      const seats = Number(activity.seats || 0);
      const participantCount = await countParticipants(activity);
      if (seats > 0 && participantCount >= seats) {
        return res.status(400).json({ error: "Activity is full" });
      }

      await activity.addUser(req.user.id);
      const chat = await ensureActivityChat(activity);
      await chat.addMember(req.user.id);
      try {
        const fullUser = await User.findByPk(req.user.id);
        const displayName = formatUserName(fullUser) || "Un participant";
        const systemContent = buildSystemContent(
          `${displayName} a rejoint l'?v?nement`,
        );
        const systemMessage = await ChatMessage.create({
          chatId: chat.id,
          userId: req.user.id,
          content: systemContent,
        });
        const saved = await ChatMessage.findByPk(systemMessage.id, {
          include: messageInclude,
        });
        if (saved) {
          emitToRoom(activity.id, {
            type: "message",
            message: serializeMessage(saved),
          });
        }
      } catch (err) {
        console.error("System join message error:", err);
      }
    }

    const updated = await Activity.findByPk(activityId, {
      include: defaultInclude,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message || "Stripe error" });
  }
});

module.exports = router;

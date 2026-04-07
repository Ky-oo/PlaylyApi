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

const REFUND_WINDOW_MS = 2 * 60 * 60 * 1000;

const isRefundWindowOpen = (activity) => {
  if (!activity?.date) return false;
  const eventDate = new Date(activity.date);
  if (Number.isNaN(eventDate.getTime())) return false;
  return Date.now() <= eventDate.getTime() - REFUND_WINDOW_MS;
};

const ensureStripeConfigured = (res) => {
  if (stripe) return true;
  res.status(500).json({ error: "Stripe is not configured." });
  return false;
};

const getPaginationParams = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = 13;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildDateRangeFilter = (dateInput) => {
  if (typeof dateInput !== "string" || !dateInput) return null;
  const parts = dateInput.split("-").map((part) => parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part)))
    return null;
  const [year, month, day] = parts;
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { [Op.gte]: start, [Op.lt]: end };
};

const getHostFilters = (query) => {
  const where = {};
  const hostOrganisationId = parseInt(query.hostOrganisationId, 10);
  const hostUserId = parseInt(query.hostUserId, 10);
  const city = typeof query.city === "string" ? query.city.trim() : "";
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const dateFilter = buildDateRangeFilter(query.date);

  if (Number.isInteger(hostOrganisationId)) {
    where.hostOrganisationId = hostOrganisationId;
  }

  if (Number.isInteger(hostUserId)) {
    where.hostUserId = hostUserId;
  }

  if (city && city !== "0") {
    where.city = { [Op.like]: `%${city}%` };
  }

  if (dateFilter) {
    where.date = dateFilter;
  }

  if (search) {
    const likePattern = `%${search}%`;
    where[Op.or] = [
      { title: { [Op.like]: likePattern } },
      { description: { [Op.like]: likePattern } },
      { place_name: { [Op.like]: likePattern } },
      { address: { [Op.like]: likePattern } },
      { city: { [Op.like]: likePattern } },
    ];
  }

  return where;
};

const ensureActivityChat = async (activity) => {
  let chat = await activity.getChat();
  if (!chat) {
    chat = await Chat.create();
    await activity.setChat(chat);
  }
  return chat;
};

const getParticipantCount = (activity) => {
  const userCount = Array.isArray(activity.users) ? activity.users.length : 0;
  const guestCount = Array.isArray(activity.guestUsers)
    ? activity.guestUsers.length
    : 0;
  return userCount + guestCount;
};

const canManageActivity = async (activity, user) => {
  if (!activity || !user) return false;
  if (user.role === "admin") return true;
  if (activity.hostUserId === user.id) return true;
  if (activity.hostOrganisationId) {
    const organisation =
      activity.hostOrganisation ||
      (await Organisation.findByPk(activity.hostOrganisationId));
    return organisation?.ownerId === user.id;
  }
  return false;
};

const addParticipantToActivity = async (activity, userId) => {
  await activity.addUser(userId);
  const chat = await ensureActivityChat(activity);
  await chat.addMember(userId);
  try {
    const fullUser = await User.findByPk(userId);
    const displayName = formatUserName(fullUser) || "Un participant";
    const systemContent = buildSystemContent(
      `${displayName} a rejoint l'événement`,
    );
    const systemMessage = await ChatMessage.create({
      chatId: chat.id,
      userId,
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
};

const validateHost = async (body, user) => {
  if (user.role === "admin") {
    return null;
  }
  const hasUser = !!body.hostUserId;
  const hasOrganisation = !!body.hostOrganisationId;

  if (!hasUser && !hasOrganisation) {
    return "Activity requires hostUserId or hostOrganisationId";
  }
  if (hasUser && hasOrganisation) {
    return "Provide only one of hostUserId or hostOrganisationId";
  }

  if (hasUser && body.hostUserId !== user.id) {
    return "You can only create activities for yourself or your organisations";
  }

  if (hasOrganisation) {
    const organisation = await Organisation.findByPk(body.hostOrganisationId);
    if (!organisation) {
      return "Organisation not found";
    }
    if (organisation.ownerId !== user.id) {
      return "You can only create activities for yourself or your organisations";
    }
  }

  return null;
};

const defaultInclude = [
  {
    model: User,
    as: "hostUser",
    attributes: ["id", "pseudo"],
  },
  { model: Organisation, as: "hostOrganisation" },
  {
    model: User,
    as: "users",
    attributes: ["id", "pseudo"],
    through: { attributes: [] },
  },
  {
    model: GuestUser,
    as: "guestUsers",
    attributes: ["id", "name"],
    through: { attributes: [] },
  },
];

router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const where = getHostFilters(req.query);

    const { rows, count } = await Activity.findAndCountAll({
      include: defaultInclude,
      where,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", verifyAuth, async (req, res) => {
  try {
    const validationError = await validateHost(req.body, req.user);

    if (validationError)
      return res.status(400).json({ error: validationError });

    const activity = await Activity.create(req.body);

    const chat = await ensureActivityChat(activity);
    const isOrganisationHost = !!req.body.hostOrganisationId;
    const isBoardyHost = req.body.hostType === "event";
    const shouldAddCreatorAsParticipant =
      !isOrganisationHost && !isBoardyHost && req.user.role !== "admin";
    if (shouldAddCreatorAsParticipant) {
      await activity.addUser(req.user.id);
    }
    if (shouldAddCreatorAsParticipant || isOrganisationHost || isBoardyHost) {
      await chat.addMember(req.user.id);
    }

    const created = await Activity.findByPk(activity.id, {
      include: defaultInclude,
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id);
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    let isHostOrganisation = false;
    if (activity.hostOrganisationId) {
      const organisation = await Organisation.findByPk(
        activity.hostOrganisationId,
      );
      isHostOrganisation = organisation && organisation.ownerId === req.user.id;
    }

    const isHostUser = activity.hostUserId === req.user.id;
    if (!isHostUser && !isHostOrganisation && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const validationError = await validateHost(
      {
        hostUserId:
          req.body.hostUserId !== undefined
            ? req.body.hostUserId
            : activity.hostUserId,
        hostOrganisationId:
          req.body.hostOrganisationId !== undefined
            ? req.body.hostOrganisationId
            : activity.hostOrganisationId,
      },
      req.user,
    );
    if (validationError)
      return res.status(400).json({ error: validationError });

    await activity.update(req.body);
    const updated = await Activity.findByPk(activity.id, {
      include: defaultInclude,
    });

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/join", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });

    if (!activity) return res.status(404).json({ error: "Activity not found" });

    const alreadyJoined = activity.users.some(
      (user) => user.id === req.user.id,
    );
    if (alreadyJoined) {
      return res.json(activity);
    }

    if (activity.private) {
      return res.status(400).json({ error: "Participation request required" });
    }

    const priceNumber = Number(activity.price || 0);
    if (priceNumber > 0) {
      return res.status(400).json({ error: "Payment required" });
    }

    const participantCount = getParticipantCount(activity);
    if (
      Number.isInteger(activity.seats) &&
      activity.seats > 0 &&
      participantCount >= activity.seats
    ) {
      return res.status(400).json({ error: "Activity is full" });
    }

    await addParticipantToActivity(activity, req.user.id);
    const updated = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    return res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/guest", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (!(await canManageActivity(activity, req.user))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const rawEmail =
      typeof req.body.email === "string" ? req.body.email.trim() : "";
    const email = rawEmail || null;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const participantCount = getParticipantCount(activity);
    if (
      Number.isInteger(activity.seats) &&
      activity.seats > 0 &&
      participantCount >= activity.seats
    ) {
      return res.status(400).json({ error: "Activity is full" });
    }

    let guestUser;
    if (email) {
      const [found] = await GuestUser.findOrCreate({
        where: { email },
        defaults: { name, email },
      });
      guestUser = found;
      if (guestUser.name !== name) {
        await guestUser.update({ name });
      }
    } else {
      guestUser = await GuestUser.create({ name });
    }

    const alreadyAdded = await activity.hasGuestUser(guestUser);
    if (alreadyAdded) {
      return res.status(400).json({ error: "Guest already added" });
    }

    await activity.addGuestUser(guestUser);

    const chat = await ensureActivityChat(activity);
    const systemContent = buildSystemContent(
      `L'organisateur a ajoute ${guestUser.name} manuellement. Cette personne ne peut pas utiliser le chat.`,
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

    const updated = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });

    return res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/request", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (!activity.private) {
      return res.status(400).json({ error: "Activity is public" });
    }

    if (await canManageActivity(activity, req.user)) {
      return res.status(403).json({ error: "Host cannot request" });
    }

    const priceNumber = Number(activity.price || 0);
    if (priceNumber > 0) {
      return res.status(400).json({ error: "Payment required" });
    }

    const alreadyJoined = activity.users.some(
      (user) => user.id === req.user.id,
    );
    if (alreadyJoined) {
      return res.status(400).json({ error: "Already joined" });
    }

    const participantCount = getParticipantCount(activity);
    if (
      Number.isInteger(activity.seats) &&
      activity.seats > 0 &&
      participantCount >= activity.seats
    ) {
      return res.status(400).json({ error: "Activity is full" });
    }

    const existingRequest = await ParticipationRequest.findOne({
      where: { activityId: activity.id, userId: req.user.id },
    });

    if (existingRequest) {
      if (existingRequest.status === "pending") {
        return res.json(existingRequest);
      }
      if (existingRequest.status === "approved") {
        return res.status(400).json({ error: "Already approved" });
      }
      await existingRequest.update({ status: "pending", paymentId: null });
      return res.json(existingRequest);
    }

    const createdRequest = await ParticipationRequest.create({
      activityId: activity.id,
      userId: req.user.id,
      status: "pending",
    });
    return res.status(201).json(createdRequest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/request", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id);
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    let request = await ParticipationRequest.findOne({
      where: { activityId: activity.id, userId: req.user.id },
      include: [
        {
          model: Payment,
          as: "payment",
          attributes: ["id", "status", "amount", "currency"],
        },
      ],
    });

    if (!request && activity.private) {
      const priceNumber = Number(activity.price || 0);
      const isPaidActivity = Number.isFinite(priceNumber) && priceNumber > 0;
      if (isPaidActivity) {
        const payment = await Payment.findOne({
          where: {
            activityId: activity.id,
            userId: req.user.id,
            status: { [Op.in]: ["pending", "authorized", "paid"] },
          },
          order: [["createdAt", "DESC"]],
        });

        let paymentStatus = payment?.status || null;
        if (payment && payment.status === "pending" && payment.sessionId) {
          if (!ensureStripeConfigured(res)) return;
          try {
            const session = await stripe.checkout.sessions.retrieve(
              payment.sessionId,
            );
            if (session?.payment_status === "paid") {
              const paymentIntentId =
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id || null;
              await payment.update({
                status: "authorized",
                paymentIntentId: paymentIntentId || payment.paymentIntentId,
              });
              paymentStatus = "authorized";
            }
          } catch (err) {
            console.error("Payment session check error:", err);
          }
        }

        if (
          payment &&
          (paymentStatus === "authorized" || paymentStatus === "paid")
        ) {
          const [createdRequest] = await ParticipationRequest.findOrCreate({
            where: { activityId: activity.id, userId: req.user.id },
            defaults: {
              status: "pending",
              paymentId: payment.id,
            },
          });
          if (createdRequest.paymentId !== payment.id) {
            await createdRequest.update({
              status: "pending",
              paymentId: payment.id,
            });
          }
          request = await ParticipationRequest.findByPk(createdRequest.id, {
            include: [
              {
                model: Payment,
                as: "payment",
                attributes: ["id", "status", "amount", "currency"],
              },
            ],
          });
        }
      }
    }

    if (!request) {
      return res.json({ status: "none" });
    }

    if (request.status === "approved") {
      const isMember = await activity.hasUser(req.user.id);
      if (!isMember) {
        await request.update({ status: "rejected" });
        request = await ParticipationRequest.findByPk(request.id, {
          include: [
            {
              model: Payment,
              as: "payment",
              attributes: ["id", "status", "amount", "currency"],
            },
          ],
        });
      }
    }

    return res.json({
      id: request.id,
      status: request.status,
      paymentStatus: request.payment?.status || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/requests", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (!activity.private) {
      return res.status(400).json({ error: "Activity is public" });
    }

    if (!(await canManageActivity(activity, req.user))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const requests = await ParticipationRequest.findAll({
      where: { activityId: activity.id },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstname", "lastname", "pseudo", "email"],
        },
        {
          model: Payment,
          as: "payment",
          attributes: ["id", "status", "amount", "currency"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    return res.json(requests);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post(
  "/:id/requests/:requestId/approve",
  verifyAuth,
  async (req, res) => {
    try {
      const activity = await Activity.findByPk(req.params.id, {
        include: defaultInclude,
      });
      if (!activity)
        return res.status(404).json({ error: "Activity not found" });

      if (!(await canManageActivity(activity, req.user))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const request = await ParticipationRequest.findOne({
        where: { id: req.params.requestId, activityId: activity.id },
        include: [
          {
            model: Payment,
            as: "payment",
          },
        ],
      });

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ error: "Request already processed" });
      }

      const alreadyJoined = activity.users.some(
        (user) => user.id === request.userId,
      );
      const participantCount = getParticipantCount(activity);
      if (
        !alreadyJoined &&
        Number.isInteger(activity.seats) &&
        activity.seats > 0 &&
        participantCount >= activity.seats
      ) {
        return res.status(400).json({ error: "Activity is full" });
      }

      const priceNumber = Number(activity.price || 0);
      const isPaidActivity = Number.isFinite(priceNumber) && priceNumber > 0;

      if (isPaidActivity) {
        if (!ensureStripeConfigured(res)) return;
        const payment = request.payment;
        if (!payment) {
          return res
            .status(400)
            .json({ error: "Payment not found for request" });
        }
        if (!payment.paymentIntentId) {
          return res.status(400).json({ error: "Payment intent missing" });
        }
        if (payment.status !== "authorized" && payment.status !== "paid") {
          return res.status(400).json({ error: "Payment not authorized" });
        }

        if (payment.status !== "paid") {
          try {
            await stripe.paymentIntents.capture(payment.paymentIntentId);
            await payment.update({ status: "paid", paidAt: new Date() });
          } catch (err) {
            return res
              .status(400)
              .json({ error: err.message || "Payment capture failed" });
          }
        }
      }

      if (!alreadyJoined) {
        await addParticipantToActivity(activity, request.userId);
      }

      await request.update({ status: "approved" });
      const refreshed = await ParticipationRequest.findByPk(request.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstname", "lastname", "pseudo", "email"],
          },
          {
            model: Payment,
            as: "payment",
            attributes: ["id", "status", "amount", "currency"],
          },
        ],
      });

      return res.json(refreshed);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
);

router.post("/:id/requests/:requestId/reject", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (!(await canManageActivity(activity, req.user))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const request = await ParticipationRequest.findOne({
      where: { id: req.params.requestId, activityId: activity.id },
      include: [
        {
          model: Payment,
          as: "payment",
        },
      ],
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request already processed" });
    }

    const priceNumber = Number(activity.price || 0);
    const isPaidActivity = Number.isFinite(priceNumber) && priceNumber > 0;

    if (isPaidActivity && request.payment?.paymentIntentId) {
      if (!ensureStripeConfigured(res)) return;
      try {
        if (request.payment.status === "authorized") {
          await stripe.paymentIntents.cancel(request.payment.paymentIntentId);
        }
        await request.payment.update({
          status: "canceled",
        });
      } catch (err) {
        return res
          .status(400)
          .json({ error: err.message || "Payment cancellation failed" });
      }
    }

    await request.update({ status: "rejected" });
    const refreshed = await ParticipationRequest.findByPk(request.id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstname", "lastname", "pseudo", "email"],
        },
        {
          model: Payment,
          as: "payment",
          attributes: ["id", "status", "amount", "currency"],
        },
      ],
    });

    return res.json(refreshed);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id/leave", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    if (activity.hostUserId === req.user.id) {
      return res.status(403).json({ error: "Host cannot leave activity" });
    }
    if (activity.hostOrganisation?.ownerId === req.user.id) {
      return res.status(403).json({ error: "Host cannot leave activity" });
    }

    const isMember = activity.users.some((user) => user.id === req.user.id);
    if (isMember) {
      const priceNumber = Number(activity.price || 0);
      const isPaidActivity = Number.isFinite(priceNumber) && priceNumber > 0;
      const shouldRefund = isPaidActivity && isRefundWindowOpen(activity);

      if (shouldRefund) {
        if (!ensureStripeConfigured(res)) return;
        const payment = await Payment.findOne({
          where: {
            userId: req.user.id,
            activityId: activity.id,
            status: "paid",
          },
          order: [["createdAt", "DESC"]],
        });
        if (!payment) {
          return res
            .status(400)
            .json({ error: "Payment not found for refund" });
        }
        if (!payment.paymentIntentId) {
          return res
            .status(400)
            .json({ error: "Payment intent missing for refund" });
        }
        try {
          const refund = await stripe.refunds.create({
            payment_intent: payment.paymentIntentId,
          });
          await payment.update({
            status: "refunded",
            refundId: refund.id,
            refundedAt: new Date(),
          });
        } catch (err) {
          return res
            .status(400)
            .json({ error: err.message || "Refund failed" });
        }
      }

      await activity.removeUser(req.user.id);
      const chat = await activity.getChat();
      if (chat) {
        await chat.removeMember(req.user.id);
      }
      if (activity.private) {
        const request = await ParticipationRequest.findOne({
          where: { activityId: activity.id, userId: req.user.id },
        });
        if (request && request.status !== "rejected") {
          await request.update({ status: "rejected" });
        }
      }
    }
    const updated = await Activity.findByPk(req.params.id, {
      include: defaultInclude,
    });
    return res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", verifyAuth, async (req, res) => {
  try {
    const activity = await Activity.findByPk(req.params.id);
    if (!activity) return res.status(404).json({ error: "Activity not found" });

    let isHostOrganisation = false;
    if (activity.hostOrganisationId) {
      const organisation = await Organisation.findByPk(
        activity.hostOrganisationId,
      );
      isHostOrganisation = organisation && organisation.ownerId === req.user.id;
    }

    const isHostUser = activity.hostUserId === req.user.id;
    if (!isHostUser && !isHostOrganisation && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    await activity.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

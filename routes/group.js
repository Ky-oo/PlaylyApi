const express = require("express");
const { Op } = require("sequelize");
const {
  Group,
  GroupMember,
  GroupMessage,
  User,
  Activity,
} = require("../model");
const { verifyAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const getMembership = async (groupId, userId) =>
  GroupMember.findOne({ where: { group_id: groupId, user_id: userId } });

const isMember = async (groupId, userId) =>
  !!(await getMembership(groupId, userId));

const isGroupAdmin = async (groupId, userId) => {
  const membership = await getMembership(groupId, userId);
  return (
    membership && (membership.role === "owner" || membership.role === "admin")
  );
};

const memberInclude = {
  model: User,
  as: "members",
  attributes: ["id", "firstname", "lastname", "pseudo"],
  through: { attributes: ["role", "joined_at"] },
};

const activityAttributes = [
  "id",
  "title",
  "description",
  "date",
  "address",
  "city",
  "postalCode",
  "latitude",
  "longitude",
  "place_name",
  "seats",
  "type",
  "price",
  "private",
  "groupId",
  "hostUserId",
  "hostOrganisationId",
  "createdAt",
];

// ─── GET / — list public groups (or all for admin) ───────────────────────────
router.get("/", verifyAuth, async (req, res) => {
  try {
    const where = req.user.role === "admin" ? {} : { is_public: true };
    const groups = await Group.findAll({
      where,
      include: [memberInclude],
      order: [["createdAt", "DESC"]],
    });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /mine — groups the current user belongs to ──────────────────────────
router.get("/mine", verifyAuth, async (req, res) => {
  try {
    const memberships = await GroupMember.findAll({
      where: { user_id: req.user.id },
      attributes: ["group_id"],
    });
    const groupIds = memberships.map((m) => m.group_id);
    const groups = await Group.findAll({
      where: { id: { [Op.in]: groupIds } },
      include: [memberInclude],
      order: [["createdAt", "DESC"]],
    });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id — get group detail ─────────────────────────────────────────────
router.get("/:id", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id, {
      include: [memberInclude],
    });
    if (!group) return res.status(404).json({ error: "Group not found" });

    const member = await isMember(group.id, req.user.id);
    if (!group.is_public && !member && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / — create a group ─────────────────────────────────────────────────
router.post("/", verifyAuth, async (req, res) => {
  try {
    const { name, description, cover_img_url, is_public } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const group = await Group.create({
      name: name.trim(),
      description: description || null,
      cover_img_url: cover_img_url || null,
      is_public: is_public !== undefined ? !!is_public : true,
    });

    await GroupMember.create({
      group_id: group.id,
      user_id: req.user.id,
      role: "owner",
      joined_at: new Date(),
    });

    const created = await Group.findByPk(group.id, {
      include: [memberInclude],
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── PUT /:id — update group (owner/admin of group or site admin) ─────────────
router.put("/:id", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const canManage =
      req.user.role === "admin" || (await isGroupAdmin(group.id, req.user.id));
    if (!canManage) return res.status(403).json({ error: "Forbidden" });

    const { name, description, cover_img_url, is_public } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (cover_img_url !== undefined) updates.cover_img_url = cover_img_url;
    if (is_public !== undefined) updates.is_public = !!is_public;

    await group.update(updates);
    const updated = await Group.findByPk(group.id, {
      include: [memberInclude],
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── DELETE /:id — delete group (site admin only) ────────────────────────────
router.delete("/:id", verifyAuth, requireRole("admin"), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    await group.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/join — join a group ───────────────────────────────────────────
router.post("/:id/join", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!group.is_public) {
      return res.status(403).json({ error: "This group is private" });
    }

    const existing = await getMembership(group.id, req.user.id);
    if (existing) return res.status(409).json({ error: "Already a member" });

    await GroupMember.create({
      group_id: group.id,
      user_id: req.user.id,
      role: "member",
      joined_at: new Date(),
    });

    res.status(201).json({ message: "Joined group" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /:id/invite — add a member (owner/admin of group) ──────────────────
router.post("/:id/invite", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const canManage =
      req.user.role === "admin" || (await isGroupAdmin(group.id, req.user.id));
    if (!canManage) return res.status(403).json({ error: "Forbidden" });

    const userId = parseInt(req.body.userId, 10);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: "userId is required" });
    }

    const targetUser = await User.findByPk(userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const existing = await getMembership(group.id, userId);
    if (existing)
      return res.status(409).json({ error: "User is already a member" });

    await GroupMember.create({
      group_id: group.id,
      user_id: userId,
      role: "member",
      joined_at: new Date(),
    });

    res.status(201).json({ message: "User added to group" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── DELETE /:id/leave — leave a group ───────────────────────────────────────
router.delete("/:id/leave", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const membership = await getMembership(group.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Not a member" });

    if (membership.role === "owner") {
      const otherAdmins = await GroupMember.count({
        where: {
          group_id: group.id,
          user_id: { [Op.ne]: req.user.id },
          role: { [Op.in]: ["owner", "admin"] },
        },
      });
      if (otherAdmins === 0) {
        const memberCount = await GroupMember.count({
          where: { group_id: group.id },
        });
        if (memberCount > 1) {
          return res.status(400).json({
            error:
              "Transfer ownership before leaving, or remove all members first",
          });
        }
      }
    }

    await membership.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id/members/:userId — remove a member (owner/admin of group) ────
router.delete("/:id/members/:userId", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const canManage =
      req.user.role === "admin" || (await isGroupAdmin(group.id, req.user.id));
    if (!canManage) return res.status(403).json({ error: "Forbidden" });

    const targetId = parseInt(req.params.userId, 10);
    const membership = await getMembership(group.id, targetId);
    if (!membership) return res.status(404).json({ error: "Member not found" });

    if (membership.role === "owner" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Cannot remove the owner" });
    }

    await membership.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/activities — get activities for a group (members only) ──────────
router.get("/:id/activities", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const member = await isMember(group.id, req.user.id);
    if (!member && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const activities = await Activity.findAll({
      where: { groupId: group.id },
      attributes: activityAttributes,
      order: [["date", "ASC"]],
    });

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/messages — get group chat messages (members only) ───────────────
router.get("/:id/messages", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const member = await isMember(group.id, req.user.id);
    if (!member && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );
    const before = parseInt(req.query.before, 10);
    const where = { group_id: group.id, is_deleted: false };
    if (!Number.isNaN(before)) {
      where.id = { [Op.lt]: before };
    }

    const messages = await GroupMessage.findAll({
      where,
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstname", "lastname", "pseudo"],
        },
        {
          model: GroupMessage,
          as: "replyTo",
          attributes: ["id", "content"],
          include: [
            {
              model: User,
              as: "sender",
              attributes: ["id", "firstname", "lastname", "pseudo"],
            },
          ],
        },
      ],
      order: [["send_at", "ASC"]],
      limit,
    });

    res.json({ data: messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/messages — send a message to the group chat (members only) ─────
router.post("/:id/messages", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const member = await isMember(group.id, req.user.id);
    if (!member && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { content, reply_to_id } = req.body;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    if (reply_to_id) {
      const parent = await GroupMessage.findOne({
        where: { id: reply_to_id, group_id: group.id },
      });
      if (!parent)
        return res.status(404).json({ error: "Reply target not found" });
    }

    const message = await GroupMessage.create({
      group_id: group.id,
      sender_id: req.user.id,
      content: content.trim(),
      reply_to_id: reply_to_id || null,
      send_at: new Date(),
    });

    const saved = await GroupMessage.findByPk(message.id, {
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstname", "lastname", "pseudo"],
        },
        {
          model: GroupMessage,
          as: "replyTo",
          attributes: ["id", "content"],
          include: [
            {
              model: User,
              as: "sender",
              attributes: ["id", "firstname", "lastname", "pseudo"],
            },
          ],
        },
      ],
    });

    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── DELETE /:id/messages/:messageId — soft-delete a message ─────────────────
router.delete("/:id/messages/:messageId", verifyAuth, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const message = await GroupMessage.findOne({
      where: { id: req.params.messageId, group_id: group.id },
    });
    if (!message) return res.status(404).json({ error: "Message not found" });

    const canDelete =
      req.user.role === "admin" ||
      message.sender_id === req.user.id ||
      (await isGroupAdmin(group.id, req.user.id));

    if (!canDelete) return res.status(403).json({ error: "Forbidden" });

    await message.update({ is_deleted: true, content: "" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

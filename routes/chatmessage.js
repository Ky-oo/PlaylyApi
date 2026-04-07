const express = require("express");
const { ChatMessage } = require("../model");
const { requireRole } = require("../middleware/auth");
const router = express.Router();

router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const messages = await ChatMessage.findAll();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const message = await ChatMessage.findByPk(req.params.id);

    if (!message)
      return res.status(404).json({ error: "ChatMessage not found" });
    if (message.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const chatId = req.body.chatId;
    const content = req.body.content;
    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }
    const message = await ChatMessage.create({
      chatId,
      userId: req.user.id,
      content: content.trim(),
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const message = await ChatMessage.findByPk(req.params.id);
    if (!message)
      return res.status(404).json({ error: "ChatMessage not found" });
    if (message.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const content = req.body.content;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }
    await message.update({ content: content.trim() });
    res.json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const message = await ChatMessage.findByPk(req.params.id);
    if (!message)
      return res.status(404).json({ error: "ChatMessage not found" });
    if (message.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    await message.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

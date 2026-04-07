const express = require("express");
const { User } = require("../model");
const { verifyAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const sanitizeUser = (user) => {
  const data = user.toJSON();
  delete data.password;
  return data;
};

router.get("/", verifyAuth, requireRole("admin"), async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", verifyAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const isOwner = req.user.id === user.id;
    const isAdmin = req.user.role === "admin";
    if (isOwner || isAdmin) {
      return res.json(sanitizeUser(user));
    }
    const { id, firstname, lastname, pseudo } = user;
    return res.json({ id, firstname, lastname, pseudo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", verifyAuth, requireRole("admin"), async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(sanitizeUser(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", verifyAuth, async (req, res) => {
  try {
    if (req.user.id !== parseInt(req.params.id) && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const { firstname, lastname, pseudo, email, city, password } = req.body;
    const updates = {};
    if (firstname !== undefined) updates.firstname = firstname;
    if (lastname !== undefined) updates.lastname = lastname;
    if (pseudo !== undefined) updates.pseudo = pseudo;
    if (email !== undefined) updates.email = email;
    if (city !== undefined) updates.city = city;
    if (password !== undefined) updates.password = password;
    if (req.body.role !== undefined && req.user.role === "admin") {
      updates.role = req.body.role;
    }
    await user.update(updates);
    res.json(sanitizeUser(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", verifyAuth, requireRole("admin"), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

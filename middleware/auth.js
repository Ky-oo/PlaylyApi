const jwt = require("jsonwebtoken");

const getToken = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
};

const verifyAuth = (req, res, next) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });
    next();
  };

const optionalAuth = (req, res, next) => {
  const token = getToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      // Ignore invalid token, user will be treated as unauthenticated
    }
  }
  next();
};

module.exports = {
  verifyAuth,
  requireRole,
  optionalAuth,
};

const jwt = require('jsonwebtoken');
module.exports = function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'token missing' });
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).sub;
    next();
  } catch { return res.status(401).json({ error: 'invalid token' }); }
};

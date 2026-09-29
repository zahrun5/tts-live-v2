const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'mamang_harun_rahasia_v2_2026';

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid' });
  }
};

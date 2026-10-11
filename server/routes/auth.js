const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimit');

router.post('/register', registerLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/me', auth, authController.me);
router.post('/onboarding', auth, authController.completeOnboarding);

// Google OAuth
router.get('/google', authController.googleStart);
router.get('/google/callback', authController.googleCallback);

module.exports = router;

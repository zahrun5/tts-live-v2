const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimit');
const googleAuth = require('../auth/google');

router.post('/register', registerLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/me', auth, authController.me);
router.post('/onboarding', auth, authController.completeOnboarding);

// Google OAuth: route didefinisikan di /auth/google.js, tinggal mount di sini.
// handleGoogleProfile disuntik supaya logic tetap di controller (single source of truth).
router.use('/google', googleAuth.buildRouter({
  handleGoogleProfile: authController.handleGoogleProfile
}));

module.exports = router;

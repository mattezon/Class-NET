const express = require('express');
const protect = require('../middleware/auth.cjs');
const { register, login, refreshToken, logout, updateProfile, forgotPassword, changePassword } = require('../controllers/auth.cjs');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/logout', logout);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;
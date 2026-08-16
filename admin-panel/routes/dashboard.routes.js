'use strict';

const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { BUSINESSES, listKeys } = require('../config/businesses');

router.get('/', requireLogin, (req, res) => {
    const user = req.session.user;
    const keys = user.role === 'super' ? listKeys() : [user.businessKey].filter(Boolean);
    const businesses = keys.map(key => ({ key, ...BUSINESSES[key] }));
    res.render('dashboard', { user, businesses });
});

module.exports = router;

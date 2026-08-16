'use strict';

const express = require('express');
const router = express.Router();
const accountStore = require('../services/accountStore');

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = accountStore.verifyLogin(username, password);
    if (!user) {
        return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos.' });
    }
    req.session.user = user;
    res.redirect('/');
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

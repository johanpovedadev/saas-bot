'use strict';

const express = require('express');
const router = express.Router();
const accountStore = require('../services/accountStore');
const { createLoginLimiter } = require('../middleware/security');

const loginLimiter = createLoginLimiter();

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';

    const wait = loginLimiter.lockedMinutes(ip, username);
    if (wait) {
        res.set('Retry-After', String(wait * 60));
        return res.status(429).render('login', { error: `Demasiados intentos fallidos. Espera ${wait} min e intenta de nuevo.` });
    }

    const user = accountStore.verifyLogin(username, password);
    if (!user) {
        loginLimiter.fail(ip, username);
        return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos.' });
    }

    loginLimiter.succeed(ip, username);
    // Sesión nueva al ingresar: una cookie que alguien dejó puesta antes del login no sirve después.
    req.session.regenerate((err) => {
        if (err) return res.status(500).render('login', { error: 'No se pudo iniciar la sesión. Intenta de nuevo.' });
        req.session.user = user;
        req.session.save(() => res.redirect('/'));
    });
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
module.exports.loginLimiter = loginLimiter;

'use strict';

/**
 * Página de gestión de cuentas del panel (super-admin) — Fase 5 del plan de
 * mejoras: antes solo se podían crear/editar cuentas con
 * scripts/create-account.js (a mano, por consola). El guardado en sí vive
 * en /api/accounts (api.routes.js), esta ruta solo renderiza la pantalla.
 */

const express = require('express');
const router = express.Router();
const { requireLogin, requireSuper } = require('../middleware/auth');
const accountStore = require('../services/accountStore');
const { BUSINESSES, listKeys } = require('../config/businesses');

router.get('/accounts', requireLogin, requireSuper, (req, res) => {
    const accounts = accountStore.listAccounts();
    const businesses = listKeys().map(key => ({ key, name: BUSINESSES[key].name }));
    res.render('accounts', { user: req.session.user, accounts, businesses });
});

module.exports = router;

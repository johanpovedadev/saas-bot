'use strict';

const express = require('express');
const router = express.Router();
const { requireLogin, requireBusinessScope } = require('../middleware/auth');
const { BUSINESSES, listKeys, getBusiness } = require('../config/businesses');
const pm2Status = require('../services/pm2Status');
const botControl = require('../services/botControl');
const logsReader = require('../services/logsReader');
const leadsAdapters = require('../services/leadsAdapters');
const qrReader = require('../services/qrReader');

router.use(requireLogin);

// GET /api/businesses — lista scopeada al usuario logueado
router.get('/businesses', async (req, res) => {
    const user = req.session.user;
    const keys = user.role === 'super' ? listKeys() : [user.businessKey].filter(Boolean);
    const statuses = await pm2Status.getAllStatuses();

    const businesses = keys.map(key => {
        const business = BUSINESSES[key];
        const appName = botControl.resolveAppName(key);
        const status = appName ? (statuses[appName] || { status: 'not_found' }) : { status: 'not_found' };
        return {
            key,
            name: business.name,
            channel: business.channel,
            status: status.status,
            pid: status.pid,
            uptime: status.uptime,
            ownerJid: botControl.getOwner(key),
            mutedCount: botControl.listMuted(key).length,
            waitingHumanCount: botControl.listWaitingHuman(key).length
        };
    });
    res.json({ businesses });
});

router.post('/businesses/:key/start', requireBusinessScope, async (req, res) => {
    if (!getBusiness(req.params.key)) return res.status(404).json({ error: 'Negocio desconocido.' });
    const result = await botControl.start(req.params.key);
    res.json(result);
});

router.post('/businesses/:key/stop', requireBusinessScope, async (req, res) => {
    if (!getBusiness(req.params.key)) return res.status(404).json({ error: 'Negocio desconocido.' });
    const result = await botControl.stop(req.params.key);
    res.json(result);
});

router.get('/businesses/:key/muted', requireBusinessScope, (req, res) => {
    res.json({ muted: botControl.listMuted(req.params.key) });
});

router.post('/businesses/:key/mute', requireBusinessScope, (req, res) => {
    const result = botControl.mute(req.params.key, req.body.number);
    res.status(result.ok ? 200 : 400).json(result);
});

router.post('/businesses/:key/unmute', requireBusinessScope, (req, res) => {
    const result = botControl.unmute(req.params.key, req.body.number);
    res.status(result.ok ? 200 : 400).json(result);
});

router.get('/businesses/:key/waiting-human', requireBusinessScope, (req, res) => {
    res.json({ waiting: botControl.listWaitingHuman(req.params.key) });
});

router.post('/businesses/:key/reactivate', requireBusinessScope, (req, res) => {
    const result = botControl.reactivate(req.params.key, req.body.number);
    res.status(result.ok ? 200 : 400).json(result);
});

router.get('/businesses/:key/logs', requireBusinessScope, async (req, res) => {
    const lines = await logsReader.tailLog(req.params.key, 200);
    res.json({ lines });
});

router.get('/businesses/:key/leads', requireBusinessScope, async (req, res) => {
    const result = await leadsAdapters.getLeads(req.params.key);
    res.json(result);
});

// Cargar/actualizar una clienta del bot de Bri Pilates (clientas
// recurrentes): telefono, nombre y cuantas clases al mes. Cuantas ha
// tomado/le quedan se calculan solas contra el mes en curso (ver
// GET .../leads, que ya trae esos dos numeros para esta clienta).
router.post('/businesses/:key/pilates-credito', requireBusinessScope, async (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const { telefono, nombre, clases } = req.body || {};
    if (!telefono) return res.status(400).json({ error: 'Falta el número de teléfono.' });
    const pilatesRoster = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesRoster'));
    const result = pilatesRoster.setLocalClient(telefono, nombre, clases);
    res.status(result.ok ? 200 : 400).json(result);
});

// Clases con al menos 1 reserva en un rango de fechas (por defecto, hoy + 6
// dias) con quien esta agendado en cada una — para que Bri vea de una
// cuantas personas hay y a que hora, sin depender de que alguien le edite
// codigo o le mande un Excel.
router.get('/businesses/:key/pilates/sessions', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    const toIso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const from = req.query.from || toIso(today);
    const to = req.query.to || toIso(new Date(today.getTime() + 6 * 86400000));
    const sessions = pilatesStore.getSessionsWithBookings(from, to);
    res.json({ sessions });
});

// Usuarios activos de Leo Financiero (hoy / esta semana / este mes) — ventanas
// rodantes de 24h/7d/30d contando quien mando al menos 1 mensaje.
router.get('/businesses/:key/finance-stats', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'finance') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const financeAdmin = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'financeAdmin'));
    res.json(financeAdmin.getActiveUserCounts());
});

// Estado del QR (sin bajar la imagen) - para que el frontend decida si
// mostrar el <img> o un mensaje de "sin QR disponible ahora mismo".
router.get('/businesses/:key/qr-status', requireBusinessScope, (req, res) => {
    const { exists, fresh, ageMs } = qrReader.getQr(req.params.key);
    res.json({ exists, fresh, ageMs: ageMs || null });
});

// La imagen del QR en si. Solo la sirve si existe y esta fresca (se
// regenera cada ~60s mientras el bot espera ser escaneado) - evita mostrar
// un QR viejo/vencido como si sirviera.
router.get('/businesses/:key/qr.png', requireBusinessScope, (req, res) => {
    const { exists, fresh, buffer } = qrReader.getQr(req.params.key);
    if (!exists || !fresh) return res.status(404).end();
    res.type('png').send(buffer);
});

// GET /api/owners — solo super-admin, para visibilidad/debug
router.get('/owners', (req, res) => {
    if (req.session.user.role !== 'super') return res.status(403).json({ error: 'Solo super-admin.' });
    res.json(botControl.getAllOwners());
});

module.exports = router;

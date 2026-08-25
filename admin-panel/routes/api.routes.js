'use strict';

const express = require('express');
const router = express.Router();
const { requireLogin, requireBusinessScope, requireSuper } = require('../middleware/auth');
const { BUSINESSES, listKeys, getBusiness } = require('../config/businesses');
const pm2Status = require('../services/pm2Status');
const botControl = require('../services/botControl');
const logsReader = require('../services/logsReader');
const leadsAdapters = require('../services/leadsAdapters');
const qrReader = require('../services/qrReader');
const accountStore = require('../services/accountStore');

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

// Horario de clases (dias + horas/cupo) - Fase 4: Bri edita esto ella misma
// desde el panel, ya no requiere que alguien le edite codigo y redespliegue.
// El bot recarga estos valores en cada mensaje entrante (ver
// refreshScheduleFromStore en pilates_clientas.flow.js), asi que un cambio
// guardado acá se refleja en el siguiente mensaje de cualquier clienta.
router.get('/businesses/:key/pilates/schedule', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    res.json({ days: pilatesStore.getScheduleDays(), slots: pilatesStore.getScheduleSlots() });
});

const DAY_DOW_BY_KEY = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

router.post('/businesses/:key/pilates/schedule/day', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const { dayKey, dayLabel } = req.body || {};
    const normalizedKey = String(dayKey || '').trim().toLowerCase();
    const dow = DAY_DOW_BY_KEY[normalizedKey];
    if (!normalizedKey || dow === undefined) return res.status(400).json({ error: 'Día inválido. Usa: lunes, martes, miercoles, jueves, viernes, sabado o domingo.' });
    if (!dayLabel || !String(dayLabel).trim()) return res.status(400).json({ error: 'Falta el nombre a mostrar del día (ej. "Lunes").' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    pilatesStore.upsertScheduleDay(normalizedKey, String(dayLabel).trim(), dow);
    res.json({ ok: true });
});

router.post('/businesses/:key/pilates/schedule/day/remove', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const { dayKey } = req.body || {};
    if (!dayKey) return res.status(400).json({ error: 'Falta el día a eliminar.' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    pilatesStore.removeScheduleDay(dayKey);
    res.json({ ok: true });
});

router.post('/businesses/:key/pilates/schedule/slot', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const { startTime, endTime, capacity } = req.body || {};
    if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '')) {
        return res.status(400).json({ error: 'Hora inválida. Usa formato 24h, ej. 05:00.' });
    }
    const cap = parseInt(capacity, 10);
    if (!Number.isFinite(cap) || cap < 1) return res.status(400).json({ error: 'El cupo debe ser un número mayor a 0.' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    pilatesStore.upsertScheduleSlot(startTime, endTime, cap);
    res.json({ ok: true });
});

router.post('/businesses/:key/pilates/schedule/slot/remove', requireBusinessScope, (req, res) => {
    if (req.params.key !== 'pilates_clientas') return res.status(404).json({ error: 'No disponible para este negocio.' });
    const { startTime } = req.body || {};
    if (!startTime) return res.status(400).json({ error: 'Falta la hora a eliminar.' });
    const pilatesStore = require(require('path').join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    pilatesStore.removeScheduleSlot(startTime);
    res.json({ ok: true });
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

// Crear o editar una cuenta del panel — Fase 5: reemplaza tener que correr
// scripts/create-account.js a mano por consola. Mismo motor de siempre
// (accountStore, hash + roles + scoping), esto solo es la interfaz.
router.post('/accounts', requireSuper, (req, res) => {
    const { username, password, role, businessKey } = req.body || {};
    if (!username || !String(username).trim()) return res.status(400).json({ error: 'Falta el usuario.' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    const finalRole = role === 'super' ? 'super' : 'business';
    if (finalRole === 'business' && !getBusiness(businessKey)) return res.status(400).json({ error: 'Elige un negocio válido para esta cuenta.' });
    try {
        accountStore.upsertAccount(String(username).trim(), String(password), finalRole, businessKey);
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;

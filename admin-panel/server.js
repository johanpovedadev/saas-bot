'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { securityHeaders } = require('./middleware/security');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const apiRoutes = require('./routes/api.routes');
const calendarRoutes = require('./routes/calendar.routes');
const accountsRoutes = require('./routes/accounts.routes');

const app = express();

app.disable('x-powered-by');
// Solo se confía en X-Forwarded-* cuando quien conecta es esta misma máquina (el túnel de Cloudflare): así nadie
// puede falsear su IP para saltarse el límite de intentos de login.
app.set('trust proxy', 'loopback');
app.use(securityHeaders);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.SESSION_SECRET) {
    console.error('❌ Falta SESSION_SECRET en admin-panel/.env — no se puede arrancar de forma segura.');
    process.exit(1);
}

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto', // Secure cuando llega por HTTPS (el túnel de Cloudflare); en http://localhost sigue funcionando
        maxAge: 1000 * 60 * 60 * 12 // 12h
    }
}));

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', calendarRoutes);
app.use('/', accountsRoutes);
app.use('/api', apiRoutes);

const PORT = parseInt(process.env.PORT, 10) || 4000;
// Por defecto solo esta máquina (el túnel de Cloudflare entra por localhost). Para abrirlo a la red local a propósito:
// ADMIN_PANEL_HOST=0.0.0.0 en admin-panel/.env.
const HOST = process.env.ADMIN_PANEL_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
    console.log(`✅ Panel de administración escuchando en http://${HOST}:${PORT}`);
    console.log(`   Local: http://localhost:${PORT}`);
});

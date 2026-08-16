'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const apiRoutes = require('./routes/api.routes');

const app = express();

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
        secure: false, // sin TLS en esta iteración (solo red local)
        maxAge: 1000 * 60 * 60 * 12 // 12h
    }
}));

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/api', apiRoutes);

const PORT = parseInt(process.env.PORT, 10) || 4000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Panel de administración escuchando en http://0.0.0.0:${PORT}`);
    console.log(`   Local: http://localhost:${PORT}`);
});

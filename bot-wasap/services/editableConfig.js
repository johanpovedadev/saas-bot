'use strict';

/**
 * @fileoverview Config editable del negocio (tenant heladeria / Mundo Helados).
 *
 * Lee las pestañas "Configuración" (Campo/Valor) y "Preguntas_Frecuentes"
 * (Pregunta/Respuesta) del Google Sheet del tenant a través de los endpoints
 * del backend Django (/configuracion/ y /preguntas_frecuentes/). Así Isa puede
 * cambiar tono, saludo, cuentas y FAQs SIN tocar código.
 *
 * Aislamiento multitenant:
 * - El refresco y el cache viven en ctx (nunca en variables globales del módulo).
 * - Solo aplica al tenant heladería (BUSINESS_KEY=heladeria / tipo ICE_CREAM).
 * - Para el resto de tenants las funciones getter devuelven el fallback tal cual,
 *   así NO cambia su comportamiento y NO se hacen llamadas de red.
 *
 * Exports:
 *   startEditableConfigRefresher(ctx)  -> arranca carga + refresco cada 5 min
 *   getEditableConfig(ctx, key, fallback) -> valor del campo o fallback
 *   getEditableFaqs(ctx)               -> [{Pregunta, Respuesta}, ...] | []
 *   loadEditableConfig(ctx)            -> recarga cache una vez (reintentable)
 */

const axios = require('axios');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

const CONFIG_REFRESH_MS = 5 * 60 * 1000;
const CONFIG_TIMEOUT_MS = 8000;
const CONFIG_ENDPOINT = '/configuracion/';
const FAQ_ENDPOINT = '/preguntas_frecuentes/';

function getApiBase() {
    const raw = (envConfig.backend && envConfig.backend.apiBase) || process.env.API_BASE || 'http://127.0.0.1:8000/api';
    return String(raw).replace(/\/$/, '');
}

// Solo Mundo Helados expone estas pestañas en su Sheet/backend. Para los demás
// tenants este servicio es transparente (sin red, sin cache, solo fallback).
function isHeladeria() {
    return process.env.BUSINESS_KEY === 'heladeria' ||
        !!(envConfig.business && envConfig.business.type === 'ICE_CREAM');
}

function getEditableConfig(ctx, key, fallback) {
    if (ctx && ctx.editableConfig && typeof ctx.editableConfig[key] === 'string') {
        const val = String(ctx.editableConfig[key]).trim();
        if (val) return val;
    }
    return fallback;
}

function getEditableFaqs(ctx) {
    return (ctx && Array.isArray(ctx.editableFaqs)) ? ctx.editableFaqs : [];
}

async function loadEditableConfig(ctx) {
    if (!isHeladeria() || !ctx) return;
    const apiBase = getApiBase();
    try {
        const [configRes, faqRes] = await Promise.all([
            axios.get(`${apiBase}${CONFIG_ENDPOINT}`, { timeout: CONFIG_TIMEOUT_MS }),
            axios.get(`${apiBase}${FAQ_ENDPOINT}`, { timeout: CONFIG_TIMEOUT_MS })
        ]);

        const config = (configRes.data && configRes.data.config && typeof configRes.data.config === 'object')
            ? configRes.data.config : {};
        const faqs = (faqRes.data && Array.isArray(faqRes.data.faqs)) ? faqRes.data.faqs : [];

        ctx.editableConfig = config;
        ctx.editableFaqs = faqs;
        ctx.editableConfigLoadedAt = Date.now();

        console.log(`✅ Config editable cargada: ${Object.keys(config).length} campos, ${faqs.length} FAQs (${apiBase})`);
        logger.info({ businessKey: process.env.BUSINESS_KEY, configFields: Object.keys(config).length, faqs: faqs.length }, 'Config editable cargada');
    } catch (e) {
        // Se mantiene el cache previo (si existe); si nunca cargó, los getters
        // siguen usando sus fallbacks. El refresco periódico lo reintenta.
        console.warn(`⚠️ No se pudo cargar config editable desde ${apiBase}: ${e.message}`);
        logger.warn({ err: e.message }, 'No se pudo cargar config editable');
    }
}

function startEditableConfigRefresher(ctx) {
    if (!isHeladeria() || !ctx) return null;
    loadEditableConfig(ctx).catch(() => {});
    const timer = setInterval(() => loadEditableConfig(ctx).catch(() => {}), CONFIG_REFRESH_MS);
    logger.info('Refresco de config editable iniciado (cada 5 min)');
    return timer;
}

module.exports = { startEditableConfigRefresher, loadEditableConfig, getEditableConfig, getEditableFaqs };

#!/usr/bin/env node
'use strict';

// Estudio de la IA de Meta (issue #186): arma un informe en Markdown con lo que
// guardó el escucha de WhatsApp (solo lectura). No usa IA, no llama a WhatsApp,
// no envía nada. Los teléfonos salen enmascarados.
//
// Uso (desde bot-wasap):  node scripts/estudio_ia_meta.js [--dias=7]
// La clave se toma de LION_READONLY_ENCRYPTION_KEY o de bot-wasap/.env.escucha.
// Sale en data/estudio_ia_meta/estudio_<fecha>.md (git lo ignora).

const fs = require('fs');
const path = require('path');

const AUTOR_LABEL = {
    cliente: 'Cliente',
    ia_meta: 'IA de Meta',
    propio_desconocido: 'Tu número (sin marca de IA)',
};

function maskPhone(phone) {
    const digits = String(phone || '').replace(/@.*$/, '').replace(/\D/g, '');
    return digits.length >= 2 ? `•••${digits.slice(-2)}` : '•••';
}

/** Quita números largos (teléfonos, cédulas, cuentas) de un texto. */
function maskText(text, max = 200) {
    const t = String(text || '').replace(/\d[\d\s.-]{6,}\d/g, '•••••').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function normalizeQuestion(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\d+/g, '#')
        .replace(/[^\p{L}#\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isMediaLabel(text) {
    return /^(📷|🎥|🎤|🎵|😀|📄|📍|👤)\s|^\[mensaje sin texto/.test(String(text || ''));
}

function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function formatSeconds(sec) {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return `${sec} s`;
    if (sec < 3600) return `${Math.round(sec / 60)} min`;
    return `${(sec / 3600).toFixed(1)} h`;
}

/**
 * @param {Array<{phone:string, fromMe:boolean, autor:string, text:string, marcas:string[], timestamp:string}>} messages
 * @param {{ from: string, to: string }} period fechas ISO (YYYY-MM-DD) para el título
 * @returns {string} Markdown
 */
function buildReport(messages, period) {
    const byPhone = new Map();
    for (const m of [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
        if (!byPhone.has(m.phone)) byPhone.set(m.phone, []);
        byPhone.get(m.phone).push(m);
    }

    const countByAutor = { cliente: 0, ia_meta: 0, propio_desconocido: 0 };
    const delays = { ia_meta: [], propio_desconocido: [] };
    const questions = new Map();
    const pairs = [];
    const marcasSeen = new Map();
    let handoffs = 0;
    let sinRespuesta = 0;

    for (const [phone, msgs] of byPhone) {
        let sawMeta = false;
        let handedOff = false;
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            countByAutor[m.autor] = (countByAutor[m.autor] || 0) + 1;
            for (const k of m.marcas || []) marcasSeen.set(k, (marcasSeen.get(k) || 0) + 1);
            if (m.fromMe) {
                if (m.autor === 'ia_meta') sawMeta = true;
                else if (sawMeta && !handedOff) { handedOff = true; handoffs++; }
                continue;
            }
            // Mensaje del cliente: la pregunta es el último de una tanda seguida.
            const next = msgs[i + 1];
            if (next && !next.fromMe) continue;
            if (!isMediaLabel(m.text)) {
                const q = normalizeQuestion(m.text);
                if (q) {
                    const entry = questions.get(q) || { count: 0, example: m.text };
                    entry.count++;
                    questions.set(q, entry);
                }
            }
            if (!next) { sinRespuesta++; continue; }
            const sec = Math.max(0, Math.round((Date.parse(next.timestamp) - Date.parse(m.timestamp)) / 1000));
            (delays[next.autor] || (delays[next.autor] = [])).push(sec);
            if (pairs.length < 12) pairs.push({ phone, q: m.text, a: next.text, autor: next.autor, sec });
        }
    }

    const lines = [];
    lines.push(`# Estudio de la IA de Meta — ${period.from} a ${period.to}`);
    lines.push('');
    lines.push('_Lo armó el escucha de WhatsApp (solo lectura). Teléfonos y números largos enmascarados._');
    lines.push('');
    lines.push('## En números');
    lines.push('');
    lines.push(`- Conversaciones: **${byPhone.size}**`);
    lines.push(`- Mensajes de clientes: **${countByAutor.cliente || 0}**`);
    lines.push(`- Respuestas de la IA de Meta: **${countByAutor.ia_meta || 0}**`);
    lines.push(`- Respuestas de tu número sin marca de IA: **${countByAutor.propio_desconocido || 0}**`);
    lines.push(`- Conversaciones donde la IA de Meta respondió y luego entraste tú: **${handoffs}**`);
    lines.push(`- Preguntas de clientes sin respuesta todavía: **${sinRespuesta}**`);
    lines.push('');
    lines.push('## Qué tan rápido se responde (mediana)');
    lines.push('');
    lines.push('| Quién | Respuestas | Tiempo |');
    lines.push('|---|---|---|');
    for (const autor of ['ia_meta', 'propio_desconocido']) {
        const d = delays[autor] || [];
        lines.push(`| ${AUTOR_LABEL[autor]} | ${d.length} | ${formatSeconds(median(d))} |`);
    }
    lines.push('');
    lines.push('## Lo que más preguntan');
    lines.push('');
    const top = [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    if (!top.length) lines.push('_Aún no hay preguntas guardadas en este período._');
    for (const q of top) lines.push(`- (${q.count}) ${maskText(q.example, 120)}`);
    lines.push('');
    lines.push('## Ejemplos: pregunta → respuesta');
    lines.push('');
    if (!pairs.length) lines.push('_Aún no hay pares pregunta-respuesta._');
    for (const p of pairs) {
        lines.push(`- **${maskPhone(p.phone)}** · ${AUTOR_LABEL[p.autor] || p.autor} · ${formatSeconds(p.sec)}`);
        lines.push(`  - Cliente: ${maskText(p.q)}`);
        lines.push(`  - Respuesta: ${maskText(p.a)}`);
    }
    lines.push('');
    if (!countByAutor.ia_meta && countByAutor.propio_desconocido) {
        lines.push('## Ojo: WhatsApp no marcó cuáles respuestas fueron de la IA de Meta');
        lines.push('');
        lines.push('Todas las respuestas de tu número salen como "sin marca". Estas son las marcas que traían los');
        lines.push('mensajes; la que aparezca solo en las respuestas de la IA se agrega a `BOT_FIELDS` en');
        lines.push('`lion-readonly-author.js`:');
        lines.push('');
        const seen = [...marcasSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
        if (!seen.length) lines.push('- (ninguna)');
        for (const [k, n] of seen) lines.push(`- \`${k}\` × ${n}`);
        lines.push('');
    }
    return lines.join('\n');
}

function loadEnvEscucha() {
    if (process.env.LION_READONLY_ENCRYPTION_KEY) return;
    const file = path.join(__dirname, '..', '.env.escucha');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

function main() {
    loadEnvEscucha();
    const arg = process.argv.find((a) => a.startsWith('--dias='));
    const dias = Math.max(1, parseInt(arg ? arg.split('=')[1] : '7', 10) || 7);
    const { openStore } = require('../lion-readonly-store');
    const store = openStore();
    if (!store) {
        console.error('No hay LION_READONLY_ENCRYPTION_KEY (ni en bot-wasap/.env.escucha): no hay historial guardado que leer.');
        process.exitCode = 1;
        return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - dias * 86400000);
    const md = buildReport(store.since(from.toISOString()), {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
    });
    store.close();
    const outDir = path.join(__dirname, '..', 'data', 'estudio_ia_meta');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `estudio_${to.toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(out, md, 'utf8');
    console.log(`Informe listo: ${out}`);
}

if (require.main === module) main();

module.exports = { buildReport, maskPhone, maskText, normalizeQuestion };

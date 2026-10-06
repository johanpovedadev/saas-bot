'use strict';

/** Informe HTML del simulador: qué se probó, qué pasó y la conversación de cada escenario (para revisar con el dueño). */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildHtml(runs) {
    const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const bloque = (run) => {
        const total = run.results.length;
        const ok = run.results.filter(r => r.ok).length;
        const areas = {};
        for (const r of run.results) { const a = (areas[r.area] = areas[r.area] || { t: 0, ok: 0 }); a.t++; if (r.ok) a.ok++; }
        const filas = Object.entries(areas).map(([a, v]) => `<tr><td>${esc(a)}</td><td>${v.ok}/${v.t}</td><td><span class="bar"><i style="width:${Math.round(100 * v.ok / v.t)}%"></i></span></td></tr>`).join('');
        const detalle = run.results.map(r => `
<details class="${r.ok ? 'ok' : 'bad'}"><summary>${r.ok ? '✅' : '❌'} <b>${esc(r.id)}</b> — ${esc(r.nombre)} <span class="m">${r.steps} turnos</span></summary>
${r.failures.map(f => `<p class="fail">↳ ${esc(f.msg)}<br><small>${esc(f.detail || '')}</small></p>`).join('')}
<div class="chat">${r.transcript.map(m => `<div class="${m.from}"><span>${m.from === 'cliente' ? '👤' : '🤖'}</span><pre>${esc(m.text)}</pre></div>`).join('')}</div></details>`).join('');
        return `<section><h2>${run.mode === 'sim' ? 'Flujo guiado con IA simulada (cero tokens)' : run.mode === 'off' ? 'Flujo guiado sin IA (el piso del bot)' : 'AGENTE de IA con decisor simulado (cero tokens)'} — ${ok} de ${total} escenarios</h2>
<table><tr><th>Parte del proceso</th><th>Pasaron</th><th></th></tr>${filas}</table>${detalle}</section>`;
    };
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación del bot de Mundo Helados</title>
<style>:root{--bg:#0f0f1a;--card:#1a1a2e;--tx:#e8e8f0;--mut:#9a9ab5;--ok:#3ecf8e;--bad:#ff6b6b;--acc:#f5a623}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,sans-serif;padding:20px 14px}main{max-width:880px;margin:0 auto}
h1{font-size:24px;margin:0}h2{color:var(--acc);margin:28px 0 8px}.sub{color:var(--mut)}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{padding:6px 8px;border-bottom:1px solid #2a2a45;text-align:left;font-size:14px}
.bar{display:inline-block;width:140px;height:8px;background:#2a2a45;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--ok)}
details{background:var(--card);border-radius:8px;margin:6px 0;padding:8px 12px}details.bad{border-left:3px solid var(--bad)}summary{cursor:pointer}.m{color:var(--mut);font-size:12px;margin-left:8px}
.fail{color:var(--bad);margin:6px 0}.chat{display:flex;flex-direction:column;gap:4px;margin-top:8px}.chat div{display:flex;gap:8px}pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit;background:#12121f;padding:6px 10px;border-radius:8px;max-width:100%}
.cliente pre{background:#16354a}</style></head><body><main>
<h1>Validación del bot de Mundo Helados</h1><p class="sub">${esc(fecha)} · el bot REAL (handler y flujo), con el catálogo y las preguntas frecuentes reales, un WhatsApp falso y un backend falso. Ningún pedido de prueba toca el Django ni las hojas reales, y no se gastó ningún token de Gemini.</p>
${runs.map(bloque).join('')}</main></body></html>`;
}

module.exports = { buildHtml };

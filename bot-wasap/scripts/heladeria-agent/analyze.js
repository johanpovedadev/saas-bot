'use strict';
/**
 * Resume replay-results.json (replay.js): métricas por modo (reglas vs
 * agente), costo/latencia de IA, y un lado-a-lado turno por turno para
 * revisión humana.
 *
 * Las métricas automáticas son SEÑALES, no el veredicto: "no entendí",
 * escalamientos, turnos sin respuesta, errores. El juicio de mejor/igual/peor
 * por conversación se hace leyendo el lado-a-lado.
 *
 * Uso: node scripts/heladeria-agent/analyze.js <replay-results.json> [salida.txt]
 */
const fs = require('fs');

const [file, outTxt] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const NU = /No entend|Opción no válida|No reconoc|No logré identificar|❌ (Por favor|Ingresa|No encontr|Para este)/i;
const ESC = /asesor humano|Ya le avisé a una persona|Entiendo que puede ser confuso|avisé a un asesor|una persona del equipo/i;
const ERR = /Ocurrió un error|Hubo un error|error crítico/i;

function turnFlags(r) {
    if (!r) return { missing: true };
    const txt = r.bot.join('\n');
    return {
        silent: r.bot.length === 0,
        notUnderstood: NU.test(txt),
        escalated: ESC.test(txt) || r.state.phase === 'waiting_human',
        error: ERR.test(txt) || !!r.exception,
        pickupContradiction: /recoges en el local/i.test(txt) && /no encontr[eé]/i.test(txt)
    };
}

const modes = ['legacy', 'agent'];
const agg = {};
for (const m of modes) agg[m] = { turns: 0, silent: 0, notUnderstood: 0, escalatedTurns: 0, sessionsEscalated: 0, error: 0, pickupContradiction: 0, aiCalls: 0, aiMs: 0, promptTokens: 0, outTokens: 0, aiTurns: 0, wallMs: [], aiMsPerTurn: [], reachedFinal: 0, confirmedOrders: 0 };
const agentPaths = {};
const toolCount = {};
const perSession = [];

for (const s of data.sessions) {
    const row = { id: s.id, who: s.isJohan ? 'Johan' : s.jidMasked, turns: s.turns.length };
    for (const m of modes) {
        const a = agg[m];
        let esc = false;
        let nu = 0; let sil = 0;
        for (const t of s.turns) {
            const r = t[m];
            const f = turnFlags(r);
            if (f.missing) continue;
            a.turns++;
            if (f.silent) { a.silent++; sil++; }
            if (f.notUnderstood) { a.notUnderstood++; nu++; }
            if (f.escalated) { a.escalatedTurns++; esc = true; }
            if (f.error) a.error++;
            if (f.pickupContradiction) a.pickupContradiction++;
            a.aiCalls += r.ai.calls; a.aiMs += r.ai.ms; a.promptTokens += r.ai.promptTokens; a.outTokens += r.ai.outTokens;
            if (r.ai.calls > 0) { a.aiTurns++; a.aiMsPerTurn.push(r.ai.ms); }
            a.wallMs.push(r.wallMs);
            if (r.bot.some(b => /Resumen final del pedido/.test(b))) row[`${m}Final`] = true;
            if (r.bot.some(b => /pedido ha sido confirmado/.test(b))) row[`${m}Confirmed`] = true;
            if (m === 'agent') {
                for (const tr of (r.trace || [])) {
                    agentPaths[tr.path] = (agentPaths[tr.path] || 0) + 1;
                    for (const c of (tr.calls || [])) toolCount[c.name] = (toolCount[c.name] || 0) + 1;
                }
            }
        }
        if (esc) a.sessionsEscalated++;
        if (row[`${m}Final`]) a.reachedFinal++;
        if (row[`${m}Confirmed`]) a.confirmedOrders++;
        row[m] = { nu, sil, esc };
    }
    perSession.push(row);
}

function pct(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const lines = [];
lines.push(`Sesiones: ${data.sessions.length}  |  corrida: ${data.ranAt}`);
for (const m of modes) {
    const a = agg[m];
    lines.push(`\n=== ${m.toUpperCase()} ===`);
    lines.push(`turnos=${a.turns}  "no entendí"=${a.notUnderstood}  sin respuesta=${a.silent}  errores=${a.error}  contradicción recogida=${a.pickupContradiction}`);
    lines.push(`sesiones escaladas a humano=${a.sessionsEscalated}  llegaron a resumen final=${a.reachedFinal}  pedidos confirmados=${a.confirmedOrders}`);
    lines.push(`IA: llamadas=${a.aiCalls} en ${a.aiTurns} turnos (${(100 * a.aiTurns / Math.max(1, a.turns)).toFixed(0)}% de los turnos)  tokens entrada=${a.promptTokens} salida=${a.outTokens}`);
    lines.push(`IA por turno que la usó: p50=${pct(a.aiMsPerTurn, 0.5)}ms p90=${pct(a.aiMsPerTurn, 0.9)}ms max=${pct(a.aiMsPerTurn, 0.999)}ms`);
    lines.push(`Tiempo total de proceso por turno (todos): p50=${pct(a.wallMs, 0.5)}ms p90=${pct(a.wallMs, 0.9)}ms max=${pct(a.wallMs, 0.999)}ms`);
}
lines.push(`\nAgente - caminos: ${JSON.stringify(agentPaths)}`);
lines.push(`Agente - herramientas: ${JSON.stringify(toolCount)}`);
lines.push(`\nPor sesión (nu=no entendí, sil=sin respuesta, esc=escaló):`);
for (const r of perSession) {
    lines.push(`${r.id} ${r.who} t=${r.turns}  reglas: nu=${r.legacy.nu} sil=${r.legacy.sil} esc=${r.legacy.esc ? 'SI' : 'no'}${r.legacyFinal ? ' FINAL' : ''}${r.legacyConfirmed ? ' CONFIRMADO' : ''}  |  agente: nu=${r.agent.nu} sil=${r.agent.sil} esc=${r.agent.esc ? 'SI' : 'no'}${r.agentFinal ? ' FINAL' : ''}${r.agentConfirmed ? ' CONFIRMADO' : ''}`);
}

const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
lines.push('\n\n================ LADO A LADO ================');
for (const s of data.sessions) {
    lines.push(`\n######## ${s.id} ${s.isJohan ? 'Johan' : s.jidMasked} ${s.start}`);
    s.turns.forEach((t, k) => {
        lines.push(`\n[${k + 1}] CLIENTE: ${clip(t.user, 200)}`);
        lines.push(`   PROD(log): ${clip(t.prod.join(' || '), 260) || '(nada)'}`);
        const L = t.legacy; const A = t.agent;
        lines.push(`   REGLAS  [${L.state.phase}] ${clip(L.bot.join(' || '), 320) || '(SIN RESPUESTA)'}`);
        const calls = (A.trace || []).map(tr => tr.path === 'agent' ? (tr.calls || []).map(c => `${c.name}(${clip(JSON.stringify(c.args), 90)})`).join(' + ') : tr.path).join(' ; ');
        lines.push(`   AGENTE  [${A.state.phase}] {${calls}} ${clip(A.bot.join(' || '), 320) || '(SIN RESPUESTA)'}`);
        lines.push(`   carrito R: ${clip(L.state.carrito.join('; '), 150) || '-'} | A: ${clip(A.state.carrito.join('; '), 150) || '-'}`);
    });
}

const text = lines.join('\n');
if (outTxt) fs.writeFileSync(outTxt, text);
console.log(outTxt ? lines.slice(0, 30 + perSession.length).join('\n') : text);

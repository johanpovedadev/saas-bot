'use strict';

/**
 * Simulador del AGENTE de heladería (HELADERIA_AI_AGENT=1), sin gastar tokens de Gemini.
 *   node tests_sim/run-agent.js [--filter=texto] [--verbose] [--run=ruta.json]
 * El decisor de Gemini se cambia por tests_sim/simAgent.js (reglas del prompt sobre el catálogo real).
 * Además de los escenarios, en CADA turno que atendió el agente se verifica la regla de la dueña
 * ("si la persona tiene que leer y seguir instrucciones, no pega"): sin códigos S1/T1 ni "Escribe el número".
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));

// Mensajes del flujo de reglas que el agente NO debe mostrar (solo en turnos atendidos por el agente).
const INSTRUCCIONES = [
    [/\*?\b[ST]\d{1,2}\.\*?\s+\S+/, 'lista con códigos S1/T1'],
    [/Escribe el (n[uú]mero|c[oó]digo)/i, '"Escribe el número/código"'],
    [/\*[123]\)\*|^\s*[123]\)\s/m, 'menú numerado 1) 2) 3)']
];
// Turnos donde un menú es lo que el cliente pidió o es la bienvenida.
// Los menús iniciales (bienvenida, menú principal, lista de productos) son numerados por diseño.
const MENU_INICIAL = /Ver nuestro menú|Menú principal|Menú de Productos|Pedidos por Encargo|Nuestra Ubicación/;
const EXENTAS = new Set(['saludar', 'mostrar_menu', 'info_local', 'pedido_por_encargo']);

(async () => {
    const { createWorld } = require('./world');
    const { runScenario } = require('./runner');
    const dir = path.join(__dirname, 'scenarios_agente');
    const scenarios = fs.readdirSync(dir).filter(f => /^\d+_.*\.js$/.test(f)).sort().flatMap(f => require(path.join(dir, f)));
    const selected = scenarios.filter(s => !args.filter || (s.id + ' ' + s.nombre + ' ' + s.area).toLowerCase().includes(String(args.filter).toLowerCase()));

    const log = console.log;
    const w = await createWorld({ ai: 'sim', agent: true });
    console.log = () => {}; console.warn = () => {}; console.error = () => {};

    // Envuelve customer(): tras cada turno revisa la regla de "sin instrucciones" si lo atendió el agente.
    const baseCustomer = w.customer;
    const violaciones = [];
    w.customer = (label) => {
        const c = baseCustomer(label);
        const say = c.say.bind(c);
        c.say = async (text) => {
            w.agentTraces.length = 0;
            const replies = await say(text);
            const trazas = w.agentTraces.splice(0).filter(tr => tr.jid === c.jid);
            const agente = trazas.find(tr => tr.path === 'agent' || tr.path === 'fastpath');
            if (agente && !(agente.calls || []).some(cl => EXENTAS.has(cl.name)) && !MENU_INICIAL.test(replies.join(' / '))) {
                for (const r of replies) for (const [re, que] of INSTRUCCIONES) {
                    if (re.test(r)) violaciones.push({ escenario: label, texto: text, que, respuesta: r.slice(0, 160).replace(/\n/g, ' / ') });
                }
            }
            c.lastTrazas = trazas;
            return replies;
        };
        return c;
    };

    const results = [];
    for (const s of selected) {
        const nBefore = violaciones.length;
        const r = await runScenario(s, w, 'agente');
        for (const v of violaciones.slice(nBefore)) r.failures.push({ msg: `el agente mostró ${v.que} al cliente (dijo "${v.texto}")`, detail: v.respuesta });
        results.push(r);
    }

    console.log = log;
    const failed = results.filter(r => r.failures.length);
    const byArea = {};
    for (const r of results) { const a = (byArea[r.scenario.area] = byArea[r.scenario.area] || { total: 0, ok: 0 }); a.total++; if (!r.failures.length) a.ok++; }

    log('\nSIMULADOR DEL AGENTE DE MUNDO HELADOS — decisor simulado (cero tokens)');
    for (const r of results) {
        log(`${r.failures.length ? '❌' : '✅'} [${r.scenario.area}] ${r.scenario.id}: ${r.scenario.nombre}  (${r.steps} turnos, ${r.checks} verificaciones)`);
        for (const f of r.failures) log(`      ↳ ${f.msg}\n        ${f.detail || ''}`);
        if (args.verbose || (r.failures.length && args.transcript)) for (const m of r.transcript) log(`      ${m.from === 'cliente' ? '👤' : '🤖'} ${String(m.text).replace(/\n/g, ' / ').slice(0, 220)}`);
    }
    log('\nPor área:'); for (const [a, v] of Object.entries(byArea)) log(`  ${a}: ${v.ok}/${v.total}`);
    log(`\nTOTAL: ${results.length - failed.length}/${results.length} escenarios sin fallos, ${results.reduce((n, r) => n + r.checks, 0)} verificaciones`);
    log(`Turnos decididos por el agente: ${w.simAgent.stats.turnos} · herramientas: ${Object.entries(w.simAgent.stats.porHerramienta).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`);
    if (args.run) fs.writeFileSync(args.run, JSON.stringify({ mode: 'agente', results: results.map(r => ({ id: r.scenario.id, area: r.scenario.area, nombre: r.scenario.nombre, ok: !r.failures.length, failures: r.failures, steps: r.steps, transcript: r.transcript })) }));
    process.exit(failed.length ? 1 : 0);
})();

'use strict';
/**
 * Backend falso para la suite de pruebas (lo levanta scripts/run-tests.js).
 *
 * Varias pruebas de heladería cargan el catálogo desde el backend Django (/obtener_todos_los_productos/). Sin esto
 * dependían de que HUBIERA un Django en localhost:8000: pasaban en la máquina de Johan (leyendo su base real) y
 * fallaban en cualquier máquina limpia o en CI con ECONNREFUSED. Este servidor responde con el catálogo de
 * tests_sim/fixtures (copia del real) y acepta cualquier otra llamada sin guardar nada.
 *
 * Uso: node scripts/fake-backend.js <archivo-donde-escribir-el-puerto>
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests_sim', 'fixtures', 'productos.json'), 'utf8'));

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && /\/obtener_todos_los_productos\/?/.test(req.url)) return res.end(JSON.stringify(catalog));
    if (req.method === 'GET' && /\/health\/?/.test(req.url)) return res.end(JSON.stringify({ status: 'ok', google_sheets: 'ok' }));
    if (req.method === 'GET') return res.end(JSON.stringify({ matches: [] }));
    req.resume();
    req.on('end', () => res.end(JSON.stringify({ ok: true })));
});

server.listen(0, '127.0.0.1', () => {
    const portFile = process.argv[2];
    if (portFile) fs.writeFileSync(portFile, String(server.address().port));
});

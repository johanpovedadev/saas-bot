'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TENANTS_FILE = path.join(__dirname, 'config', 'tenants.json');
const BOT_DIR = path.join(__dirname, 'bot-wasap');

if (!fs.existsSync(TENANTS_FILE)) {
    console.error(`No se encuentra ${TENANTS_FILE}`);
    console.error('Crea config/tenants.json con: { "tenants": ["mascotas", "pescaderia"], "base_chrome_port": 9222 }');
    process.exit(1);
}

let cfg;
try { cfg = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf-8')); }
catch (e) { console.error('Error leyendo tenants.json:', e.message); process.exit(1); }

const tenants = cfg.tenants || [];
const basePort = cfg.base_chrome_port || 9222;

if (tenants.length === 0) {
    console.log('No hay tenants configurados en config/tenants.json');
    process.exit(0);
}

console.log('');
console.log('='.repeat(60));
console.log('  LANZANDO BOTS MULTI-TENANT');
console.log('='.repeat(60));

// Generate a .bat file with all tenants
let batContent = '@echo off\n';
batContent += 'echo Lanzando bots multi-tenant...\n';
batContent += 'echo.\n';

tenants.forEach((key, i) => {
    const configPath1 = path.join(__dirname, 'config', 'businesses', `${key}.json`);
    const configPath2 = path.join(BOT_DIR, 'config', 'businesses', `${key}.json`);
    const configExists = fs.existsSync(configPath1) || fs.existsSync(configPath2);

    if (!configExists) {
        console.warn(`  [!] Saltando "${key}": no existe config/businesses/${key}.json`);
        return;
    }

    let bizName = key;
    try {
        const p = fs.existsSync(configPath1) ? configPath1 : configPath2;
        bizName = JSON.parse(fs.readFileSync(p, 'utf-8')).business_name || key;
    } catch (_) {}

    const chromePort = basePort + i;
    const title = `Bot ${bizName}`;
    const cmd = `cd /d "${BOT_DIR}" && set BUSINESS_KEY=${key} && set CHROME_PORT=${chromePort} && node index.js`;

    batContent += `start "${title}" cmd /k "${cmd}"\n`;
    console.log(`  [${i + 1}/${tenants.length}] ${bizName.padEnd(25)} PORT=${chromePort}`);
});

const batPath = path.join(__dirname, 'run_tenants.bat');
fs.writeFileSync(batPath, batContent, 'utf-8');

console.log('='.repeat(60));
console.log(`  Batch: ${batPath}`);
console.log('  Ejecutando...');
console.log('='.repeat(60));
console.log('');

// Execute the batch file
try {
    execSync(`"${batPath}"`, { stdio: 'inherit', cwd: __dirname });
} catch (_) {
    // The batch might close immediately if start commands are fire-and-forget
}

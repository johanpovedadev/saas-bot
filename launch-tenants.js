'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TENANTS_FILE = path.join(__dirname, 'config', 'tenants.json');
const BOT_DIR = path.join(__dirname, 'bot-wasap');

if (!fs.existsSync(TENANTS_FILE)) {
    console.error(`No se encuentra ${TENANTS_FILE}`);
    process.exit(1);
}

let cfg;
try { cfg = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf-8')); }
catch (e) { console.error('Error leyendo tenants.json:', e.message); process.exit(1); }

const tenants = cfg.tenants || [];
if (tenants.length === 0) { console.log('No hay tenants.'); process.exit(0); }

// Pre-launch: kill Chrome zombies for all tenant session dirs
console.log('Limpiando procesos Chrome zombies...');
tenants.forEach(key => {
    const sessionDir = path.join(BOT_DIR, 'auth', key, 'session');
    if (!fs.existsSync(sessionDir)) return;
    const escaped = sessionDir.replace(/\\/g, '\\\\');
    try {
        execSync(
            `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
            { timeout: 5000, stdio: 'pipe' }
        );
    } catch (_) {}
    for (const f of ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
        try { fs.unlinkSync(path.join(sessionDir, f)); } catch (_) {}
    }
});

console.log('');
console.log('='.repeat(60));
console.log('  LANZANDO BOTS MULTI-TENANT');
console.log('='.repeat(60));

tenants.forEach((key, i) => {
    let configPath = path.join(__dirname, 'config', 'businesses', `${key}.json`);
    if (!fs.existsSync(configPath)) {
        configPath = path.join(BOT_DIR, 'config', 'businesses', `${key}.json`);
    }
    if (!fs.existsSync(configPath)) {
        console.warn(`  [!] Saltando "${key}": no existe config`);
        return;
    }

    let bizName = key;
    try { bizName = JSON.parse(fs.readFileSync(configPath, 'utf-8')).business_name || key; } catch (_) {}

    const title = `Bot ${bizName}`;
    const cmd = `cd /d "${BOT_DIR}" && set BUSINESS_KEY=${key} && node index.js`;

    // Launch each bot in its own CMD window via PowerShell Start-Process
    try {
        execSync(
            `powershell -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','${cmd.replace(/'/g, "''")}' -WindowStyle Normal"`,
            { timeout: 5000, stdio: 'pipe' }
        );
    } catch (e) {
        console.warn(`  [!] Error lanzando ${bizName}: ${e.message}`);
    }

    console.log(`  [${i + 1}/${tenants.length}] ${bizName.padEnd(25)}`);
});

console.log('='.repeat(60));
console.log(`  Total: ${tenants.length} bots lanzados`);
console.log('='.repeat(60));

// Also write the batch file for manual use
let bat = '@echo off\necho Lanzando bots multi-tenant...\necho.\n';
tenants.forEach((key, i) => {
    let bizName = key;
    try {
        const p1 = path.join(__dirname, 'config', 'businesses', `${key}.json`);
        const p2 = path.join(BOT_DIR, 'config', 'businesses', `${key}.json`);
        const p = fs.existsSync(p1) ? p1 : p2;
        bizName = JSON.parse(fs.readFileSync(p, 'utf-8')).business_name || key;
    } catch (_) {}
    const title = `Bot ${bizName}`;
    const cmd = `cd /d "${BOT_DIR}" && set BUSINESS_KEY=${key} && node index.js`;
    bat += `start "${title}" cmd /k "${cmd}"\n`;
});
fs.writeFileSync(path.join(__dirname, 'run_tenants.bat'), bat, 'utf-8');
console.log(`Batch: run_tenants.bat (doble click como respaldo)`);

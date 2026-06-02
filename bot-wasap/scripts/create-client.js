'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

async function main() {
    console.log('');
    console.log('='.repeat(50));
    console.log('  CREAR NUEVO CLIENTE');
    console.log('='.repeat(50));
    console.log('');

    const businessKey = (await ask('Key del negocio (ej: mascotas, empanadas): ')).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!businessKey) { console.log('Key requerida'); process.exit(1); }

    const businessName = (await ask('Nombre del negocio: ')).trim();
    const businessType = (await ask('Tipo (INSURANCE, FOOD, ICE_CREAM, RESTAURANT, FUNERAL): ')).trim().toUpperCase() || 'FOOD';
    const sheetId = (await ask('Google Sheet ID (Productos): ')).trim();
    const sheetTab = (await ask('Sheet Tab para pedidos (ej: Entregas, LEADS): ')).trim() || 'Domicilios';
    const adminJids = (await ask('Admin JIDs separados por coma (ej: 573000000000@c.us, 573111111111@c.us): ')).trim();
    const city = (await ask('Ciudad: ')).trim() || 'Bogota';
    const department = (await ask('Departamento: ')).trim() || 'Cundinamarca';
    const apiBase = (await ask('API Base URL (ej: http://localhost:8001/api): ')).trim() || 'http://localhost:8001/api';
    const endpointOrders = (await ask('Endpoint pedidos (ej: /registrar_confirmacion/): ')).trim() || '/registrar_entrega/';

    const baseDir = path.resolve(__dirname, '..');
    const configPath = path.join(baseDir, 'config', 'businesses', `${businessKey}.json`);
    const authDir = path.join(baseDir, 'auth', businessKey);
    const assetsDir = path.join(baseDir, 'assets', businessKey);
    const logsDir = path.join(baseDir, 'logs');

    const adminList = adminJids ? adminJids.split(',').map(j => j.trim()).filter(Boolean) : [];

    const config = {
        business_name: businessName,
        business_type: businessType,
        sheet_id: sheetId || '',
        sheet_tab: sheetTab,
        business_admin_jids: adminList,
        system_admin_jids: adminList,
        contact_phone: '',
        contact_whatsapp: '',
        contact_email: '',
        city,
        department,
        timezone: 'America/Bogota',
        currency: 'COP',
        api_base: apiBase,
        api_timeout: 8000,
        endpoint_products: '/obtener_todos_los_productos/',
        endpoint_orders: endpointOrders,
        endpoint_reservations: endpointOrders,
        endpoint_search: '/buscar_producto/',
        endpoint_product_image: '/producto_imagen/'
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(authDir, { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    console.log('');
    console.log('='.repeat(50));
    console.log('  CLIENTE CREADO');
    console.log('='.repeat(50));
    console.log(`  Key:          ${businessKey}`);
    console.log(`  Nombre:       ${businessName}`);
    console.log(`  Config:       ${configPath}`);
    console.log(`  Auth:         ${authDir}`);
    console.log(`  Assets:       ${assetsDir}`);
    console.log(`  Logs:         logs/${businessKey}.log`);
    console.log('');
    console.log('  Para activar: BUSINESS_KEY=' + businessKey + ' en .env');
    console.log('='.repeat(50));
    console.log('');

    rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });

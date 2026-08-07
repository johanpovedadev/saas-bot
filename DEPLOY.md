# Flujo de Despliegue (ISSUE #37)

## Regla de Oro
Nunca pasar de Desarrollo directamente a PROD.

## Proceso

```
Desarrollo (local)
    ↓
DEV (sandbox-dev)
    ↓
Pruebas (QA)
    ↓
Aprobacion (cliente/admin)
    ↓
PROD (mascotas-prod | empanadas-prod | funeraria-prod)
```

## Pasos

### 1. Desarrollo
- Trabajar en rama `develop`
- Usar `.env` con `BUSINESS_CONFIG=sandbox-dev.config.js`
- Probar con `npm test`

### 2. DEV
- Usar `sandbox-dev.config.js` (BUSINESS_CONFIG en .env)
- Sheet de prueba diferente al de produccion
- Numero de WhatsApp de prueba

### 3. Pruebas QA
- Ejecutar: `npm run test:qa`
- Verificar 62/62 tests pasan
- Verificar heartbeat funcionando

### 4. Aprobacion
- Notificar a system_admin_jids via WhatsApp
- Esperar confirmacion explicita

### 5. PROD
- Cambiar .env: `BUSINESS_CONFIG=seguros_mascotas.config.js`
- Verificar que apunte al sheet de produccion
- Verificar que apunte al numero WhatsApp real
- PM2: `pm2 restart all`
- Monitorear primeros 10 minutos

## Comandos

```bash
# Iniciar en DEV
set BUSINESS_CONFIG=sandbox-dev.config.js
python run_wsgi.py 8002
cd bot-wasap && node index.js

# Desplegar a PROD
set BUSINESS_CONFIG=seguros_mascotas.config.js
pm2 restart ecosystem.config.js
```

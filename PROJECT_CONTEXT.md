# Contexto del Proyecto: Bot WhatsApp Multitenant

## Descripción General

Bot para WhatsApp Business que atiende múltiples negocios (tenants) desde un solo código base. Cada tenant corre como proceso PM2 independiente con su propia sesión de WhatsApp, autenticación y configuración.

## Tenants Activos

| Tenant | Business Key | PM2 Name | Flow | Estado |
|---|---|---|---|---|
| Leo Financiero | `finance` | `bot-finance` | `finance.flow.js` | ✅ Operativo |
| Seguros Mascotas | `mascotas` | `bot-mascotas-prod` | `seguros.flow.js` | ✅ Operativo |

## Arquitectura

```
empanadas/                    ← Desarrollo (finance + testing)
├── bot-wasap/index.js        ← Entry point (unico para todos los tenants)
├── bot-wasap/handlers/       ← Logica compartida
├── bot-wasap/services/       ← Servicios (AI, DB, sesiones)
├── bot-wasap/config/         ← Configuracion por tenant
└── bot-wasap/auth/finance/   ← Sesion WhatsApp de finance

empanadas-prod/               ← Produccion (solo mascotas)
├── bot-wasap/index.js
└── bot-wasap/auth/mascotas/  ← Sesion WhatsApp de mascotas
```

## Stack Tecnologico

- **Runtime**: Node.js
- **WhatsApp**: `whatsapp-web.js` v1.34.7
- **Browser**: Chrome (Puppeteer, headless=false)
- **AI**: Google Gemini (`gemini-2.0-flash`)
- **DB**: SQLite (`finance.db`, `referrals.db`, `users.db`)
- **PM2**: Gestor de procesos (auto-start configurado)
- **Chrome isolation**: `--app-name=bot-{BUSINESS_KEY}`

## Seguridad Multitenant

- Cada tenant tiene su propio directorio `auth/<key>/` y sesión de WhatsApp
- Chrome isolation por filtro de `auth/` directory en CommandLine
- Datos persistentes en SQLite separados por JID de usuario
- Admin JIDs específicos por tenant
- No usar variables globales en memoria para conversaciones

## Comandos Rapidos

```bash
pm2 status                     # Estado de todos los bots
pm2 logs bot-finance           # Logs finance en vivo
pm2 restart bot-finance        # Reiniciar finance
pm2 save                       # Guardar lista PM2
```

## Historia de Desarrollo

Ver AGENTS.md para reglas de modificacion, bugs corregidos y checklist de nuevos negocios.

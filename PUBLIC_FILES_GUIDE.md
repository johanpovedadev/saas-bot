# 📁 Guía de Archivos Públicos - Portfolio Structure

## 🎯 Objetivo

Esta guía define qué archivos pueden ser públicos en el repositorio de portfolio **sin revelar lógica de negocio propietaria**.

---

## ✅ Archivos Seguros para Publicar

### **1. Documentación (100% Público)**

```
📁 docs/
├── 📄 README.md                          ✅ Descripción general del proyecto
├── 📄 ARCHITECTURE.md                    ✅ Diagramas y explicación de arquitectura
├── 📄 TECHNICAL_CHALLENGES.md            ✅ Retos técnicos resueltos
├── 📄 PERFORMANCE_METRICS.md             ✅ Benchmarks y métricas
├── 📄 CHANGELOG.md                       ✅ Historial de versiones
├── 📄 LICENSE                            ✅ MIT o Proprietary
│
├── 📁 architecture/
│   ├── system-overview.mmd               ✅ Diagrama de componentes (Mermaid)
│   ├── state-machine.mmd                 ✅ Máquina de estados conversacionales
│   ├── data-flow.mmd                     ✅ Flujo de datos
│   └── deployment.mmd                    ✅ Arquitectura de deployment
│
├── 📁 api-specs/
│   ├── whatsapp-integration.md           ✅ Cómo se integra con WhatsApp
│   ├── google-sheets-schema.md           ✅ Estructura de las hojas de cálculo
│   ├── gemini-prompts.md                 ✅ Ejemplos de prompts (sin secrets)
│   └── webhooks.md                       ✅ Endpoints de webhooks (si aplica)
│
├── 📁 screenshots/
│   ├── complete-flow.png                 ✅ Captura de flujo completo
│   ├── fuzzy-search-demo.png             ✅ Demo de búsqueda fuzzy
│   ├── order-summary.png                 ✅ Resumen de pedido
│   ├── multi-unit-flow.png               ✅ Configuración multi-unidad
│   └── admin-panel.png                   ✅ (Si existe) Panel de administración
│
└── 📁 benchmarks/
    ├── load-test-results.md              ✅ Resultados de pruebas de carga
    ├── performance-analysis.md           ✅ Análisis de performance
    └── latency-charts.png                ✅ Gráficos de latencia
```

---

### **2. Archivos de Configuración (Sanitizados)**

```
📁 examples/
├── 📄 config.example.json                ✅ Configuración sin secrets
├── 📄 .env.example                       ✅ Variables de entorno (con placeholders)
├── 📄 google-sheets-template.xlsx        ✅ Plantilla de inventario
├── 📄 conversation-flows.md              ✅ Ejemplos de diálogos completos
└── 📄 api-responses.json                 ✅ Ejemplos de respuestas de APIs
```

**Ejemplo de `config.example.json`:**
```json
{
  "whatsapp": {
    "sessionName": "mundo-helados-bot",
    "qrTimeout": 60000,
    "browser": ["Ubuntu", "Chrome", "20.0.04"]
  },
  "googleSheets": {
    "spreadsheetId": "YOUR_SPREADSHEET_ID_HERE",
    "ranges": {
      "products": "Productos!A:F",
      "sabores": "Sabores!A:D",
      "toppings": "Toppings!A:D",
      "orders": "Pedidos!A:Z"
    }
  },
  "ai": {
    "provider": "gemini",
    "model": "gemini-pro",
    "temperature": 0.3,
    "maxTokens": 1000
  },
  "cache": {
    "products": {
      "ttl": 300000,
      "maxSize": 1000
    }
  },
  "session": {
    "timeout": 1800000,
    "gcInterval": 300000
  },
  "logging": {
    "level": "info",
    "prettyPrint": true
  }
}
```

**Ejemplo de `.env.example`:**
```bash
# WhatsApp Configuration
WHATSAPP_SESSION_NAME=mundo-helados-bot

# Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account.json

# AI Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-pro

# Application Settings
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Admin Configuration
ADMIN_PHONE_NUMBERS=+573001234567,+573009876543

# Feature Flags
ENABLE_FUZZY_SEARCH=true
ENABLE_AI_PARSER=true
ENABLE_FRUSTRATION_DETECTION=true
```

---

### **3. Tests (Estructura sin Implementación)**

```
📁 tests/
├── 📄 README.md                          ✅ Estrategia de testing explicada
├── 📄 coverage-report.png                ✅ Screenshot de cobertura
├── 📄 test-structure.md                  ✅ Descripción de tests sin código
└── 📄 test-results-summary.json          ✅ Resumen de resultados
```

**Ejemplo de `tests/README.md`:**
```markdown
# Test Strategy - Mundo Helados Bot

## Coverage Summary
- **Total tests:** 87
- **Passing:** 85 (97.7%)
- **Coverage:** 78% (líneas de código)

## Test Categories

### Unit Tests (34 tests)
- Fuzzy search algorithm
- Price calculator
- Validation layer
- Utilities (normalization, formatting)

### Integration Tests (28 tests)
- WhatsApp connection
- Google Sheets sync
- Gemini AI parsing
- Session management

### E2E Tests (25 tests)
- Complete order flow
- Multi-unit configuration
- Error recovery
- Cancellation flow

## Tools Used
- Testing framework: Jest
- Mocking: jest-mock
- Coverage: Istanbul
```

---

## ❌ Archivos que NO Deben ser Públicos

### **1. Código Fuente Propietario**

```
❌ bot-wasap/
   ├── index.js                           ❌ Entry point
   ├── handlers/                          ❌ Lógica de handlers
   ├── services/                          ❌ Servicios de negocio
   └── utils/                             ❌ Utilidades (excepto descripciones)
```

**Alternativa:** Publicar solo **descripciones de módulos** en documentación

---

### **2. Credenciales y Secrets**

```
❌ .env                                   ❌ Variables de entorno reales
❌ config.json                            ❌ Configuración con secrets
❌ service_account.json                   ❌ Credenciales de Google
❌ auth_info_baileys/                     ❌ Sesión de WhatsApp
❌ *.pem, *.key, *.p12                    ❌ Certificados/claves
```

---

### **3. Datos de Producción**

```
❌ logs/                                  ❌ Logs con datos de usuarios
❌ db.sqlite3                             ❌ Base de datos (si existe)
❌ conversations.log                      ❌ Conversaciones reales
❌ user_errors.log                        ❌ Errores con datos de usuarios
```

---

## 🎨 Archivos Visuales Públicos

### **Screenshots Recomendados**

```
📁 docs/screenshots/
├── 01-welcome-message.png                ✅ Mensaje de bienvenida
├── 02-product-menu.png                   ✅ Menú de productos
├── 03-fuzzy-search-demo.png              ✅ Búsqueda con error ortográfico
├── 04-sabor-selection.png                ✅ Selección de sabores
├── 05-topping-selection.png              ✅ Selección de toppings
├── 06-multi-unit-config.png              ✅ Configuración de múltiples unidades
├── 07-order-summary.png                  ✅ Resumen de pedido
├── 08-address-input.png                  ✅ Ingreso de dirección
├── 09-confirmation.png                   ✅ Confirmación final
├── 10-error-recovery.png                 ✅ Sistema de recuperación de errores
└── 11-admin-notification.png             ✅ Notificación a administradores
```

**Nota:** Difuminar números de teléfono y datos personales en screenshots

---

### **Diagramas en Mermaid.js**

```
📁 docs/architecture/
├── system-overview.mmd
├── state-machine.mmd
├── sequence-diagrams/
│   ├── order-flow.mmd
│   ├── payment-flow.mmd
│   └── error-handling.mmd
└── deployment.mmd
```

**Ventaja de Mermaid:** Se renderiza automáticamente en GitHub, no requiere imágenes estáticas

---

## 📦 Estructura Completa Recomendada

```
mundo-helados-bot-portfolio/
│
├── 📄 README.md                          ✅ PÚBLICO - Portfolio principal
├── 📄 LICENSE                            ✅ PÚBLICO - MIT o Proprietary
├── 📄 ARCHITECTURE.md                    ✅ PÚBLICO - Arquitectura detallada
├── 📄 TECHNICAL_CHALLENGES.md            ✅ PÚBLICO - Retos técnicos
├── 📄 PERFORMANCE_METRICS.md             ✅ PÚBLICO - Métricas y benchmarks
├── 📄 CHANGELOG.md                       ✅ PÚBLICO - Historial de versiones
├── 📄 .gitignore                         ✅ PÚBLICO - Ignorar secrets
│
├── 📁 docs/
│   ├── 📁 architecture/
│   │   ├── system-overview.mmd           ✅ PÚBLICO
│   │   ├── state-machine.mmd             ✅ PÚBLICO
│   │   ├── data-flow.mmd                 ✅ PÚBLICO
│   │   └── deployment.mmd                ✅ PÚBLICO
│   │
│   ├── 📁 api-specs/
│   │   ├── whatsapp-integration.md       ✅ PÚBLICO
│   │   ├── google-sheets-schema.md       ✅ PÚBLICO
│   │   └── gemini-prompts.md             ✅ PÚBLICO
│   │
│   ├── 📁 screenshots/
│   │   ├── complete-flow.png             ✅ PÚBLICO
│   │   ├── fuzzy-search-demo.png         ✅ PÚBLICO
│   │   └── order-summary.png             ✅ PÚBLICO
│   │
│   └── 📁 benchmarks/
│       ├── load-test-results.md          ✅ PÚBLICO
│       └── performance-analysis.md       ✅ PÚBLICO
│
├── 📁 examples/
│   ├── config.example.json               ✅ PÚBLICO
│   ├── .env.example                      ✅ PÚBLICO
│   ├── google-sheets-template.xlsx       ✅ PÚBLICO
│   ├── conversation-flows.md             ✅ PÚBLICO
│   └── api-responses.json                ✅ PÚBLICO
│
├── 📁 tests/
│   ├── README.md                         ✅ PÚBLICO - Estrategia de testing
│   ├── coverage-report.png               ✅ PÚBLICO
│   └── test-results-summary.json         ✅ PÚBLICO
│
└── 📁 [PRIVADO - No incluir en portfolio]
    ├── bot-wasap/                        ❌ PRIVADO - Código fuente
    ├── .env                              ❌ PRIVADO - Secrets
    ├── auth_info_baileys/                ❌ PRIVADO - Sesión WhatsApp
    └── logs/                             ❌ PRIVADO - Logs con datos
```

---

## 🔒 Checklist de Seguridad

Antes de publicar, verificar:

- [ ] No hay API keys, tokens o passwords en archivos públicos
- [ ] `.gitignore` incluye todos los archivos sensibles
- [ ] Screenshots tienen números de teléfono difuminados
- [ ] Ejemplos de código no contienen lógica de negocio crítica
- [ ] URLs de producción reemplazadas por placeholders
- [ ] Nombres de clientes/usuarios anonimizados
- [ ] Diagramas de arquitectura no revelan IPs o infraestructura específica
- [ ] Logs de ejemplo no contienen datos reales de usuarios
- [ ] Archivos de configuración tienen valores de ejemplo, no reales
- [ ] Documentación menciona capacidades, no implementación exacta

---

## 📝 `.gitignore` Recomendado

```gitignore
# Secrets y configuración
.env
.env.*
!.env.example
config.json
!config.example.json
service_account.json
*.pem
*.key
*.p12

# Autenticación de WhatsApp
auth_info_baileys/
qr_code.jpg

# Logs
logs/
*.log
conversations.log
user_errors.log

# Base de datos
*.sqlite3
*.db

# Node.js
node_modules/
npm-debug.log
yarn-error.log

# Sistema operativo
.DS_Store
Thumbs.db
desktop.ini

# IDEs
.vscode/
.idea/
*.swp
*.swo

# Temporal
tmp/
temp/
*.tmp

# Backups
*.bak
*.backup
backoups.json
```

---

## 🎯 Estrategia de Publicación

### **Opción 1: Repositorio Privado (Recomendado para MVP)**
```
✅ Control total de acceso
✅ Compartir link solo con reclutadores/clientes específicos
✅ Puede incluir algo más de código sin riesgo
⚠️ No visible en perfil público de GitHub
```

### **Opción 2: Repositorio Público (Para Portfolio Amplio)**
```
✅ Visible en perfil de GitHub
✅ Demuestra open-source contributions
✅ SEO para búsquedas de "WhatsApp bot Node.js"
⚠️ Solo documentación, sin código propietario
```

### **Opción 3: Repositorio Dual**
```
Repositorio A (Público):
  - README.md
  - Documentación completa
  - Diagramas
  - Screenshots

Repositorio B (Privado):
  - Código fuente completo
  - Tests
  - Configuración
  - Acceso bajo solicitud para reclutadores serios
```

---

## 📧 Plantilla de README para Acceso Privado

Para incluir en README.md:

```markdown
## 🔐 Acceso al Código Fuente

El código fuente completo de este proyecto es **privado y propietario**.

### Para Reclutadores:
Si estás evaluando este proyecto como parte de un proceso de selección, puedo proporcionar:
- ✅ Acceso temporal al repositorio privado
- ✅ Sesión de code walkthrough en vivo
- ✅ Revisión de pull requests históricos
- ✅ Explicación técnica de cualquier componente

**Contacto:** [tu-email@ejemplo.com](mailto:tu-email@ejemplo.com)

### Para Clientes Potenciales:
Ofrezco:
- ✅ Demo en vivo personalizada
- ✅ Consultoría para implementación en tu negocio
- ✅ Licencia del código bajo acuerdo comercial
- ✅ Soporte técnico y mantenimiento

**Agendar demo:** [calendly.com/tu-usuario](https://calendly.com/tu-usuario)
```

---

## ✅ Checklist Final de Publicación

### **Antes de hacer público:**

1. **Documentación:**
   - [ ] README.md completo y profesional
   - [ ] Diagramas de arquitectura actualizados
   - [ ] Screenshots sin datos sensibles
   - [ ] Métricas de performance verificadas

2. **Seguridad:**
   - [ ] `.gitignore` configurado correctamente
   - [ ] No hay secrets en el historial de Git
   - [ ] Archivos de ejemplo tienen placeholders
   - [ ] URLs de producción reemplazadas

3. **Calidad:**
   - [ ] Markdown bien formateado
   - [ ] Links funcionan correctamente
   - [ ] Badges actualizados (si aplican)
   - [ ] Ortografía revisada

4. **Legal:**
   - [ ] Licencia definida (MIT, Proprietary, etc.)
   - [ ] Derechos de autor claros
   - [ ] No incluye código de terceros sin atribución

5. **Presentación:**
   - [ ] Estructura de carpetas clara
   - [ ] Nombres de archivos descriptivos
   - [ ] Emojis usados apropiadamente
   - [ ] Tono profesional en toda la documentación

---

**Última actualización:** Diciembre 2024  
**Versión del documento:** 1.0.0

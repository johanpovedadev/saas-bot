# 📚 Índice del Portfolio - Bot de WhatsApp E-Commerce

Este repositorio contiene la documentación completa del **Bot de WhatsApp para Comercialización de Heladería** desarrollado con Node.js, Gemini AI y arquitectura event-driven.

---

## 📖 **Estructura de Documentación**

### **🚀 Inicio Rápido**

| Documento | Descripción | Audiencia |
|-----------|-------------|-----------|
| **[README.md](README.md)** | Vista general completa del proyecto | Todos |
| **[PUBLICATION_GUIDE.md](PUBLICATION_GUIDE.md)** | Guía para publicar en GitHub | Desarrollador |
| **[EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md)** | Resumen ejecutivo de 1 página | Reclutadores, Gerentes |

---

### **🏗️ Documentación Técnica**

| Documento | Contenido | Ideal para... |
|-----------|-----------|---------------|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Arquitectura detallada (C4, patrones, trade-offs) | Entrevistas técnicas |
| **[TECHNICAL_CHALLENGES.md](TECHNICAL_CHALLENGES.md)** | 4 retos técnicos resueltos con código | Code reviews |
| **[PERFORMANCE_METRICS.md](PERFORMANCE_METRICS.md)** | Métricas, benchmarks, KPIs | Demostrar impacto |
| **[CONVERSATION_EXAMPLES.md](CONVERSATION_EXAMPLES.md)** | 6 flujos de conversación reales | Entender UX |

---

### **📁 Archivos de Configuración**

| Archivo | Propósito |
|---------|-----------|
| **[examples/config.example.json](examples/config.example.json)** | Configuración de ejemplo (sin secrets) |
| **[examples/.env.example](examples/.env.example)** | Variables de entorno template |
| **[examples/sample-conversation.json](examples/sample-conversation.json)** | Conversación completa en formato JSON |

---

### **📊 Assets Visuales**

| Ubicación | Contenido |
|-----------|-----------|
| **[docs/architecture/](docs/architecture/)** | Diagramas Mermaid (system-overview, state-machine) |
| **[docs/screenshots/](docs/screenshots/)** | Capturas de pantalla del bot (agregar manualmente) |
| **[docs/benchmarks/](docs/benchmarks/)** | Resultados de pruebas de carga |

---

### **📜 Legal & Versionado**

| Documento | Descripción |
|-----------|-------------|
| **[LICENSE](LICENSE)** | Licencia MIT (código abierto) |
| **[CHANGELOG.md](CHANGELOG.md)** | Historial de versiones desde v0.5.0 |

---

## 🎯 **Mapas de Lectura por Objetivo**

### **Para Reclutadores (Tiempo estimado: 10 minutos)**

1. **[EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md)** _(5 min)_  
   → Resumen completo de 1 página con métricas de impacto

2. **[README.md](README.md#-resultados-medibles)** _(3 min)_  
   → Saltar a sección "Resultados Medibles" y "Métricas de Rendimiento"

3. **[docs/screenshots/](docs/screenshots/)** _(2 min)_  
   → Ver capturas de pantalla del bot en acción

**Bonus:** Ver video demo en README (si está disponible)

---

### **Para Entrevistas Técnicas (Tiempo estimado: 30 minutos)**

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** _(15 min)_  
   → Entender decisiones de arquitectura y trade-offs

2. **[TECHNICAL_CHALLENGES.md](TECHNICAL_CHALLENGES.md)** _(10 min)_  
   → Leer al menos 2 retos técnicos (ej: #1 Estado Sin DB, #3 Fuzzy Search)

3. **[PERFORMANCE_METRICS.md](PERFORMANCE_METRICS.md)** _(5 min)_  
   → Revisar latencias, throughput y metodología de testing

**Preguntas Frecuentes en Entrevistas:**
- ¿Por qué Baileys y no la API oficial? → Ver [ARCHITECTURE.md - Trade-offs](ARCHITECTURE.md#trade-offs)
- ¿Cómo manejas concurrencia? → Ver [TECHNICAL_CHALLENGES.md - Reto #1](TECHNICAL_CHALLENGES.md#reto-1)
- ¿Métricas de producción? → Ver [PERFORMANCE_METRICS.md](PERFORMANCE_METRICS.md)

---

### **Para Code Review / Pair Programming (Tiempo estimado: 45 minutos)**

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** _(10 min)_  
   → Revisar diagrama C4 y capas de la arquitectura

2. **[TECHNICAL_CHALLENGES.md](TECHNICAL_CHALLENGES.md)** _(25 min)_  
   → Leer TODOS los retos técnicos (4 en total) con ejemplos de código

3. **[examples/config.example.json](examples/config.example.json)** _(5 min)_  
   → Entender estructura de configuración

4. **[CONVERSATION_EXAMPLES.md](CONVERSATION_EXAMPLES.md)** _(5 min)_  
   → Ver al menos 2 flujos (ej: Pedido Simple, Manejo de Errores)

---

### **Para Clonar/Implementar (Desarrolladores)**

1. **[PUBLICATION_GUIDE.md](PUBLICATION_GUIDE.md)** _(15 min)_  
   → Leer guía completa de publicación

2. **[examples/](examples/)** _(10 min)_  
   → Revisar archivos de configuración

3. **[docs/](docs/)** _(Variable)_  
   → Explorar diagramas y documentación adicional

**Nota:** Este repositorio NO contiene código fuente. Para acceso al código:
- Contactar al desarrollador (ver README.md - Sección Contacto)
- Disponible bajo licencia propietaria para entrevistas técnicas

---

## 📊 **Métricas Destacadas del Proyecto**

| Métrica | Valor | Benchmark |
|---------|-------|-----------|
| **Uptime** | 99.5% | ✅ Industria: 99%+ |
| **Latencia P50** | 280ms | ✅ Target: <500ms |
| **Throughput** | 150 msg/min | ✅ Target: 100+ |
| **Conversion Rate** | 60.6% | ✅ Industria: 40-50% |
| **ROI** | 360% | ✅ Positivo en 6 meses |

Más detalles: **[PERFORMANCE_METRICS.md](PERFORMANCE_METRICS.md)**

---

## 🛠️ **Stack Tecnológico**

```
Frontend (WhatsApp)
  └─ Baileys v6.7.5 (WebSocket API)

Backend
  └─ Node.js 18.x + JavaScript

Services
  ├─ Google Gemini 1.5 Flash (NLP/IA)
  ├─ Google Sheets API v4 (Database)
  └─ Winston (Logging)

Patrones
  ├─ State Machine (Conversational Flows)
  ├─ Strategy Pattern (Multiple Services)
  ├─ Cache Aside (Product Catalog)
  └─ Observer Pattern (Event Handling)
```

---

## 🎥 **Demo & Visualizaciones**

### **Video Demo**
> 📹 [Agregar link cuando esté disponible](README.md#-demo)

### **Screenshots Disponibles**
- Flujo de pedido completo
- Resumen automatizado
- Panel de administración
- Búsqueda fuzzy con typos
- Manejo de errores

📁 **Ubicación:** `docs/screenshots/`  
📖 **Guía de capturas:** `docs/screenshots/README.md`

---

## 🏆 **Casos de Uso Destacados**

1. **Pedido Simple** - Usuario con experiencia  
   → Ver: [CONVERSATION_EXAMPLES.md - Caso #1](CONVERSATION_EXAMPLES.md)

2. **Pedido con Typos** - Manejo de errores tipográficos  
   → Ver: [CONVERSATION_EXAMPLES.md - Caso #2](CONVERSATION_EXAMPLES.md)

3. **Carrito Multi-Producto** - Varios items en un pedido  
   → Ver: [CONVERSATION_EXAMPLES.md - Caso #3](CONVERSATION_EXAMPLES.md)

4. **Búsqueda Fuzzy** - "chcolate chip" → "Chocolate Chip"  
   → Ver: [TECHNICAL_CHALLENGES.md - Reto #3](TECHNICAL_CHALLENGES.md)

5. **Auto-Reconexión** - Recuperación ante caídas  
   → Ver: [TECHNICAL_CHALLENGES.md - Reto #4](TECHNICAL_CHALLENGES.md)

---

## 📞 **Contacto y Código Fuente**

### **Desarrollador**
- **Nombre:** [Actualizar con tu nombre]
- **Email:** [Actualizar con tu email]
- **LinkedIn:** [Actualizar con tu perfil]
- **GitHub:** [Actualizar con tu perfil]

### **Acceso al Código Fuente**
El código fuente completo está disponible bajo solicitud para:
- ✅ Procesos de entrevista técnica
- ✅ Code reviews con reclutadores
- ✅ Pair programming sessions

**Licencia:** Propietaria (ver [LICENSE](LICENSE))

---

## 🚀 **Roadmap Futuro**

**Q1 2025:**
- [ ] Integración con pasarelas de pago (Wompi/PayU)
- [ ] Dashboard web para administradores
- [ ] Multi-idioma (ES/EN)

**Q2 2025:**
- [ ] Migración a PostgreSQL + Redis
- [ ] API REST para integraciones
- [ ] Sistema de recomendaciones con ML

Más detalles: **[README.md - Roadmap](README.md#-roadmap-futuro)**

---

## 📝 **Historial de Cambios**

| Versión | Fecha | Cambios Principales |
|---------|-------|---------------------|
| **v2.0.0** | 2024-12-24 | Fuzzy search, per-unit fix, logs mejorados |
| **v1.5.0** | 2024-12-20 | Auto-reconexión, backoff exponencial |
| **v1.0.0** | 2024-12-01 | MVP inicial, flujos básicos |

Ver completo: **[CHANGELOG.md](CHANGELOG.md)**

---

## 📚 **Recursos Adicionales**

| Recurso | Descripción |
|---------|-------------|
| **[DEVELOPER_SETUP.md](docs/DEVELOPER_SETUP.md)** | Guía de instalación local (si tienes código) |
| **[SECRET_ROTATION.md](docs/SECRET_ROTATION.md)** | Mejores prácticas de seguridad |
| **[docs/README.md](docs/README.md)** | Índice completo de documentación técnica |

---

## ⭐ **¿Te resultó útil este proyecto?**

Si eres reclutador y este portfolio te ayudó a evaluar habilidades técnicas, considera:
- ⭐ Dar una estrella al repositorio
- 💼 Compartir feedback en LinkedIn
- 📧 Contactar para una entrevista

---

<div align="center">

**Desarrollado con ❤️ y ☕ para demostrar excelencia técnica**

*Última actualización: Diciembre 2024*

</div>

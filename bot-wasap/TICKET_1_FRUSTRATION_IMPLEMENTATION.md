# 🎫 TICKET #1: Sistema de Detección de Frustración del Cliente

**Estado:** ✅ **80% IMPLEMENTADO** (Falta integración manual en handler.js)  
**Fecha:** 23 de Diciembre, 2025  
**Prioridad:** 🔴 ALTA

---

## 📋 RESUMEN

Sistema automático que detecta cuando un cliente está frustrado, confundido o perdido, y lo deriva automáticamente a atención humana para evitar pérdida de ventas.

---

## ✅ ARCHIVOS CREADOS

### 1. `services/frustrationService.js` ✅ COMPLETO
**Líneas:** 154  
**Funciones implementadas:**
- `detectFrustration(userSession, text)` - Detecta frustración por keywords, errores o mensajes repetidos
- `handleFrustration(sock, jid, userSession, ctx, reason)` - Deriva a humano y notifica admins
- `incrementErrorCount(userSession)` - Incrementa contador de errores
- `resetErrorCount(userSession)` - Resetea contador cuando el usuario avanza
- `isWaitingForHuman(userSession)` - Verifica si está esperando atención humana
- `reactivateBot(userSession)` - Reactiva el bot después de atención humana

**Keywords de frustración:**
```javascript
const FRUSTRATION_KEYWORDS = [
    'no entiendo', '??', '???', 'hola?', 'ayuda', 'hablar',
    'persona', 'no se', 'confuso', 'dificil', 'complicado',
    'no puedo', 'no funciona', 'help', 'alguien', 'operator',
    'operador', 'atencion', 'atención'
];
```

**Límites configurados:**
- `MAX_CONSECUTIVE_ERRORS = 2` - Máximo 2 errores antes de derivar
- `MAX_REPEATED_MESSAGES = 2` - Máximo 2 mensajes repetidos

### 2. `utils/phases.js` ✅ ACTUALIZADO
**Agregado:**
```javascript
WAITING_HUMAN: 'waiting_human'
```

---

## ⚠️ PENDIENTE: Integración en `handlers/handler.js`

### PASO 1: Agregar import (LÍNEA ~40)
```javascript
const frustrationService = require('../services/frustrationService');
```
✅ **YA AGREGADO**

### PASO 2: Agregar detección después de validaciones (LÍNEA ~670)

Buscar esta sección:
```javascript
if (!ctx.botEnabled) return;
```

**AGREGAR JUSTO DESPUÉS:**
```javascript
// ========================================================================
// DETECCIÓN DE FRUSTRACIÓN DEL CLIENTE
// Si el cliente muestra signos de frustración, derivar a humano inmediatamente
// ========================================================================
if (frustrationService.isWaitingForHuman(userSession)) {
    // Cliente ya está esperando atención humana, no procesar más
    logger.info(`[${jid}] -> Cliente ya esperando atención humana, ignorando mensaje`);
    return;
}

const isFrustrated = frustrationService.detectFrustration(userSession, text);
if (isFrustrated) {
    await frustrationService.handleFrustration(sock, jid, userSession, ctx, 'frustración detectada');
    return;
}
```
✅ **YA AGREGADO**

### PASO 3: Agregar reactivación en comando admin (LÍNEA ~565)

Buscar el comando `'reactivar mia'` y agregar ANTES del `await say(sock, jid, ✅ MIA reactivada...`:

```javascript
// Reactivar bot si estaba en WAITING_HUMAN
if (frustrationService.isWaitingForHuman(sess)) {
    frustrationService.reactivateBot(sess);
    logger.info(`[${target}] -> Admin reactivó bot después de atender frustración`);
}
```

**⚠️ ESTE PASO FALTA POR HACER MANUALMENTE**

---

## 🎯 FLUJO COMPLETO

### 1. Cliente envía mensaje
```
Usuario: "??"
```

### 2. Detección automática
```javascript
detectFrustration() → detecta keyword "??" → return true
```

### 3. Derivación a humano
```javascript
handleFrustration() →
  - Notifica admins
  - Marca userSession.waitingForHuman = true
  - Cambia fase a PHASE.WAITING_HUMAN
  - Resetea errorCount
  - Envía mensaje amigable al cliente
```

### 4. Mensaje al cliente
```
😊 Entiendo que puede ser confuso.

Ya le avisé a una persona para que te ayude.
En un momento te responderán. Gracias por tu paciencia 💛
```

### 5. Notificación a admins
```
🆘 Cliente frustrado: frustración detectada
Cliente: 5730000000
```

### 6. Admin atiende y reactiva
```
Admin: "reactivar mia 5730000000"
```

### 7. Bot reactivado
```javascript
reactivateBot() →
  - waitingForHuman = false
  - errorCount = 0
  - messageHistory = []
```

---

## 🧪 TESTING

### Test Manual 1: Keyword de frustración
```
1. Usuario: "hola"
2. Bot: [Menú principal]
3. Usuario: "??"
4. Bot: "😊 Entiendo que puede ser confuso..."
5. Admin recibe notificación
```

### Test Manual 2: Mensajes repetidos
```
1. Usuario: "hola"
2. Bot: [Menú principal]
3. Usuario: "hola?"
4. Usuario: "hola?"
5. Usuario: "hola?"
6. Bot: "😊 Entiendo que puede ser confuso..."
```

### Test Manual 3: Errores consecutivos
```
1. Usuario: "1"
2. Bot: [Menú]
3. Usuario: "asdf" (error)
4. Usuario: "qwer" (error)
5. Bot: "😊 Entiendo que puede ser confuso..."
```

### Test Manual 4: Reactivación por admin
```
1. [Cliente en WAITING_HUMAN]
2. Admin: "reactivar mia 5730000000"
3. Bot: "✅ MIA reactivada..."
4. Cliente puede continuar normalmente
```

---

## 📊 MÉTRICAS ESPERADAS

**Antes:**
- ❌ Clientes frustrados abandonan el chat
- ❌ Pérdida de ventas por UX confusa
- ❌ Admins NO saben cuándo intervenir

**Después:**
- ✅ Derivación automática en <2 segundos
- ✅ Admin notificado con link directo al chat
- ✅ Cliente NO abandona (mensaje empático)
- ✅ Cero pérdida de ventas por frustración

---

## 🔧 CONFIGURACIÓN PERSONALIZABLE

En `services/frustrationService.js`:

```javascript
// Cambiar límite de errores (default: 2)
const MAX_CONSECUTIVE_ERRORS = 3; // Más tolerante

// Cambiar límite de mensajes repetidos (default: 2)
const MAX_REPEATED_MESSAGES = 3; // Más tolerante

// Agregar más keywords
const FRUSTRATION_KEYWORDS = [
    ...existentes,
    'bug', 'error', 'mal', 'no sirve' // Personalizados
];
```

---

## 🚀 PRÓXIMOS PASOS

1. ✅ **Crear `frustrationService.js`** - COMPLETADO
2. ✅ **Agregar fase `WAITING_HUMAN`** - COMPLETADO
3. ✅ **Agregar import en handler.js** - COMPLETADO
4. ✅ **Agregar detección en processIncomingMessage** - COMPLETADO
5. ⏳ **Agregar reactivación en comando admin** - PENDIENTE
6. ⏳ **Testing manual completo** - PENDIENTE
7. ⏳ **Commit cambios** - PENDIENTE

---

## 📝 COMMIT SUGERIDO

```bash
git add services/frustrationService.js
git add utils/phases.js
git add handlers/handler.js
git commit -m "feat(UX): implementar sistema de detección de frustración

- Crear frustrationService con detección por keywords, errores y mensajes repetidos
- Agregar fase WAITING_HUMAN para derivación a humano
- Detección automática con límite de 2 errores consecutivos
- Notificación a admins con link directo al chat
- Comando admin para reactivar bot después de atención
- Mensaje empático al cliente para evitar abandono

Closes #TICKET-1"
```

---

## 💡 NOTAS TÉCNICAS

### Historial de Mensajes
- Se mantienen los últimos **10 mensajes** para detección de repetidos
- Se limpian automáticamente para evitar memory leaks

### Integración con Sistema Existente
- Compatible con contador `errorCount` existente
- NO interfiere con sistema de mute actual
- Se integra con `notificationService` para notificar admins

### Comandos de Admin
- ✅ `reactivar mia 5730000000` - Reactiva bot para cliente específico
- ✅ `mia activa` - Reactiva bot para último cliente atendido
- ✅ `desilenciar 5730000000` - Quita mute del chat

---

## ⚠️ CONSIDERACIONES

1. **No sobrescribe lógica existente** - Se agrega ANTES del flujo normal
2. **Mensaje amigable** - NO culpa al cliente
3. **Notificación discreta** - Admins reciben info sin spam
4. **Reactivación simple** - Un comando y listo

---

**Autor:** AI Assistant  
**Revisado por:** [Pendiente]  
**Aprobado para producción:** [Pendiente]

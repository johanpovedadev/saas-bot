# ✅ Checklist de Validación - Google Sheets

## 🎯 Objetivo
Verificar que los 3 campos críticos lleguen correctamente al Google Sheet de "Entregas":
1. **Columna C - Producto**: Concatenación de todos los productos con sabores y toppings
2. **Columna D - Código**: Concatenación de todos los códigos
3. **Columna G - Monto**: Total del pedido incluyendo toppings

---

## 📋 ESTRUCTURA DEL SHEET "Entregas"

| Col | Nombre | Fuente en Payload | Ejemplo |
|-----|--------|-------------------|---------|
| A | Fecha | `fecha` | `2024-12-24 10:30:00` |
| B | Nombre | `nombre` | `Juan Pérez` |
| **C** | **Producto** | **`producto`** | **Ver sección crítica ↓** |
| **D** | **Código** | **`codigo`** | **Ver sección crítica ↓** |
| E | Teléfono | `telefono` | `3001234567` |
| F | Dirección | `direccion` | `Cra 23 #10-05` |
| **G** | **Monto** | **`monto`** | **Ver sección crítica ↓** |
| H | Pago | `pago` | `efectivo` |
| I | Estado | `estado` | `Por despachar` |
| J | Observaciones | `observaciones` | `Origen: WhatsApp...` |
| K | Referido Por | `referido_por` | _(vacío)_ |

---

## ⚠️ COLUMNAS CRÍTICAS - VALIDACIÓN DETALLADA

### **COLUMNA C - PRODUCTO** (CRÍTICO #1)

#### ✅ **Formato Esperado:**
```
Producto1 (Sabores: sabor1, sabor2) (Toppings: topping1, topping2); Observaciones: obs x cantidad; Producto2 (Sabores: sabor3) x cantidad; ...
```

#### 📝 **Ejemplo Real:**
```
Copa Tormenta de Chocolate (Sabores: Chocolate, Brownie, Arequipe) (Toppings: chocolatina wafer jet, galletas oreo); Observaciones: Sin lactosa x2; Malteada Fresa con Chocolate (Sabores: Fresa, Chocolate) x1; Sundae Genérico (Sabores: Vainilla) (Toppings: M&M) x1
```

#### ✓ **Qué Validar:**
- [ ] Contiene TODOS los productos del pedido
- [ ] Cada producto tiene su nombre completo
- [ ] Sabores entre paréntesis con prefijo "Sabores:"
- [ ] Toppings entre paréntesis con prefijo "Toppings:" (si los hay)
- [ ] Observaciones con prefijo "Observaciones:" (si las hay)
- [ ] Cantidad al final con formato "x#"
- [ ] Productos separados por punto y coma (`;`)
- [ ] NO está vacío
- [ ] NO dice "undefined" o "null"

#### ❌ **Errores Comunes:**
- Campo vacío → Backend espera `productos` (plural) en vez de `producto` (singular)
- Solo aparece 1 producto cuando hay varios → No se está concatenando correctamente
- Falta información de sabores/toppings → No se está construyendo el string correctamente

---

### **COLUMNA D - CÓDIGO** (CRÍTICO #2)

#### ✅ **Formato Esperado:**
```
CODIGO1; CODIGO2; CODIGO3
```

#### 📝 **Ejemplo Real:**
```
CI-TOR-CHOC; MA-FRE-CHOC; SU-GEN
```

#### ✓ **Qué Validar:**
- [ ] Contiene TODOS los códigos del pedido
- [ ] Códigos separados por punto y coma y espacio (`; `)
- [ ] NO está vacío
- [ ] NO dice "undefined" o "null"
- [ ] Cantidad de códigos coincide con cantidad de productos

#### ❌ **Errores Comunes:**
- Campo vacío → Backend espera `codigos` (plural) en vez de `codigo` (singular)
- Solo aparece 1 código cuando hay varios → No se está concatenando correctamente

---

### **COLUMNA G - MONTO** (CRÍTICO #3)

#### ✅ **Formato Esperado:**
```
[número] (suma de precio base + toppings de TODOS los productos)
```

#### 📝 **Ejemplo Real:**
```
43500
```

#### 📊 **Cálculo Detallado:**
```
Producto 1: Copa Tormenta x2
  - Precio base: 9000 x 2 = 18000
  - Topping 1: 2500 x 2 = 5000
  - Topping 2: 2500 x 2 = 5000
  - Subtotal: 28000

Producto 2: Malteada x1
  - Precio base: 7500 x 1 = 7500
  - Sin toppings
  - Subtotal: 7500

Producto 3: Sundae x1
  - Precio base: 6000 x 1 = 6000
  - Topping 1: 2000 x 1 = 2000
  - Subtotal: 8000

TOTAL: 28000 + 7500 + 8000 = 43500
```

#### ✓ **Qué Validar:**
- [ ] Es un número (no vacío, no texto)
- [ ] Es mayor que 0
- [ ] Suma correctamente:
  - Precio base × cantidad de cada producto
  - Precio de cada topping × cantidad del producto
  - Total de todos los productos
- [ ] NO incluye costo de domicilio (ese se suma después en el bot)

#### ❌ **Errores Comunes:**
- Campo vacío → Backend espera `total` en vez de `monto`
- Monto incorrecto → No se están sumando los toppings
- Monto muy bajo → Solo se suma 1 producto en vez de todos

---

## 🧪 EJEMPLO COMPLETO DE VALIDACIÓN

### **Pedido de Prueba:**
```javascript
Producto 1: Copa Tormenta de Chocolate x2
  - Sabores: Chocolate, Brownie, Arequipe
  - Toppings: chocolatina wafer jet ($2500), galletas oreo ($2500)
  - Precio: $9000
  - Observaciones: "Sin lactosa"

Producto 2: Malteada Fresa con Chocolate x1
  - Sabores: Fresa, Chocolate
  - Precio: $7500

Producto 3: Sundae Genérico x1
  - Sabores: Vainilla
  - Toppings: M&M ($2000)
  - Precio: $6000
```

### **Resultado Esperado en el Sheet:**

| Columna | Valor Esperado |
|---------|----------------|
| **C (Producto)** | `Copa Tormenta de Chocolate (Sabores: Chocolate, Brownie, Arequipe) (Toppings: chocolatina wafer jet, galletas oreo); Observaciones: Sin lactosa x2; Malteada Fresa con Chocolate (Sabores: Fresa, Chocolate) x1; Sundae Genérico (Sabores: Vainilla) (Toppings: M&M) x1` |
| **D (Código)** | `CI-TOR-CHOC; MA-FRE-CHOC; SU-GEN` |
| **G (Monto)** | `43500` |

---

## 🚀 CÓMO EJECUTAR LA VALIDACIÓN

### **Paso 1: Iniciar Backend**
```powershell
Set-Location C:\Users\Administrador\Documents\Mundoherladosco\API_inventario
python manage.py runserver 8001
```

### **Paso 2: Ejecutar Test**
```powershell
Set-Location C:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
node test_send_to_sheet.js
```

### **Paso 3: Abrir Google Sheet**
1. Ve a Google Sheets
2. Abre el sheet "Entregas" de Mundo Helados
3. Ve a la ÚLTIMA fila (scroll hasta el final)
4. Busca la fila con fecha/hora reciente (hoy, hace unos segundos)

### **Paso 4: Validar Columnas**
Usa este checklist:

- [ ] **Columna A (Fecha)**: Tiene fecha/hora actual
- [ ] **Columna B (Nombre)**: Dice "TEST - Validación Sheets"
- [ ] **Columna C (Producto)**: ⚠️ CRÍTICO
  - [ ] NO está vacía
  - [ ] Contiene los 3 productos
  - [ ] Cada producto tiene sabores
  - [ ] Productos con toppings los muestran
  - [ ] Primera producto tiene "Observaciones: Sin lactosa"
  - [ ] Productos separados por `;`
- [ ] **Columna D (Código)**: ⚠️ CRÍTICO
  - [ ] NO está vacía
  - [ ] Contiene "CI-TOR-CHOC; MA-FRE-CHOC; SU-GEN"
  - [ ] 3 códigos separados por `;`
- [ ] **Columna E (Teléfono)**: Tiene "3001234567"
- [ ] **Columna F (Dirección)**: Tiene la dirección de prueba
- [ ] **Columna G (Monto)**: ⚠️ CRÍTICO
  - [ ] NO está vacía
  - [ ] Es un número
  - [ ] Valor = 43500
- [ ] **Columna H (Pago)**: Dice "efectivo"
- [ ] **Columna I (Estado)**: Dice "TEST - Por validar"
- [ ] **Columna J (Observaciones)**: Tiene "Origen: WhatsApp Bot - TEST..."

---

## ✅ CRITERIOS DE ÉXITO

El fix se considera **100% exitoso** si:

1. ✅ **Columna C (Producto)**: 
   - NO vacía
   - Contiene los 3 productos completos
   - Con sabores y toppings formateados correctamente

2. ✅ **Columna D (Código)**:
   - NO vacía
   - Contiene los 3 códigos separados por `;`

3. ✅ **Columna G (Monto)**:
   - NO vacía
   - Valor exacto = 43500

4. ✅ **Backend retorna HTTP 200**

5. ✅ **No hay errores en logs del backend**

---

## ❌ QUÉ HACER SI FALLA

### **Si Columna C (Producto) está vacía:**
1. Verificar que el bot envíe `producto` (singular) no `productos` (plural)
2. Revisar archivo: `bot-wasap/services/checkoutHandler.js` línea ~343
3. Buscar: `producto: fallbackProductsText,`
4. Verificar que NO diga `productos:` (plural)

### **Si Columna D (Código) está vacía:**
1. Verificar que el bot envíe `codigo` (singular) no `codigos` (plural)
2. Revisar archivo: `bot-wasap/services/checkoutHandler.js` línea ~344
3. Buscar: `codigo: fallbackCodes,`
4. Verificar que NO diga `codigos:` (plural)

### **Si Columna G (Monto) está vacía o incorrecta:**
1. Verificar que el bot envíe `monto` no `total`
2. Revisar archivo: `bot-wasap/services/checkoutHandler.js` línea ~347
3. Buscar: `monto: orderTotal,`
4. Verificar que NO diga `total:` (el backend espera `monto`)

### **Si el backend retorna 400 Bad Request:**
1. Revisar logs del backend en la terminal
2. Buscar mensaje: "Faltan datos obligatorios"
3. Verificar que el payload incluya: `nombre`, `telefono`, `direccion`, `monto`, `producto`, `codigo`

---

## 📞 AYUDA ADICIONAL

- **Guía rápida**: `START_HERE.md`
- **Guía completa**: `COMO_VALIDAR_SHEETS_FIX.md`
- **Script de ayuda**: `node help_validation.js`

---

**Última actualización:** 24 de Diciembre, 2024  
**Commit del fix:** `0d1606d`  
**Autor:** GitHub Copilot

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
VALIDACIÓN RÁPIDA DEL SISTEMA
Ejecuta todos los checks críticos en 10 segundos
"""

import os
import sys
import json
import base64
import requests
from pathlib import Path
from dotenv import load_dotenv

# Colores
OK = '\033[92m✓\033[0m'
ERR = '\033[91m✗\033[0m'
WARN = '\033[93m⚠\033[0m'

print("\n" + "="*50)
print("  VALIDACIÓN RÁPIDA DEL SISTEMA")
print("="*50)

# Cargar .env
BASE_DIR = Path(__file__).parent
ENV_PATH = BASE_DIR / 'bot-wasap' / '.env'
load_dotenv(ENV_PATH)

# 1. Credenciales
print(f"\n1. Credenciales Google:")
sa_b64 = os.getenv('GOOGLE_SERVICE_ACCOUNT_B64')
if sa_b64 and len(sa_b64) > 3000:
    try:
        sa_json = json.loads(base64.b64decode(sa_b64).decode('utf-8'))
        email = sa_json.get('client_email', '')
        if 'djangoinventoryservice' in email:
            print(f"   {OK} Correcto: {email}")
        else:
            print(f"   {WARN} Email inesperado: {email}")
    except:
        print(f"   {ERR} Error al decodificar")
else:
    print(f"   {ERR} No configurado o inválido")

# 2. Backend Django
print(f"\n2. Backend Django:")
API_BASE = os.getenv('API_BASE', 'http://127.0.0.1:8001/api')
try:
    r = requests.get(f"{API_BASE}/consultar_sabores_y_toppings/", timeout=3)
    if r.status_code == 200:
        data = r.json()
        s = len(data.get('sabores', []))
        t = len(data.get('toppings', []))
        print(f"   {OK} Conectado: {s} sabores, {t} toppings")
    else:
        print(f"   {ERR} Error {r.status_code}")
except requests.exceptions.ConnectionError:
    print(f"   {ERR} No responde (¿está corriendo?)")
    print(f"       Ejecutar: python manage.py runserver 8001")
except Exception as e:
    print(f"   {ERR} Error: {str(e)[:40]}")

# 3. Búsqueda de productos
print(f"\n3. Búsqueda de productos:")
try:
    r = requests.get(f"{API_BASE}/buscar_producto_por_nombre/?q=buho", timeout=3)
    if r.status_code == 200:
        data = r.json()
        nombre = data.get('NombreProducto', '')
        if nombre:
            print(f"   {OK} Funcional: '{nombre}'")
        else:
            print(f"   {WARN} Respuesta inesperada")
    else:
        print(f"   {ERR} Error {r.status_code}")
except Exception as e:
    print(f"   {ERR} Error: {str(e)[:40]}")

# 4. Archivo fallback
print(f"\n4. Archivo fallback:")
fallback = BASE_DIR / 'tmp' / 'resp_sabores.json'
if fallback.exists():
    try:
        with open(fallback, 'r', encoding='utf-8') as f:
            data = json.load(f)
        s = len(data.get('sabores', []))
        t = len(data.get('toppings', []))
        print(f"   {OK} Válido: {s} sabores, {t} toppings")
    except json.JSONDecodeError:
        print(f"   {ERR} JSON inválido (BOM UTF-8?)")
        print(f"       Ejecutar: python fix_bom.py")
    except Exception as e:
        print(f"   {WARN} Error: {str(e)[:40]}")
else:
    print(f"   {WARN} No encontrado (no crítico)")

# Resumen
print("\n" + "="*50)
print("  RESUMEN")
print("="*50)
print("\nSi todos los checks tienen ✓, el sistema está OK")
print("Para diagnóstico completo: python diagnose_full.py")
print()

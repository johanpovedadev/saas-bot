#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Script de diagnóstico completo para el sistema de WhatsApp Bot
Verifica:
1. Credenciales de Google Sheets
2. Conexión al backend Django
3. Búsqueda de productos
4. Endpoint de sabores y toppings
5. Archivo fallback local
"""

import os
import sys
import json
import base64
import tempfile
from pathlib import Path
from dotenv import load_dotenv

# Colores para la terminal
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def print_header(text):
    print(f"\n{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BLUE}{text.center(60)}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*60}{Colors.RESET}\n")

def print_success(text):
    print(f"{Colors.GREEN}✓ {text}{Colors.RESET}")

def print_error(text):
    print(f"{Colors.RED}✗ {text}{Colors.RESET}")

def print_warning(text):
    print(f"{Colors.YELLOW}⚠ {text}{Colors.RESET}")

def print_info(text):
    print(f"{Colors.BLUE}ℹ {text}{Colors.RESET}")

# Cargar variables de entorno
BASE_DIR = Path(__file__).parent
ENV_PATH = BASE_DIR / 'bot-wasap' / '.env'

print_header("DIAGNÓSTICO COMPLETO DEL SISTEMA")

# TEST 1: Verificar archivo .env
print_info("Test 1: Verificando archivo .env")
if ENV_PATH.exists():
    print_success(f"Archivo .env encontrado: {ENV_PATH}")
    load_dotenv(ENV_PATH)
else:
    print_error(f"Archivo .env NO encontrado: {ENV_PATH}")
    sys.exit(1)

# TEST 2: Verificar credenciales de Google
print_info("\nTest 2: Verificando credenciales de Google Sheets")
sa_b64 = os.getenv('GOOGLE_SERVICE_ACCOUNT_B64')

if not sa_b64:
    print_error("GOOGLE_SERVICE_ACCOUNT_B64 no está configurado en .env")
    sys.exit(1)

print_success(f"GOOGLE_SERVICE_ACCOUNT_B64 encontrado (longitud: {len(sa_b64)})")

# Verificar si es base64 válido
if len(sa_b64) % 4 != 0:
    print_error("GOOGLE_SERVICE_ACCOUNT_B64 no es base64 válido (longitud incorrecta)")
    sys.exit(1)

try:
    decoded = base64.b64decode(sa_b64)
    sa_json = json.loads(decoded.decode('utf-8'))
    print_success("GOOGLE_SERVICE_ACCOUNT_B64 es base64 válido")
    print_success(f"Project ID: {sa_json.get('project_id', 'N/A')}")
    print_success(f"Client Email: {sa_json.get('client_email', 'N/A')}")
except Exception as e:
    print_error(f"Error al decodificar GOOGLE_SERVICE_ACCOUNT_B64: {e}")
    sys.exit(1)

# TEST 3: Verificar conexión a Google Sheets usando gspread
print_info("\nTest 3: Verificando conexión a Google Sheets")
try:
    import gspread
    from google.oauth2 import service_account
    
    SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    creds = service_account.Credentials.from_service_account_info(sa_json, scopes=SCOPES)
    client = gspread.authorize(creds)
    
    # Intentar abrir la hoja de productos
    PRODUCTS_SHEET_ID = '10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM'
    sheet = client.open_by_key(PRODUCTS_SHEET_ID)
    
    print_success(f"Conexión exitosa a Google Sheets: {sheet.title}")
    
    # Intentar leer datos
    worksheet = sheet.worksheet('Productos')
    data = worksheet.get_all_values()
    
    print_success(f"Datos leídos correctamente: {len(data)} filas")
    
    # Mostrar primeras 3 filas (headers + 2 productos)
    if len(data) >= 3:
        print_info("\nPrimeras 3 filas de la hoja 'Productos':")
        for i, row in enumerate(data[:3]):
            print(f"  Fila {i}: {row[:5]}...")  # Mostrar solo primeras 5 columnas
    
except ImportError:
    print_error("Módulo 'gspread' no instalado. Instalar con: pip install gspread google-auth")
    sys.exit(1)
except Exception as e:
    print_error(f"Error al conectar a Google Sheets: {e}")
    sys.exit(1)

# TEST 4: Verificar backend Django
print_info("\nTest 4: Verificando backend Django")
try:
    import requests
    
    API_BASE = os.getenv('API_BASE', 'http://127.0.0.1:8001/api')
    
    # Test endpoint de sabores y toppings
    url = f"{API_BASE}/consultar_sabores_y_toppings/"
    print_info(f"Consultando: {url}")
    
    response = requests.get(url, timeout=5)
    
    if response.status_code == 200:
        data = response.json()
        sabores = data.get('sabores', [])
        toppings = data.get('toppings', [])
        
        print_success(f"Backend responde correctamente (Status 200)")
        print_success(f"Sabores: {len(sabores)}")
        print_success(f"Toppings: {len(toppings)}")
        
        if sabores:
            print_info(f"  Ejemplo sabor: {sabores[0].get('NombreProducto', 'N/A')}")
        if toppings:
            print_info(f"  Ejemplo topping: {toppings[0].get('NombreProducto', 'N/A')}")
    else:
        print_error(f"Backend respondió con error {response.status_code}: {response.text[:200]}")
        
except ImportError:
    print_error("Módulo 'requests' no instalado. Instalar con: pip install requests")
except requests.exceptions.ConnectionError:
    print_error(f"No se pudo conectar al backend en {API_BASE}")
    print_warning("Asegúrate de que Django esté corriendo: python manage.py runserver 8001")
except Exception as e:
    print_error(f"Error al verificar backend: {e}")

# TEST 5: Verificar búsqueda de productos
print_info("\nTest 5: Verificando búsqueda de productos")
try:
    search_terms = ['buho', 'copa', 'paleta']
    
    for term in search_terms:
        url = f"{API_BASE}/buscar_producto_por_nombre/?q={term}"
        print_info(f"  Buscando: '{term}'")
        
        response = requests.get(url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            
            if 'matches' in data:
                print_success(f"    Encontrados {len(data['matches'])} productos")
                for match in data['matches'][:2]:  # Mostrar solo 2
                    print_info(f"      - {match.get('NombreProducto', 'N/A')}")
            else:
                print_success(f"    1 producto exacto: {data.get('NombreProducto', 'N/A')}")
        elif response.status_code == 404:
            print_warning(f"    No se encontraron productos para '{term}'")
        else:
            print_error(f"    Error {response.status_code}: {response.text[:100]}")
            
except Exception as e:
    print_error(f"Error al verificar búsqueda: {e}")

# TEST 6: Verificar archivo fallback local
print_info("\nTest 6: Verificando archivo fallback local")
LOCAL_FALLBACK = BASE_DIR / 'tmp' / 'resp_sabores.json'

if LOCAL_FALLBACK.exists():
    print_success(f"Archivo fallback encontrado: {LOCAL_FALLBACK}")
    
    try:
        # Verificar BOM UTF-8
        with open(LOCAL_FALLBACK, 'rb') as f:
            raw_bytes = f.read()
            
        if raw_bytes[:3] == b'\xef\xbb\xbf':
            print_error("  ¡ADVERTENCIA! Archivo contiene BOM UTF-8 (puede causar errores)")
            print_info("  Ejecutar: python fix_fallback_bom.py para corregir")
        else:
            print_success("  Archivo NO contiene BOM UTF-8")
        
        # Verificar JSON válido
        with open(LOCAL_FALLBACK, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Remover líneas de comentarios
        lines = content.splitlines()
        while lines and lines[0].strip().startswith('//'):
            lines.pop(0)
        cleaned = '\n'.join(lines).strip()
        
        data = json.loads(cleaned)
        print_success("  Archivo es JSON válido")
        print_success(f"  Sabores: {len(data.get('sabores', []))}")
        print_success(f"  Toppings: {len(data.get('toppings', []))}")
        
    except json.JSONDecodeError as e:
        print_error(f"  Error al parsear JSON: {e}")
    except Exception as e:
        print_error(f"  Error al leer archivo: {e}")
else:
    print_warning(f"Archivo fallback NO encontrado: {LOCAL_FALLBACK}")
    print_info("  Esto es opcional, el bot puede funcionar sin él")

# RESUMEN FINAL
print_header("RESUMEN")

# Verificar si todos los tests críticos pasaron
critical_tests = [
    os.path.exists(ENV_PATH),
    sa_b64 is not None,
    len(sa_b64) % 4 == 0,
]

if all(critical_tests):
    print_success("✓ SISTEMA CONFIGURADO CORRECTAMENTE")
    print_info("\nPróximos pasos:")
    print_info("  1. Asegúrate de que Django esté corriendo:")
    print_info("     python manage.py runserver 8001")
    print_info("  2. Inicia el bot de WhatsApp:")
    print_info("     cd bot-wasap && npm start")
else:
    print_error("✗ HAY PROBLEMAS EN LA CONFIGURACIÓN")
    print_info("\nRevisa los errores anteriores")

print()

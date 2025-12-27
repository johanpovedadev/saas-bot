#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Script para convertir service_account.json a Base64
para usar en la variable de entorno GOOGLE_SERVICE_ACCOUNT_B64
"""

import base64
import json
from pathlib import Path

# Colores para la terminal
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def print_success(text):
    print(f"{Colors.GREEN}✓ {text}{Colors.RESET}")

def print_error(text):
    print(f"{Colors.RED}✗ {text}{Colors.RESET}")

def print_warning(text):
    print(f"{Colors.YELLOW}⚠ {text}{Colors.RESET}")

def print_info(text):
    print(f"{Colors.BLUE}ℹ {text}{Colors.RESET}")

print("\n" + "="*70)
print("  CONVERTIR service_account.json A BASE64")
print("="*70 + "\n")

# Buscar archivo service_account.json
json_file = Path('service_account.json')

if not json_file.exists():
    print_error("No se encontró 'service_account.json'")
    print_info("\nInstrucciones:")
    print_info("  1. Descarga el archivo JSON de Google Cloud Console")
    print_info("  2. Guárdalo como 'service_account.json' en esta carpeta:")
    print_info(f"     {Path.cwd()}")
    print_info("  3. Ejecuta este script nuevamente\n")
    
    print_info("Ubicación esperada:")
    print_info(f"  {json_file.absolute()}\n")
    
    # Buscar en Downloads
    downloads = Path.home() / "Downloads"
    if downloads.exists():
        json_files = list(downloads.glob("*.json"))
        if json_files:
            print_warning("Archivos JSON encontrados en Downloads:")
            for f in json_files[:5]:
                print(f"    - {f.name}")
            print_info("\n  Sugerencia: Mueve uno de estos archivos aquí:")
            print_info(f"    Move-Item '{json_files[0]}' '{json_file.absolute()}'\n")
    
    exit(1)

print_success(f"Archivo encontrado: {json_file.name}")

# Leer y validar JSON
try:
    with open(json_file, 'r', encoding='utf-8') as f:
        json_data = json.load(f)
    
    print_success("Archivo JSON es válido")
    
    # Verificar campos importantes
    if 'type' in json_data and json_data['type'] == 'service_account':
        print_success("Tipo: service_account ✓")
    else:
        print_warning("El archivo no parece ser una cuenta de servicio de Google")
    
    if 'project_id' in json_data:
        print_info(f"  Project ID: {json_data['project_id']}")
    
    if 'client_email' in json_data:
        print_info(f"  Email: {json_data['client_email']}")
        print_info("")
        print_warning("IMPORTANTE: Debes compartir las Google Sheets con este email:")
        print_info(f"  {json_data['client_email']}")
        print_info("")
    
except json.JSONDecodeError as e:
    print_error(f"Error al leer JSON: {e}")
    exit(1)

# Convertir a Base64
print_info("Convirtiendo a Base64...")

with open(json_file, 'rb') as f:
    json_bytes = f.read()

base64_encoded = base64.b64encode(json_bytes).decode('utf-8')

print_success(f"Conversión exitosa! (Longitud: {len(base64_encoded)} caracteres)")

# Guardar en archivo de texto
output_file = Path('base64_credentials.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(base64_encoded)

print_success(f"Guardado en: {output_file}")

# Mostrar instrucciones
print("\n" + "="*70)
print("  SIGUIENTE PASO: ACTUALIZAR .env")
print("="*70 + "\n")

print_info("1. Abre el archivo: bot-wasap\\.env")
print_info("2. Busca la línea que dice: GOOGLE_SERVICE_ACCOUNT_B64=...")
print_info("3. Reemplaza todo el valor con el contenido de 'base64_credentials.txt'")
print_info("")
print_warning("⚠ IMPORTANTE: El valor debe estar en UNA SOLA LÍNEA")
print_info("")

# Mostrar primeros y últimos caracteres para verificar
print_info("Verifica que el valor empiece con:")
print(f"  {base64_encoded[:60]}...")
print_info("")
print_info("Y termine con:")
print(f"  ...{base64_encoded[-50:]}")
print_info("")

print_success("✓ Script completado exitosamente\n")

# Preguntar si desea actualizar .env automáticamente
try:
    response = input("¿Deseas actualizar automáticamente el archivo .env? (s/n): ")
    
    if response.lower() in ['s', 'si', 'y', 'yes']:
        env_file = Path('bot-wasap') / '.env'
        
        if not env_file.exists():
            print_error(f"No se encontró el archivo: {env_file}")
        else:
            # Leer archivo .env
            with open(env_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Buscar y reemplazar la línea
            updated = False
            new_lines = []
            
            for line in lines:
                if line.startswith('GOOGLE_SERVICE_ACCOUNT_B64='):
                    new_lines.append(f'GOOGLE_SERVICE_ACCOUNT_B64={base64_encoded}\n')
                    updated = True
                else:
                    new_lines.append(line)
            
            # Si no se encontró la línea, agregarla al final
            if not updated:
                new_lines.append(f'\n# Credenciales de Google Sheets (agregado automáticamente)\n')
                new_lines.append(f'GOOGLE_SERVICE_ACCOUNT_B64={base64_encoded}\n')
            
            # Guardar archivo actualizado
            with open(env_file, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            
            print_success(f"Archivo .env actualizado: {env_file}")
            print_info("\nPróximos pasos:")
            print_info("  1. Reinicia el backend Django:")
            print_info("     python manage.py runserver 8001")
            print_info("  2. Ejecuta el diagnóstico:")
            print_info("     python diagnose_full.py")
            print_info("")
    
except KeyboardInterrupt:
    print("\n\nCancelado por el usuario\n")
except Exception as e:
    print_error(f"Error al actualizar .env: {e}")

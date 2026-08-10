# -*- coding: utf-8 -*-
"""
Crea las pestañas "Configuración" y "Preguntas_Frecuentes" en el Sheet de
Mundo Helados para que la dueña (Isa) edite tono, saludo, cuentas y preguntas
frecuentes sin tocar código.

Uso:
    python scripts/create_config_tabs.py

Comportamiento:
- Si la pestaña NO existe: la crea con encabezados + filas de ejemplo.
- Si YA existe: NO toca los valores (no pisa ediciones de Isa); solo
  asegura encabezados, formato, ancho de columnas y la nota de instrucciones.
"""
import json
import sys

import gspread
from google.oauth2 import service_account

SHEET_ID = '10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM'

INSTRUCCIONES = (
    'Acá podés cambiar cómo habla el bot y agregar preguntas frecuentes '
    'nuevas. Solo edita la columna "Valor" o agrega una fila nueva en la '
    'tabla de preguntas — el bot lo toma solo, no hace falta avisarle a '
    'Johan para estos cambios.'
)

CONFIG_HEADERS = ['Campo', 'Valor']
CONFIG_ROWS = [
    ['Nombre del negocio', 'Mundo Helados'],
    ['Tono del bot', 'Cálido, costeño, cercano, con emojis'],
    ['Saludo de bienvenida', (
        'Holiii ☺️\n\n'
        '*1)* 🛍️ Ver nuestro menú y hacer un pedido\n'
        '*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)\n'
        '*3)* 📍 Dirección y horarios\n\n'
        '_Escribe el número de la opción (1, 2 o 3)._'
    )],
    ['Mensaje de cierre de pedido', '✅ ¡Tu pedido ha sido confirmado con éxito! Pronto estará en camino. 🛵'],
    ['Regla — no fiamos', 'Sí, aplicar siempre'],
    ['Cuenta Nequi/Daviplata', '3228246114'],
    ['Titular Nequi', 'María Eugenia Valencia'],
    ['Cuenta Bancolombia', '35134032403'],
    ['Titular Bancolombia', 'Isabel Cristina Montoya'],
]

FAQ_HEADERS = ['Pregunta', 'Respuesta']
FAQ_ROWS = [
    ['¿Cuál es el horario?', 'Nuestro horario de atención es de 9:00 AM a 8:00 PM, todos los días. ¡Te esperamos! ✨'],
    ['¿Hacen domicilios?', 'Sí, hacemos domicilios en Riohacha. El costo de envío se calculará al finalizar tu pedido. 🛵'],
    ['¿Dónde están ubicados?', 'Nuestra dirección es Cra 7h n 34 b 08. ¡Ven a visitarnos! 📍'],
    ['¿Tienen parqueadero?', 'Sí, contamos con parqueadero para nuestros clientes. 🚗'],
    ['¿Cómo puedo pagar?', 'Aceptamos pagos en efectivo o por transferencia a través de Nequi y Bancolombia. 💳'],
]


def get_client():
    for path in ('service_account_decoded.json', 'service_account.json'):
        try:
            with open(path, 'r', encoding='utf8') as f:
                data = json.load(f)
            creds = service_account.Credentials.from_service_account_info(
                data, scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'])
            return gspread.authorize(creds)
        except Exception as e:
            print(f'  [warn] no se pudo usar {path}: {e}')
    sys.exit('No hay service account válido')


def set_col_width(sh, ws, col_index, width):
    sh.batch_update({
        'requests': [{
            'updateDimensionProperties': {
                'range': {
                    'sheetId': ws.id,
                    'dimension': 'COLUMNS',
                    'startIndex': col_index - 1,
                    'endIndex': col_index,
                },
                'properties': {'pixelSize': width},
                'fields': 'pixelSize',
            }
        }]
    })


def ensure_headers(ws, headers, rows):
    """Rellena solo si la hoja está vacía (no pisa ediciones de Isa)."""
    existing = ws.get_all_values()
    if not existing or not any(row for row in existing):
        ws.update([headers] + rows, value_input_option='USER_ENTERED')
        print('  [ok] valores de ejemplo escritos')
    else:
        print('  [ok] ya hay valores, no se tocan')


def style_tab(sh, ws, col_a_width, col_b_width):
    ws.format('A1:B1', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 0.92, 'green': 0.90, 'blue': 0.85},
        'horizontalAlignment': 'CENTER',
    })
    try:
        ws.freeze(rows=1, cols=0)
    except Exception:
        pass
    set_col_width(sh, ws, 1, col_a_width)
    set_col_width(sh, ws, 2, col_b_width)
    cell = ws.acell('A1')
    cell.note = INSTRUCCIONES
    ws.update_cells([cell])


def create_config_tab(sh):
    if 'Configuración' in [w.title for w in sh.worksheets()]:
        ws = sh.worksheet('Configuración')
        print('  [ok] pestaña "Configuración" ya existe (se mantienen valores)')
    else:
        ws = sh.add_worksheet(title='Configuración', rows='100', cols='2')
        print('  [ok] pestaña "Configuración" creada')
    ensure_headers(ws, CONFIG_HEADERS, CONFIG_ROWS)
    style_tab(sh, ws, 320, 560)


def create_faq_tab(sh):
    if 'Preguntas_Frecuentes' in [w.title for w in sh.worksheets()]:
        ws = sh.worksheet('Preguntas_Frecuentes')
        print('  [ok] pestaña "Preguntas_Frecuentes" ya existe (se mantienen valores)')
    else:
        ws = sh.add_worksheet(title='Preguntas_Frecuentes', rows='200', cols='2')
        print('  [ok] pestaña "Preguntas_Frecuentes" creada')
    ensure_headers(ws, FAQ_HEADERS, FAQ_ROWS)
    style_tab(sh, ws, 360, 520)


def main():
    print('Conectando a Google Sheets...')
    client = get_client()
    sh = client.open_by_key(SHEET_ID)
    print(f'Spreadsheet: {sh.title} — tabs actuales: {[w.title for w in sh.worksheets()]}')
    create_config_tab(sh)
    create_faq_tab(sh)
    print('Listo.')


if __name__ == '__main__':
    main()

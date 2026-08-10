# -*- coding: utf-8 -*-
"""
Agrega la pregunta frecuente del LITRO de helado a la pestaña
'Preguntas_Frecuentes' del Sheet de Mundo Helados, SOLO si aún no existe
(no duplica filas ni pisa ediciones de Isa).

Uso:
    python scripts/add_litro_faq.py
"""
import json
import sys

import gspread
from google.oauth2 import service_account

SHEET_ID = '10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM'

FAQ_ROW = [
    '¿Cuántos sabores lleva el litro?',
    'El litro lleva hasta 2 sabores; si prefieres todo de un solo sabor también se puede. 😋'
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


def norm(s):
    import unicodedata
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return ' '.join(s.lower().split())


def main():
    print('Conectando a Google Sheets...')
    client = get_client()
    sh = client.open_by_key(SHEET_ID)
    ws = sh.worksheet('Preguntas_Frecuentes')
    rows = ws.get_all_values()
    target_q = norm(FAQ_ROW[0])
    exists = any(target_q == norm(r[0]) for r in rows[1:] if r and r[0])
    if exists:
        print(f'[ok] la pregunta "{FAQ_ROW[0]}" ya existe, no se toca nada.')
    else:
        ws.append_row(FAQ_ROW, value_input_option='USER_ENTERED')
        print(f'[ok] fila agregada: "{FAQ_ROW[0]}"')
    print('Listo.')


if __name__ == '__main__':
    main()

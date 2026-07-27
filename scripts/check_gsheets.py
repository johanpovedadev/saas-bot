import json
import sys
import os
import gspread
from google.oauth2 import service_account

try:
    data = json.load(open('service_account_decoded.json','r',encoding='utf8'))
    creds = service_account.Credentials.from_service_account_info(data, scopes=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'])
    client = gspread.authorize(creds)
    print('CLIENT OK')
    # IDs used in project
    PRODUCTS_SHEET_ID = os.environ.get('HELADOS_SHEET_ID', '10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM')
    DELIVERIES_SHEET_ID = '1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI'
    try:
        sh = client.open_by_key(PRODUCTS_SHEET_ID)
        print('OPEN PRODUCTS OK ->', sh.title)
    except Exception as e:
        print('OPEN PRODUCTS ERROR ->', type(e).__name__, str(e))
    try:
        sh2 = client.open_by_key(DELIVERIES_SHEET_ID)
        print('OPEN DELIVERIES OK ->', sh2.title)
    except Exception as e:
        print('OPEN DELIVERIES ERROR ->', type(e).__name__, str(e))
except Exception as e:
    print('ERROR', type(e).__name__, str(e))
    sys.exit(1)

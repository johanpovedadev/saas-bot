import os
import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'inventario_wasap.settings')

import django
django.setup()

from waitress import serve
from django.core.wsgi import get_wsgi_application

app = get_wsgi_application()
port = int(os.environ.get('DJANGO_PORT', '8001'))
print(f'Waitress serving Django on 0.0.0.0:{port} (multi-thread)')
serve(app, host='0.0.0.0', port=port, threads=8, connection_limit=200)

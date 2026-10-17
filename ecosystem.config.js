module.exports = {
  apps: [
    {
      name: 'django-pescaderia',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas',
      script: 'run_wsgi.py',
      interpreter: 'python',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        PYTHONUNBUFFERED: '1',
        BUSINESS_KEY: 'pescaderia',
        DJANGO_PORT: '8002'
      }
    },
    {
      name: 'bot-pescaderia',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'pescaderia',
        LION_STATUS_PORT: '8097',
        LION_STATUS_TOKEN: 'dev-lion-status-token-pescaderia-2026'
      }
    },
    {
      name: 'django-mascotas',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas',
      script: 'run_wsgi.py',
      interpreter: 'python',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        PYTHONUNBUFFERED: '1',
        BUSINESS_KEY: 'mascotas',
        DJANGO_PORT: '8001'
      }
    },
    {
      name: 'bot-mascotas',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'mascotas',
        LION_STATUS_PORT: '8100',
        LION_STATUS_TOKEN: 'dev-lion-status-token-mascotas-2026'
      }
    },
    {
      name: 'bot-finance',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'finance',
        LION_STATUS_PORT: '8101',
        LION_STATUS_TOKEN: 'dev-lion-status-token-finance-2026'
      }
    },
    {
      name: 'django-heladeria',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas',
      script: 'run_wsgi.py',
      interpreter: 'python',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        BUSINESS_KEY: 'heladeria',
        DJANGO_PORT: '8000'
      }
    },
    {
      name: 'bot-heladeria',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'heladeria',
        LION_STATUS_PORT: '8096',
        LION_STATUS_TOKEN: 'dev-lion-status-token-mundo-helados-2026'
      }
    },
    {
      name: 'bot-finance-telegram',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index-telegram.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'finance'
      }
    },
    {
      name: 'bot-pilates',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'pilates',
        LION_STATUS_PORT: '8102',
        LION_STATUS_TOKEN: 'dev-lion-status-token-pilates-2026'
      }
    },
    {
      name: 'bot-pilates-clientas',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'pilates_clientas',
        LION_STATUS_PORT: '8103',
        LION_STATUS_TOKEN: 'dev-lion-status-token-pilates-clientas-2026'
      }
    },
    {
      name: 'admin-panel',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\admin-panel',
      script: 'server.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'bot-dev',
      cwd: 'C:\\Users\\Administrador\\Documents\\empanadas\\bot-wasap',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Una app que se cae antes de 20 s cuenta como inestable: a los 10 intentos PM2 la deja quieta en vez de
      // reiniciarla para siempre (17 oct 2026: "agentes-redes" se reinició 3,5 millones de veces y tumbó a PM2).
      min_uptime: '20s',
      exp_backoff_restart_delay: 2000,
      // 78 = puerto ocupado / configuración inválida: no tiene sentido reintentar (ver scripts/check-ports.js).
      stop_exit_codes: [78],
      env: {
        NODE_ENV: 'development',
        BUSINESS_KEY: 'dev'
      }
    }
  ]
};

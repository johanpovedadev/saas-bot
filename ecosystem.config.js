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
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'pescaderia'
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
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'mascotas'
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
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'finance'
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
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'heladeria'
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
      env: {
        NODE_ENV: 'production',
        BUSINESS_KEY: 'pilates'
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
      env: {
        NODE_ENV: 'development',
        BUSINESS_KEY: 'dev'
      }
    }
  ]
};

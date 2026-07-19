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
        BUSINESS_KEY: 'pescaderia'
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
        BUSINESS_KEY: 'mascotas'
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

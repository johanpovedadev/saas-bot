# Comandos que ejecutar_en_oracle.bat corre en el servidor (se reemplaza segun la tarea).
# Por defecto: estado de los contenedores y uso de memoria/disco.
cd ~/lion-stack
sudo docker compose ps
free -m
df -h / | tail -1

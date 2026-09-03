'use strict';

// Referencia mutable al socket de Baileys actualmente conectado — index.js la
// actualiza cada vez que la conexión se abre (o se pierde). Existe porque
// startBot() puede recrear `sock` en cada reconexión, y el servidor HTTP
// (lion-status-server.js, para /send) necesita siempre el socket vigente,
// no uno viejo capturado por closure.

let activeSocket = null;

function setActiveSocket(sock) {
	activeSocket = sock;
}

function getActiveSocket() {
	return activeSocket;
}

module.exports = { setActiveSocket, getActiveSocket };

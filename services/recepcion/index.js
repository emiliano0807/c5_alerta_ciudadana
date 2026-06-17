const express = require('express');
const env = require('./config/env');
const { initMqtt } = require('./config/mqtt');
const recepcionRoutes = require('./routes/recepcion.routes');

const app = express();
app.use(express.json());

// Inyectamos las rutas HTTP
app.use('/', recepcionRoutes);

// ==========================================
// INICIALIZACIÓN DEL GATEWAY
// ==========================================
function startGateway() {
    // 1. Iniciar la escucha de hardware (MQTT)
    initMqtt();

    // 2. Iniciar la escucha de peticiones web (HTTP)
    app.listen(env.HTTP_PORT, () => {
        console.log(`[Gateway HTTP] Instancia ${env.INSTANCE_ID} esperando trafico de Nginx en puerto ${env.HTTP_PORT}`);
    });
}

startGateway();
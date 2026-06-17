const mqtt = require('mqtt');
const env = require('./env');
const recepcionService = require('../services/recepcion.service');

// ==========================================
// CONEXIÓN AL BROKER MQTT (HARDWARE)
// ==========================================
function initMqtt() {
    const mqttClient = mqtt.connect(env.MQTT_BROKER);

    mqttClient.on('connect', () => {
        mqttClient.subscribe(env.MQTT_SHARED_TOPIC, (err) => {
            if (!err) {
                console.log(`[Gateway MQTT] Instancia ${env.INSTANCE_ID} suscrita a cola compartida.`);
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const rawData = message.toString();
            const alertData = JSON.parse(rawData);

            console.log(`\n[Instancia ${env.INSTANCE_ID}] Mensaje MQTT recibido de hardware:`, alertData.device_id);

            if (!recepcionService.validateAlertFormat(alertData)) return;

            // Enviamos la alerta al flujo normal del sistema
            recepcionService.sendToGeolocationService(alertData);
        } catch (error) {
            console.error(`[Error de Parsing]:`, error.message);
        }
    });

    return mqttClient;
}

module.exports = { initMqtt };
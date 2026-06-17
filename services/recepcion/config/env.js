const os = require('os');
const path = require('path');

// ==========================================
// CONFIGURACIÓN DE ENTORNO E IDENTIDAD
// ==========================================
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'c5/alertas';

module.exports = {
    HTTP_PORT: process.env.PORT || 3000,
    // Obtenemos los primeros 6 caracteres del ID del contenedor de Docker
    INSTANCE_ID: os.hostname().substring(0, 6),
    MQTT_BROKER: process.env.MQTT_BROKER || 'mqtt://mosquitto:1883',
    MQTT_TOPIC: MQTT_TOPIC,
    MQTT_SHARED_TOPIC: `$share/c5_recepcion_group/${MQTT_TOPIC}`,
    GEOLOCATION_GRPC_URI: process.env.GRPC_GEOLOCALIZACION_URL || 'geolocalizacion:50051',
    PROTO_PATH: path.join(__dirname, '..', 'proto', 'geolocation.proto')
};
const mqtt = require('mqtt');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const axios = require('axios');

// ==========================================
// CONFIGURACIÓN DE ENTORNO (Fácilmente escalable)
// ==========================================
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'c5/alerts';
const GEOLOCATION_GRPC_URI = process.env.GEOLOCATION_GRPC_URI || 'localhost:50051';

// ==========================================
// CONFIGURACIÓN CLIENTE gRPC
// ==========================================
const PROTO_PATH = path.join(__dirname, 'proto', 'geolocation.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const geoProto = grpc.loadPackageDefinition(packageDefinition).geolocation;

// Instanciar el cliente gRPC (Insecure para desarrollo/entorno local de red)
const geoClient = new geoProto.GeolocationService(
    GEOLOCATION_GRPC_URI, 
    grpc.credentials.createInsecure()
);

// ==========================================
// CONEXIÓN AL BROKER MQTT (Mosquitto)
// ==========================================
console.log(`[Gateway] Conectando a MQTT Broker en: ${MQTT_BROKER}`);
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
    console.log(`[Gateway] Conectado exitosamente a Mosquitto.`);
    mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (!err) {
            console.log(`[Gateway] Suscrito al tópico: "${MQTT_TOPIC}"`);
        } else {
            console.error(`[Gateway] Error al suscribirse al tópico:`, err);
        }
    });
});

// ==========================================
// FLUJO PRINCIPAL: RECEPCIÓN Y VALIDACIÓN
// ==========================================
mqttClient.on('message', (topic, message) => {
    try {
        // 1. Extraer el JSON
        const rawData = message.toString();
        const alertData = JSON.parse(rawData);

        console.log(`\n[Gateway] Mensaje recibido de ${topic}:`, alertData);

        // 2. Validación estricta del formato (Rúbrica: ID, GPS, timestamp, tipo)
        if (!validateAlertFormat(alertData)) {
            console.error(`[Validación Fallida] El JSON recibido no cuenta con la estructura requerida.`);
            return; // No bloquea, descarta el mensaje malformado e itera al siguiente
        }

        // 3. Llamada gRPC rápida al MS de Geolocalización
        sendToGeolocationService(alertData);

    } catch (error) {
        console.error(`[Error de Parsing] El mensaje no es un JSON válido:`, error.message);
    }
});

// Función validadora de campos requeridos
function validateAlertFormat(data) {
    const requiredFields = ['device_id', 'coordinates', 'timestamp', 'emergency_type'];
    const hasMainFields = requiredFields.every(field => data.hasOwnProperty(field) && data[field] !== null && data[field] !== '');

    if (!hasMainFields) return false;

    // Validación de profundidad para las coordenadas
    if (!data.coordinates.lat || !data.coordinates.lon) return false;

    return true;
}

// Función encargada del envío por gRPC
function sendToGeolocationService(data) {
    // Definimos el payload que acepta nuestro archivo .proto
    const payload = {
        device_id: String(data.device_id),
        coordinates: {
            lat: String(data.coordinates.lat),
            lon: String(data.coordinates.lon)
        },
        timestamp: String(data.timestamp),
        emergency_type: String(data.emergency_type)
    };

    console.log(`[gRPC] Enviando datos a MS Geolocalización...`);
    
    // Llamada RPC asíncrona y veloz
    geoClient.EnrichAlertData(payload, (error, response) => {
        if (error) {
            console.error(`[gRPC Error] No se pudo comunicar con el MS de Geolocalización:`, error.message);
            return;
        }

        if (response.success) {
            console.log(`[gRPC Éxito] Dato enriquecido recibido.`);

            // Armamos el objeto final para mandar a Prioridad
            const payloadParaPrioridad = {
                device_id: payload.device_id,
                coordinates: payload.coordinates,
                timestamp: payload.timestamp,
                emergency_type: payload.emergency_type,
                location_details: JSON.parse(response.location_details)
            };

            // Petición REST al MS de Prioridad
            axios.post('http://prioridad:3000/api/prioridad', payloadParaPrioridad)
                .then(res => console.log('[Gateway] Alerta enviada a Prioridad exitosamente.'))
                .catch(err => console.error('[Gateway] Error enviando a Prioridad:', err.message));
                
        } else {
            console.warn(`[gRPC Aviso] El MS procesó pero devolvió un estado fallido:`, response.message);
        }
    });
}

// Manejo de errores globales de MQTT
mqttClient.on('error', (err) => {
    console.error('[MQTT Error] Error en el cliente MQTT:', err);
});
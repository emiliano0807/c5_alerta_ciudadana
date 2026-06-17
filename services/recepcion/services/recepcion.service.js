const geoClient = require('../config/grpc');

// ==========================================
// FUNCIONES DE SOPORTE Y LÓGICA DE NEGOCIO
// ==========================================
function validateAlertFormat(data) {
    const requiredFields = ['device_id', 'coordinates', 'timestamp', 'emergency_type', 'press_count'];
    const hasMainFields = requiredFields.every(field => data.hasOwnProperty(field) && data[field] !== null && data[field] !== '');
    if (!hasMainFields) return false;
    if (typeof data.coordinates.lat === 'undefined' || typeof data.coordinates.lon === 'undefined') return false;
    return true;
}

function sendToGeolocationService(data) {
    const payload = {
        device_id: String(data.device_id),
        coordinates: { lat: parseFloat(data.coordinates.lat), lon: parseFloat(data.coordinates.lon) },
        timestamp: String(data.timestamp),
        emergency_type: String(data.emergency_type),
        press_count: Number(data.press_count)
    };

    geoClient.EnrichAlertData(payload, (error, response) => {
        if (error) {
            console.error('[gRPC Error] Fallo en comunicacion con Geolocalizacion:', error.message);
            return;
        }

        if (response.success) {
            const payloadParaPrioridad = {
                device_id: payload.device_id,
                coordinates: payload.coordinates,
                timestamp: payload.timestamp,
                emergency_type: payload.emergency_type,
                press_count: response.press_count,
                location_details: JSON.parse(response.location_details)
            };

            fetch('http://prioridad:3000/api/prioridad', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadParaPrioridad)
            }).catch(err => console.error('[Gateway] Error enviando a Prioridad:', err.message));
        }
    });
}

module.exports = {
    validateAlertFormat,
    sendToGeolocationService
};
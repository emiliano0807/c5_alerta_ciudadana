# Documentación Técnica: Microservicio de Recepción (services/recepcion)

El microservicio de Recepción actúa como la capa de ingesta de datos de alta disponibilidad en la infraestructura de Alerta Ciudadana C5. Su propósito principal es suscribirse al broker MQTT para capturar las señales de pánico emitidas por los dispositivos físicos ESP32, validar la integridad de las estructuras de datos y delegar el procesamiento de forma segura a través de gRPC y colas de contingencia en Redis.

1. Arquitectura de Flujo y Diseño Distribuido
Este microservicio está diseñado bajo los siguientes principios distribuidos:

Balanceo de Carga (Least-Connections): Diseñado para ejecutar un mínimo de 3 instancias simultáneas coordinadas por un balanceador (Nginx/Traefik).

Tolerancia a Fallos: Si los servicios internos caen, el componente subscriber captura el fallo y encola los datos crudos en Redis para prevenir la pérdida de alertas.

Comunicación Híbrida: Utiliza MQTT orientado a eventos para la ingesta IoT, y gRPC orientado a llamadas RPC de alto rendimiento con contratos estrictos (.proto) para el envío hacia el Microservicio de Prioridad/Geolocalización.

2. Variables de Entorno (.env.example)
Crea un archivo .env en la raíz de este microservicio con los siguientes parámetros:

Ini, TOML
# Configuración del Servidor de Salud (Health Check)
PORT=5001
NODE_ENV=development

# Infraestructura IoT (Broker MQTT)
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPIC=c5/alertas/ciudadanas

# Caché y Colas de Contingencia
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_QUEUE_NAME=alertas_contingencia

# Canales gRPC Internos (Hacia el microservicio de destino)
GRPC_DESTINO_HOST=127.0.0.1
GRPC_DESTINO_PORT=50051
3. Contrato de Comunicación (protos/alerta.proto)
Este archivo define la estructura de datos estricta y compartida para la comunicación gRPC entre servicios.

Protocol Buffers
syntax = "proto3";

package alerta;

// Servicio encargado de procesar la alerta recibida
service AlertaService {
  rpc EnviarAlerta (AlertaRequest) returns (AlertaResponse);
}

// Estructura de la Alerta obligatoria por rúbrica
message AlertaRequest {
  string dispositivo_id = 1;
  double latitud = 2;
  double longitud = 3;
  string timestamp = 4;
  string tipo_emergencia = 5; // panico, gas, intrusion, medica
}

message AlertaResponse {
  bool procesado = 1;
  string mensaje = 2;
  string incidente_id = 3;
}
4. Implementación del Código Fuente (src/)
A. Cliente gRPC e Inicialización de Conexiones (config/)
Archivo: config/redis.js
Maneja la conexión a la base de datos en memoria para la cola de tolerancia a fallos.

JavaScript
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: 3
});

redisClient.on('connect', () => console.log('⚡ Conectado exitosamente a Redis Cache.'));
redisClient.on('error', (err) => console.error('❌ Error crítico en conexión a Redis:', err.message));

export default redisClient;
Archivo: config/grpcClient.js
Carga dinámicamente el contrato .proto para habilitar el cliente de comunicación interna.

JavaScript
import grpc from '@grpc/grpc-proto-loader';
import protoLoader from '@grpc/proto-loader';
import dotenv from 'dotenv';

dotenv.config();

const PROTO_PATH = './protos/alerta.proto';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const alertaProto = grpc.loadPackageDefinition(packageDefinition).alerta;

const client = new alertaProto.AlertaService(
  `${process.env.GRPC_DESTINO_HOST}:${process.env.GRPC_DESTINO_PORT}`,
  grpc.credentials.createInsecure()
);

export default client;
B. Lógica del Suscriptor IoT (src/subscriber.js)
Este componente se conecta al broker MQTT, valida las cargas útiles del ESP32 e implementa el mecanismo de salvaguarda hacia Redis si el envío gRPC falla.

JavaScript
import mqtt from 'mqtt';
import redisClient from '../config/redis.js';
import grpcClient from '../config/grpcClient.js';
import dotenv from 'dotenv';

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER_URL;
const topic = process.env.MQTT_TOPIC;

const initSubscriber = () => {
  const mqttClient = mqtt.connect(brokerUrl);

  mqttClient.on('connect', () => {
    console.log(`📡 Suscriptor MQTT conectado al Broker: ${brokerUrl}`);
    mqttClient.subscribe(topic, (err) => {
      if (!err) console.log(`🎯 Suscrito exitosamente al tópico: [${topic}]`);
    });
  });

  mqttClient.on('message', async (subscribedTopic, message) => {
    try {
      const rawData = JSON.parse(message.toString());
      console.log(`📥 Alerta entrante desde IoT:`, rawData);

      // 1. Validación de Esquema Requerido por Rúbrica
      if (!rawData.dispositivo_id || !rawData.latitud || !rawData.longitud || !rawData.tipo_emergencia) {
        console.error('⚠️ Payload inválido descartado. Campos mandatorios ausentes.');
        return;
      }

      // 2. Intento de reenvío por gRPC al siguiente microservicio
      grpcClient.EnviarAlerta(rawData, async (error, response) => {
        if (error) {
          console.error('🚨 Microservicio destino inaccesible por gRPC. Activando tolerancia a fallos...');
          // Tolerancia a fallos: Encolar en Redis de inmediato
          await redisClient.lpush(process.env.REDIS_QUEUE_NAME, JSON.stringify(rawData));
          console.log('💾 Alerta resguardada de forma segura en la cola de contingencia de Redis.');
        } else {
          console.log(`✅ Alerta procesada con éxito por infraestructura gRPC. ID: ${response.incidente_id}`);
        }
      });

    } catch (parseError) {
      console.error('❌ Error de parseo en el mensaje crudo:', parseError.message);
    }
  });
};

export default initSubscriber;
C. Servidor Base y Monitoreo de Carga (src/app.js)
Expone un servidor HTTP básico para responder a las solicitudes de monitoreo de estado (Health Checks) que realiza el balanceador de carga.

JavaScript
import express from 'express';
import initSubscriber from './subscriber.js';
import redisClient from '../config/redis.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(express.json());

// Endpoint de Salud para Balanceadores Nginx / Traefik
app.get('/health', async (req, res) => {
  try {
    const redisStatus = redisClient.status === 'ready' ? 'CONNECTED' : 'DISCONNECTED';
    return res.status(200).json({
      status: 'UP',
      instancia: `Recepcion-Node-${process.env.PORT}`,
      dependencies: {
        redis: redisStatus
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ status: 'DOWN', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de salud de Recepción corriendo en el puerto ${PORT}`);
  // Inicializa la escucha de eventos IoT
  initSubscriber();
});
5. Contenedorización (Dockerfile)
Módulo optimizado de Docker con construcción multi-etapa o de entorno ligero para levantar las 3 instancias requeridas a través de Docker Compose.

Dockerfile
# Imagen base ligera
FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /usr/src/app

# Instalar dependencias primero para aprovechar la caché de capas de Docker
COPY package*.json ./
RUN npm install --only=production

# Copiar el código fuente y contratos
COPY ./src ./src
COPY ./config ./config
COPY ./protos ./protos

# Exponer puerto dinámico de salud
EXPOSE 5001

# Comando de arranque del microservicio
CMD ["node", "src/app.js"]
6. Instrucciones de Despliegue Local
Instala los módulos de node requeridos en el microservicio:

Bash
npm install express mqtt @grpc/grpc-js @grpc/proto-loader ioredis dotenv
Asegúrate de tener levantado tu Broker Mosquitto y tu instancia de Redis local o vía Docker.

Arranca el servicio en modo interactivo:

Bash
node src/app.js
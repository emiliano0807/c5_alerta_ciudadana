# DOCUMENTACIÓN TÉCNICA DE ARQUITECTURA DE SOFTWARE

## PROYECTO: SISTEMA DISTRIBUIDO DE ALERTA CIUDADANA (TIPO C5)

---

### INVENTARIO DEL DOCUMENTO

- **Materia:** Sistemas Distribuidos
- **Semestre:** Octavo Semestre
- **Carrera:** Ingeniería en Sistemas Computacionales
- **Fecha de Emisión:** 15 de Junio de 2026
- **Versión del Artefacto:** 1.0.0

---

## 1. INTRODUCCIÓN Y CONTEXTO DEL PROBLEMA

El presente documento detalla la especificación de diseño, la topología de red y las decisiones arquitectónicas para la implementación del Sistema de Alerta Ciudadana distribuido tipo C5. El sistema está diseñado para capturar eventos de emergencia emitidos desde dispositivos periféricos de hardware en la capa física y procesarlos a través de una topología de microservicios independientes hasta su correcta visualización en las terminales de los operadores de comando.

La arquitectura responde a un acuerdo de nivel de servicio (SLA) riguroso, el cual exige que el procesamiento y la notificación de las alertas se consoliden en un tiempo menor a 2 segundos de extremo a extremo (end-to-end), garantizando una alta disponibilidad y tolerancia a fallos incluso ante la caída de uno o más nodos de la red distribuidora.

### 1.1 Alcance y requisitos básicos

- **Objetivo del sistema:** recibir alertas de emergencia desde dispositivos remotos, enriquecer los datos con geolocalización y prioridad, notificar a operadores y mantener un historial consultable.
- **Requisitos funcionales principales:**
  - Ingesta continua de eventos desde el broker MQTT.
  - Validación de payload y normalización de datos.
  - Enriquecimiento geoespacial y asignación automática de prioridad.
  - Entrega de notificaciones en tiempo real a estaciones de control.
  - Persistencia histórica de incidentes y consulta parametrizada.
- **Requisitos no funcionales clave:**
  - Latencia end-to-end menor a 2 segundos.
  - Disponibilidad objetivo >= 99,9%.
  - Escalabilidad horizontal de los servicios críticos.
  - Tolerancia a fallos y recuperación automática de contenedores.
  - Consistencia eventual para almacenamiento histórico con réplicas de lectura.

---

## 2. ESPECIFICACIÓN DE MICROSERVICIOS

La infraestructura del backend se encuentra dividida en cinco microservicios desacoplados, ejecutados en entornos contenerizados independientes a través de Docker y Docker Compose:

1. **Recepción de Alertas (Microservicio 1):** Responsable de la suscripción al Broker MQTT, validación de la integridad del payload entrante y el encolamiento inicial de los mensajes. Soporta el despliegue de tres instancias concurrentes detrás de un balanceador de carga.
2. **Geolocalización (Microservicio 2):** Encargado del procesamiento analítico de las coordenadas GPS (latitud y longitud), la asignación de la zona geográfica y el mapeo topológico correspondiente.
3. **Asignación de Prioridad (Microservicio 3):** Clasifica automáticamente los incidentes en niveles crítico, alto o medio con base en reglas de negocio lógicas y configurables.
4. **Notificaciones (Microservicio 4):** Despacha la información enriquecida en tiempo real hacia las estaciones de control de los operadores mediante conexiones persistentes WebSockets.
5. **Historial de Incidentes (Microservicio 5):** Administra la persistencia, auditoría y consulta de eventos históricos a través de filtros parametrizados por fechas, zonas y prioridad.

---

## 3. CONTRATOS DE COMUNICACIÓN INTER-SERVICIOS (gRPC)

Para cumplir con el requerimiento no funcional de comunicación mediante gRPC con contratos formalizados, se define el archivo de interfaz `geolocation.proto`. Este mecanismo optimiza el rendimiento síncrono del flujo core a través de la serialización binaria sobre HTTP/2:

```protobuf
syntax = "proto3";

package geolocation;

service GeolocationService {
  rpc EnrichAlertData (AlertRequest) returns (EnrichedAlertResponse);
}

// Mensaje anidado para estructurar latitud y longitud numéricamente
message Coordinates {
  double lat = 1;
  double lon = 2;
}

message AlertRequest {
  string device_id = 1;
  Coordinates coordinates = 2;
  string timestamp = 3;
  string emergency_type = 4;
  int32 press_count = 5;
}

message EnrichedAlertResponse {
  bool success = 1;
  string message = 2;
  string device_id = 3;
  Coordinates coordinates = 4;
  string timestamp = 5;
  string emergency_type = 6;
  string location_details = 7;
  int32 press_count = 8;
}

```

### 3.1 Validación, formato y versiones del contrato

- El campo `timestamp` debe usar formato ISO 8601 para asegurar interoperabilidad entre servicios y facilitar auditoría.
- Los campos `tipo_emergencia`, `prioridad` y `zona_geografica` deben documentarse en un catálogo de valores permitidos y validarse en el microservicio de Recepción.
- Se recomienda versionar el contrato gRPC mediante un sufijo en el paquete o servicio (`v1`, `v2`) y mantener compatibilidad hacia atrás para despliegues incrementales.
- Los errores de validación del payload deben traducirse a códigos de estado gRPC claramente definidos para permitir reintentos controlados y diagnósticos operativos.

## 4. CAPA DE PERSISTENCIA Y MODELO DE CONSISTENCIA

El sistema de almacenamiento distribuye las operaciones relacionales para mitigar la degradación del rendimiento general durante ráfagas de transacciones de emergencia, aislando las cargas transaccionales de las cargas analíticas.

### 4.1 Definición del Esquema de Datos (`incidentes`)

La tabla `incidentes` se encarga de consolidar los eventos históricos recolectados de los dispositivos periféricos y enriquecidos por los microservicios centrales. El script DDL de creación del esquema se define a continuación:

```sql
CREATE TABLE IF NOT EXISTS incidentes (
    alert_id UUID PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    zone VARCHAR(100),
    sector VARCHAR(100),
    emergency_type VARCHAR(50) NOT NULL,
    priority_level VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    timestamp TIMESTAMP NOT NULL
);
```

### 4.2 Estrategia de Replicación y Enrutamiento de Consultas

La infraestructura de base de datos implementa una topología PostgreSQL configurada en un clúster distribuido de dos nodos, tal como se especifica en los parámetros de orquestación:

- **Enrutamiento de Escrituras (Mutaciones):** Las operaciones transaccionales de inserción o actualización de registros de emergencia se dirigen de forma exclusiva al contenedor `postgres-primary` a través del puerto `5432`. Esto blinda el flujo crítico de inyección contra bloqueos de tablas por solicitudes simultáneas.
- **Enrutamiento de Lecturas (Consultas Analíticas):** El microservicio de Historial de Incidentes desvía la totalidad de sus solicitudes de consulta y reportes históricos al contenedor `postgres-replica` a través del puerto expuesto `5433`.
- **Justificación del Modelo de Consistencia:** Se adopta un modelo de **Consistencia Eventual**. En una infraestructura de misión crítica tipo C5, la disponibilidad y la baja latencia al registrar una alerta toman precedencia sobre la sincronización inmediata del almacenamiento histórico. El desfase temporal implícito en la replicación asíncrona hacia el nodo esclavo ocurre en el orden de los milisegundos, cumpliendo con los requerimientos analíticos sin comprometer el rendimiento del sistema core.

---

## 5. REQUISITOS NO FUNCIONALES Y TOLERANCIA A FALLOS

- **Balanceo de Carga:** El tráfico proveniente del broker MQTT hacia el servicio de Recepción se distribuye equitativamente a través de un proxy Nginx configurado bajo el algoritmo de conexiones mínimas (_least-connections_). Esto asegura que las nuevas peticiones se asignen al nodo con menor carga de procesamiento.
- **Tolerancia a Fallos (Resiliencia):** En caso de indisponibilidad o caída crítica del microservicio de Notificaciones, las alertas validadas no sufren pérdida de datos. El sistema las retiene de manera temporal en una cola estructurada de Redis Queue mediante operaciones atómicas. Una vez restablecido el contenedor del servicio, este drena el buffer de memoria y transmite las notificaciones pendientes a los operadores de forma sincronizada.
- **Objetivos de Rendimiento:** El tiempo de procesamiento end-to-end debe mantenerse por debajo de los 2 segundos incluso bajo cargas de pico. Los componentes deben ser capaces de escalar horizontalmente para mantener la latencia de alerta.
- **Disponibilidad y recuperación:** El diseño espera que la plataforma mantenga al menos 99,9% de disponibilidad para la ruta de recepción y notificación de alertas, con reinicio automático de contenedores y dependencias críticas.
- **Consistencia:** Se adopta consistencia eventual para los datos históricos de incidentes, mientras que la ruta de alerta activa favorece disponibilidad y velocidad.

---

## 6. ORQUESTACIÓN DE LA INFRAESTRUCTURA (`docker-compose.yaml`)

El entorno completo (servicios de red, brokers, almacenes de memoria y las instancias distribuidas) se inicializa mediante la configuración global descrita a continuación:

```yaml
services:
  # ==========================================
  # INFRAESTRUCTURA Y BASES DE DATOS
  # ==========================================

  mosquitto:
    image: eclipse-mosquitto:latest
    container_name: c5_mosquitto
    ports:
      - "1883:1883"
      - "9001:9001"
    volumes:
      - ./config/mosquitto.conf:/mosquitto/config/mosquitto.conf
    networks:
      - c5_network

  redis:
    image: redis:alpine
    container_name: c5_redis
    ports:
      - "6379:6379"
    networks:
      - c5_network

  postgres-primary:
    image: bitnami/postgresql:latest
    container_name: c5_postgres_primary
    environment:
      - POSTGRESQL_REPLICATION_MODE=master
      - POSTGRESQL_REPLICATION_USER=repl_user
      - POSTGRESQL_REPLICATION_PASSWORD=repl_password
      - POSTGRESQL_USERNAME=c5_admin
      - POSTGRESQL_PASSWORD=c5_secret
      - POSTGRESQL_DATABASE=c5_alertas
    ports:
      - "5432:5432"
    networks:
      - c5_network
    volumes:
      - pg_primary_data:/bitnami/postgresql

  postgres-replica:
    image: bitnami/postgresql:latest
    container_name: c5_postgres_replica
    depends_on:
      - postgres-primary
    environment:
      - POSTGRESQL_REPLICATION_MODE=slave
      - POSTGRESQL_MASTER_HOST=postgres-primary
      - POSTGRESQL_MASTER_PORT_NUMBER=5432
      - POSTGRESQL_REPLICATION_USER=repl_user
      - POSTGRESQL_REPLICATION_PASSWORD=repl_password
      - POSTGRESQL_PASSWORD=c5_secret
    ports:
      - "5433:5432"
    networks:
      - c5_network
    volumes:
      - pg_replica_data:/bitnami/postgresql

  # ==========================================
  # BALANCEADOR DE CARGA
  # ==========================================

  nginx-lb:
    image: nginx:alpine
    container_name: c5_nginx_lb
    ports:
      - "80:80"
    volumes:
      - ./services/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - recepcion-1
      - recepcion-2
      - recepcion-3
    networks:
      - c5_network

  # ==========================================
  # MICROSERVICIOS (MODO DESARROLLO / LIVE-RELOAD)
  # ==========================================
  recepcion-1:
    image: node:20-alpine
    container_name: c5_recepcion_1
    working_dir: /app
    volumes:
      - ./services/recepcion:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    environment:
      - MQTT_BROKER=mqtt://mosquitto:1883
      - GRPC_GEOLOCALIZACION_URL=geolocalizacion:50051
    expose:
      - "3000"

  recepcion-2:
    image: node:20-alpine
    container_name: c5_recepcion_2
    working_dir: /app
    volumes:
      - ./services/recepcion:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    environment:
      - MQTT_BROKER=mqtt://mosquitto:1883
      - GRPC_GEOLOCALIZACION_URL=geolocalizacion:50051
    expose:
      - "3000"

  recepcion-3:
    image: node:20-alpine
    container_name: c5_recepcion_3
    working_dir: /app
    volumes:
      - ./services/recepcion:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    environment:
      - MQTT_BROKER=mqtt://mosquitto:1883
      - GRPC_GEOLOCALIZACION_URL=geolocalizacion:50051
    expose:
      - "3000"

  geolocalizacion:
    image: node:20-alpine
    container_name: c5_geolocalizacion
    working_dir: /app
    volumes:
      - ./services/geolocalizacion:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    ports:
      - "50051:50051"

  prioridad:
    image: node:20-alpine
    container_name: c5_prioridad
    working_dir: /app
    volumes:
      - ./services/prioridad:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  notificaciones:
    image: node:20-alpine
    container_name: c5_notificaciones
    working_dir: /app
    volumes:
      - ./services/notificaciones:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    ports:
      - "3001:3001"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  historial:
    image: node:20-alpine
    container_name: c5_historial
    working_dir: /app
    volumes:
      - ./services/historial:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    ports:
      - "4000:4000"
    environment:
      - DB_PRIMARY_URL=postgres://c5_admin:c5_secret@postgres-primary:5432/c5_alertas
      - DB_REPLICA_URL=postgres://c5_admin:c5_secret@postgres-replica:5432/c5_alertas
    depends_on:
      - postgres-primary
      - postgres-replica

  # ==========================================
  # FRONTEND (OPERADORES C5)
  # ==========================================

  frontend:
    image: node:20-alpine
    container_name: c5_frontend
    working_dir: /app
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: sh -c "npm install && npm run dev -- --host"
    networks:
      - c5_network
    ports:
      - "5173:5173"
    environment:
      - VITE_WS_URL=ws://localhost:3001
    depends_on:
      - notificaciones

networks:
  c5_network:
    driver: bridge

volumes:
  pg_primary_data:
  pg_replica_data:
```

## 7. SEGURIDAD

- **Autenticación y autorización:** Se recomienda proteger los endpoints administrativos y los servicios críticos mediante tokens de acceso o un mecanismo de API key para garantizar que solo clientes autorizados publiquen alertas y consulten historial.
- **Cifrado en tránsito:** Implementar TLS para gRPC y HTTPS en los servicios que expongan interfaces externas. El broker MQTT debe usar TLS si se conecta a dispositivos remotos que transmiten información sensible.
- **Gestión de secretos:** Las credenciales de PostgreSQL, Redis y la configuración gRPC deben mantenerse fuera del repositorio en un almacén de secretos o en variables de entorno gestionadas por el entorno de despliegue.
- **Segmentación de red:** El uso de la red Docker `c5_network` debe acompañarse de reglas de firewall y políticas de aislamiento que limiten el acceso desde fuera del clúster a los servicios necesarios.
- **Validación de datos:** Todos los payloads entrantes deben validarse rigurosamente para evitar inyección de datos, carga malformada o valores fuera de rango.

## 8. OBSERVABILIDAD Y OPERACIONES

- **Logs estructurados:** Cada microservicio debe generar logs claros y estructurados que incluyan identificadores de alerta, timestamp, estado y resultado de procesamiento.
- **Alertas operativas:** Definir umbrales para alertas en caso de aumento de latencia, fallas en gRPC, desconexión de réplicas o saturación de Redis.
- **Backups y recuperación:** Programar respaldos regulares de la base de datos primaria y validar la restauración para garantizar la recuperación ante fallos graves.

## 9. ESTRATEGIA DE PRUEBAS

- **Pruebas unitarias:** Validar la lógica de validación de payload, asignación de prioridades y reglas de geolocalización en cada microservicio.
- **Pruebas de integración:** Verificar el flujo completo de la alerta desde MQTT hasta la persistencia y notificación, incluyendo la comunicación gRPC entre servicios.
- **Pruebas de rendimiento:** Evaluar la latencia end-to-end bajo carga de picos de eventos y comprobar que la solución mantiene los tiempos requeridos.
- **Pruebas de resiliencia:** Simular la caída de un servicio o de la réplica de base de datos para comprobar que Redis y el balanceador mantienen la entrega de alertas y el reingreso correcto de los mensajes.

## 10. DESPLIEGUE Y MANTENIMIENTO

- **Inicio:** Ejecutar `docker-compose up --build` en el directorio raíz del proyecto para iniciar todos los contenedores.
- **Escalado:** Ajustar el número de instancias de `recepcion-alerta-*` y de otros servicios críticos según la demanda.
- **Variables de entorno:** Documentar y parametrizar las variables de entorno necesarias en un archivo `.env` para evitar exposiciones accidentales en el repositorio.

## 11. REGISTRO DE DECISIONES DE ARQUITECTURA (ADR)

### 7.1 ADR-001: Adopción de gRPC para Comunicación Inter-servicios Críticos

- **Estado:** Aceptado
- **Contexto:** Cumplir el SLA de procesamiento menor a 2 segundos bajo alta concurrencia requiere una comunicación de baja latencia entre el núcleo de microservicios transaccionales. El uso de REST/JSON convencional degrada los tiempos debido a la sobrecarga de empaquetado de texto plano.
- **Decisión:** Implementar gRPC sobre HTTP/2 utilizando definiciones contractuales de tipos binarios.
- **Justificación:** La transmisión binaria compacta reduce el tamaño de transferencia por red, y la multiplexación nativa de HTTP/2 suprime el coste del saludo de conexión (_handshake_) repetitivo, asegurando una comunicación síncrona en el orden de los milisegundos.

### 7.2 ADR-002: Implementación de Redis como Buffer de Mensajería para Tolerancia a Fallos

- **Estado:** Aceptado
- **Contexto:** El sistema no debe perder datos de eventos de emergencia en la capa de dispersión si las terminales de los operadores o el microservicio que las atiende se desconectan.
- **Decisión:** Utilizar listas atómicas de Redis (`LPUSH` / `RPOPLPUSH`) como almacenamiento volátil de contingencia.
- **Justificación:** Al procesar información directamente en memoria RAM, se mitiga el impacto de escritura concurrente en disco duro. Redis retiene las estructuras lógicas de las alertas durante periodos de caída de los contenedores de presentación y permite su consumo inmediato en cuanto se reanuda la disponibilidad del servicio.

### 7.3 ADR-003: Configuración de Replicación en Base de Datos y Modelo de Consistencia Eventual

- **Estado:** Aceptado
- **Contexto:** Las consultas analíticas de auditoría pesadas en la tabla de incidentes no deben interferir ni degradar la velocidad de almacenamiento transaccional de los botones de pánico del sistema core.
- **Decisión:** Configuración de PostgreSQL en clúster Maestro-Réplica aislando operaciones de mutación de las operaciones de lectura analítica.
- **Justificación:** Delegar las lecturas pesadas al nodo secundario blinda al nodo maestro contra bloqueos de concurrencia. El desfase temporal de replicación asíncrona es tolerable para fines históricos y garantiza la disponibilidad permanente del canal principal de inyección de emergencias.

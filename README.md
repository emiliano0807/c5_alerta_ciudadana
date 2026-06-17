# Sistema de Alerta Ciudadana Distribuido (Infraestructura Tipo C5)

Este repositorio contiene el diseño, documentación e implementación de un Sistema de Alerta Ciudadana distribuido tipo C5, estructurado para simular la infraestructura de control de emergencias de centros de comando reales.

El sistema procesa alertas emitidas por dispositivos físicos (tarjetas ESP32 con botón de pánico), valida y enriquece los datos a través de una malla de microservicios independientes y notifica a las estaciones de trabajo de los operadores en tiempo real.

## Arquitectura del Sistema

El ecosistema está diseñado bajo un enfoque de alta disponibilidad, tolerancia a fallos y desacoplamiento, implementando patrones avanzados como CQRS, colas de mensajería y balanceo de carga.

### 1. Capa Periférica (Hardware IoT)

Puntos de emisión construidos sobre microcontroladores **ESP32** equipados con módulos GPS NEO-6M.

- **Protocolo de Ingesta:** La telemetría se transmite vía **MQTT**, garantizando bajo consumo de ancho de banda.
- **Agrupación de Eventos:** El firmware implementa una ventana de 2 segundos para agrupar ráfagas de clics, determinando la prioridad de la alerta de forma mecánica.
- **Tolerancia a Fallos Satelitales:** Si no hay sincronización GPS al momento del pánico, inyecta coordenadas de contingencia y fecha epoch para asegurar que el paquete nunca viaje nulo.

### 2. Capa de Recepción y Balanceo (API Gateway)

- **Nginx Load Balancer:** Actúa como proxy inverso con políticas de Rate Limiting (10 req/s) para mitigar ataques DDoS. Distribuye el tráfico HTTP utilizando el algoritmo `least_conn` hacia tres instancias replicadas.
- **Microservicio Recepción:** Clúster de 3 contenedores Node.js que escuchan simultáneamente tráfico MQTT y HTTP, validan el payload y lo enrutan a la red interna.

### 3. Malla de Microservicios Lógicos (Backend)

Comunicación interna optimizada mediante **gRPC** y **Protocol Buffers**.

- **Geolocalización:** Servidor gRPC que consume la API de OpenStreetMap (Nominatim) para traducir coordenadas geográficas crudas en zonas y sectores urbanos legibles.
- **Prioridad (Motor de Reglas):** Evalúa el conteo de clics físicos y clasifica el incidente:
  - _1 clic:_ Solicitar policía (Prioridad: Medio)
  - _2 clics:_ Incendio (Prioridad: Alto)
  - _3 clics:_ Paramédicos (Prioridad: Alto)
  - _4 clics:_ Accidentes graves (Prioridad: Crítico)
  - _5+ clics:_ Desastre natural / Pánico extremo (Prioridad: Crítico)

### 4. Persistencia y Tiempo Real

- **Historial (CQRS con PostgreSQL):** Maneja el registro a largo plazo. Las operaciones de mutación (INSERT/UPDATE) se dirigen a una base de datos **Primaria**, mientras que las consultas de las consolas operativas apuntan a una base de datos **Réplica**, previniendo bloqueos transaccionales.
- **Notificaciones (Redis + WebSockets):** Implementa un patrón Productor/Consumidor. Las alertas se encolan de forma segura en Redis. Un worker extrae los eventos _únicamente_ si detecta operadores conectados vía Socket.io, previniendo condiciones de carrera y pérdida visual de alertas.

---

## Estructura del Repositorio

- `/services`: Contiene los 5 microservicios independientes (Recepción, Geolocalización, Prioridad, Historial, Notificaciones).
- `/frontend`: Aplicación cliente (React/Vite) para las estaciones de los operadores C5.
- `/esp32`: Firmware en C++ para el control de los dispositivos de hardware.
- `/config` y `/nginx`: Archivos de configuración para Mosquitto y el Balanceador de Carga.

---

## Requisitos del Entorno

Para el despliegue correcto de la infraestructura distribuida, el sistema anfitrión debe contar con:

- Docker Engine
- Docker Compose CLI
- Node.js (Solo para desarrollo local sin contenedores)

---

## Instrucciones de Despliegue Automatizado

De conformidad con los requisitos de reproducibilidad, el entorno completo se inicializa mediante un único comando ejecutable en la raíz del proyecto. Este comando levanta la red `c5_network`, inicializa las bases de datos, los brokers de mensajería, la malla de microservicios y el cliente web.

```bash
docker-compose up --build -d
```

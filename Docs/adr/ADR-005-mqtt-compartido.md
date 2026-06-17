# Registro de Decisión de Arquitectura (ADR)
## ADR-005: Prevención de Duplicidad mediante Suscripciones Compartidas MQTT

### Estado
Aceptado

### Contexto
Al escalar el microservicio de Recepción a 3 instancias en paralelo (réplicas), surgió un problema de duplicidad de eventos. Al estar las 3 instancias conectadas al mismo broker MQTT (Mosquitto) y suscritas al mismo tópico (`c5/alertas`), cuando un hardware ESP32 publicaba un mensaje de pánico, los 3 contenedores lo recibían y procesaban simultáneamente. Esto triplicaba la misma emergencia en la base de datos y en el dashboard táctico.

### Alternativas Consideradas
1. **Deduplicación en Base de Datos:** Permitir que los 3 nodos procesen la alerta, pero usar restricciones `UNIQUE` en PostgreSQL (basadas en un ID y Timestamp) para descartar los duplicados al momento de insertar. (Ineficiente, desperdicia CPU y llamadas gRPC).
2. **Nodo Maestro único para MQTT:** Dejar 2 nodos exclusivamente para HTTP y 1 nodo exclusivo para MQTT. (Rompe la simetría de los contenedores y crea un punto único de fallo).
3. **MQTT Shared Subscriptions (Suscripciones Compartidas):** Característica nativa del protocolo MQTT v5 que agrupa a los suscriptores y balancea la carga de mensajes entre ellos.

### Decisión
Se implementó el patrón de **Suscripciones Compartidas MQTT**, modificando el tópico de escucha en el código Node.js a `$share/c5_recepcion_group/c5/alertas`.

### Justificación
Esta solución delega la responsabilidad del balanceo de carga al propio broker MQTT (Mosquitto). Al utilizar el prefijo `$share/grupo/`, Mosquitto identifica que los 3 contenedores de Recepción pertenecen al mismo grupo de trabajo y garantiza que cada mensaje publicado por un ESP32 sea entregado a **uno y solo un** contenedor aleatorio del grupo. 

### Consecuencias
* **Positivas:** Se elimina la duplicidad de incidentes de raíz sin añadir lógica condicional en el código. Se logra balanceo de carga nativo para hardware, complementando el balanceo HTTP de Nginx.
* **Negativas:** Dependencia estricta de brokers que soporten MQTT versión 5 o extensiones de grupos de suscripción (Mosquitto lo soporta por defecto, pero limita la migración a brokers más antiguos).
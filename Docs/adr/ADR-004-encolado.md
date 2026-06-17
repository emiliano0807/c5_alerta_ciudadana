# Registro de Decisión de Arquitectura (ADR)
## ADR-002: Tolerancia a Fallos y Entrega Encolada para Notificaciones en Tiempo Real

### Estado
Aceptado

### Contexto
El sistema debe transmitir las alertas procesadas hacia el centro de comando en tiempo real. Sin embargo, los servidores de WebSockets son stateful (mantienen estado) y susceptibles a desconexiones. Si el microservicio de Notificaciones se reinicia o cae durante un pico de emergencias, las alertas procesadas por el motor de Prioridad no deben perderse en el vacío, asegurando que los operadores eventualmente reciban toda la información.

### Alternativas Consideradas
1. **Apache Kafka:** Altamente resiliente y persistente, pero introduce una enorme complejidad operativa y un alto consumo de memoria RAM, innecesario para el volumen del proyecto.
2. **Llamada directa (REST/gRPC) de Prioridad a Notificaciones:** Si Notificaciones está caído, la petición falla y el dato se pierde irremediablemente.
3. **Cola en memoria con Redis (Listas Lpush/Rpop):** Extremadamente rápido, estructura de datos nativa para colas (FIFO) y bajo consumo de recursos de cómputo.

### Decisión
Se implementó el uso de **Redis como bóveda de encolamiento intermedio**, aplicando un patrón *Worker* con sondeo pasivo (Polling) en el microservicio de Notificaciones.

### Justificación
El microservicio de Prioridad inyecta (Push) las alertas procesadas en una lista de Redis, actuando de forma completamente agnóstica al estado del servicio de Notificaciones. Cuando el servicio de Notificaciones (Worker) está operativo y detecta que existe al menos un operador web conectado, extrae (Pop) los mensajes de Redis. Esto garantiza una entrega segura (tolerancia a fallos demostrable) y evita el problema de *Condición de Carrera* al no extraer datos si no hay clientes WebSockets para recibirlos.

### Consecuencias
* **Positivas:** Alta resiliencia del sistema, tolerancia a caídas del servicio de WebSockets sin pérdida de alertas y desacoplamiento efectivo entre el motor de reglas y la interfaz de usuario.
* **Negativas:** Introduce una nueva pieza de infraestructura (Redis) que requiere monitoreo, además de una mínima latencia añadida por el ciclo de sondeo (polling delay) del Worker al extraer los datos.
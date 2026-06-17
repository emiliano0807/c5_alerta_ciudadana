#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

// ==========================================
// CONFIGURACIÓN DE RED Y MQTT
// ==========================================
const char* ssid = "SpaceX";
const char* password = "Isic2026??$";
const char* mqtt_server = "192.168.2.118"; 
const int mqtt_port = 1883;
const char* mqtt_topic = "c5/alertas";

// ==========================================
// CONFIGURACIÓN DE HARDWARE Y GPS
// ==========================================
const int BUTTON_PIN = 4;
bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50; // Reducido para detectar clics rápidos

// Variables para la regla de negocio de Prioridad
int pressCount = 0;
unsigned long firstPressTime = 0;
const unsigned long PRESS_WINDOW = 2000; // 2 segundos para agrupar clics

// Pines para UART2 del ESP32 conectados al GPS NEO-6M
static const int RXPin = 16, TXPin = 17;
static const uint32_t GPSBaud = 9600; 

TinyGPSPlus gps;
HardwareSerial gpsSerial(2); 

WiFiClient espClient;
PubSubClient client(espClient);

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Conectando a ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi conectado. IP: ");
  Serial.println(WiFi.localIP());
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Intentando conexion MQTT...");
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("conectado al broker");
    } else {
      Serial.print("fallo, rc=");
      Serial.print(client.state());
      Serial.println(" intentando de nuevo en 5 segundos");
      delay(5000);
    }
  }
}

void sendAlert(int count) {
  StaticJsonDocument<256> doc;
  
  doc["device_id"] = "ESP32-002";
  
  // Arreglo de caracteres para almacenar la fecha y hora formateada
  char timestamp[25];
  
  // Verificamos si el GPS ya logró sincronizar el reloj satelital
  if (gps.date.isValid() && gps.time.isValid()) {
    snprintf(timestamp, sizeof(timestamp), "%04d-%02d-%02dT%02d:%02d:%02dZ",
             gps.date.year(), gps.date.month(), gps.date.day(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
    Serial.println("Reloj satelital sincronizado.");
  } else {
    // Fallback de emergencia si se presiona el botón antes de tener señal
    snprintf(timestamp, sizeof(timestamp), "1970-01-01T00:00:00Z");
    Serial.println("ADVERTENCIA: Reloj no sincronizado. Usando fecha epoch.");
  }
  
  doc["timestamp"] = timestamp; 
  
  JsonObject coords = doc.createNestedObject("coordinates");
  
  if (gps.location.isValid()) {
    coords["lat"] = gps.location.lat();
    coords["lon"] = gps.location.lng();
    Serial.println("Coordenadas reales obtenidas del satelite.");
  } else {
    Serial.println("ADVERTENCIA: Sin fix satelital aun. Enviando coordenadas definidas");
    coords["lat"] = 19.916568972719457;
    coords["lon"] = -99.58105226618602;
  }
  
  doc["emergency_type"] = "desconocida";
  doc["press_count"] = count;

  char jsonBuffer[256];
  serializeJson(doc, jsonBuffer);

  Serial.print("Publicando alerta completa: ");
  Serial.println(jsonBuffer);
  
  client.publish(mqtt_topic, jsonBuffer);
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPSBaud, SERIAL_8N1, RXPin, TXPin);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Alimentar continuamente el objeto GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Logica de agrupacion de clics
  int reading = digitalRead(BUTTON_PIN);
  if (reading == LOW && lastButtonState == HIGH && (millis() - lastDebounceTime) > debounceDelay) {
    if (pressCount == 0) {
      firstPressTime = millis(); 
    }
    pressCount++;
    Serial.print("Clic detectado. Total en esta rafaga: ");
    Serial.println(pressCount);
    lastDebounceTime = millis();
  }
  lastButtonState = reading;

  // Evaluar si la ventana de tiempo termino para hacer el envio
  if (pressCount > 0 && (millis() - firstPressTime > PRESS_WINDOW)) {
    Serial.println("Evaluacion terminada. Despachando a Recepcion...");
    sendAlert(pressCount);
    pressCount = 0; 
  }
}
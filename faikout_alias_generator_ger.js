// ================================================================
// v0.1 (30.08.2026)    https://codeberg.org/RaW07/faikout-projects
// Entwickelt und getestet auf ioBroker JavaScript-Adapter v9.0.18
// Faikout Alias-Generator für ioBroker
// Dieses Script einmalig im JavaScript-Adapter ausführen.
// Es erkennt das Faikout automatisch und legt alle Alias-Datenpunkte an.
// Die Aliases werden auf Basis der am Gerät aktiv geschalteten Funktionen
// erstellt – deaktivierte Features werden überwiegend nicht angelegt.
// Hinweis: Bei Änderungen an den Faikout-Einstellungen (z.B. Humidifier
// aktivieren/deaktivieren) müsste das Script erneut ausgeführt werden.
//
// VORAUSSETZUNGEN:
//   1. Das Faikout muss bereits per MQTT mit ioBroker verbunden sein
//      und unter Admin → Objekte als
//        mqtt-client.0.state.GERAETE_ID.status  (mqtt-client-Adapter)
//      oder
//        mqtt.0.state.GERAETE_ID.status          (mqtt-Adapter)
//      erscheinen und Daten liefern.
//   2. Im JavaScript-Adapter muss "Objekte anlegen erlauben" aktiviert sein:
//      Admin → Instanzen → javascript.X
//      "Kommando "setObject" erlauben" = EIN
//      (Das Script prüft dies automatisch beim Start.)
//
// KONFIGURATION – nur diese Werte anpassen:
// ================================================================
const FAIKOUT_IP    = '192.168.x.x';   // IP-Adresse des Faikout
const MQTT_INSTANCE = 'mqtt-client.0';  // MQTT-Adapter Instanz
const ALIAS_NAME    = 'MeineKlima';     // Ordnername in alias.0.*
// ================================================================

'use strict';
const http = require('http');

// Adapter-Typ automatisch erkennen
const IS_MQTT_CLIENT = MQTT_INSTANCE.startsWith('mqtt-client.');
// IS_MQTT_CLIENT = true  → iobroker.mqtt-client (braucht custom-Block)
// IS_MQTT_CLIENT = false → iobroker.mqtt        (plain State genügt)

// ----------------------------------------------------------------
// Felddefinitionen
//   writeTopic: 'control'       → command.ID.control  als JSON-Objekt
//               'mode','fan'... → command.ID.<topic>   direkt
//               'setting:autot' → setting.ID.autot     direkt
//               fehlt           → read-only
// ----------------------------------------------------------------
const FIELDS = {
    power:      { label: 'Ein/Aus',                   type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({power:val})',   readConv: 'val?JSON.parse(val).power===true:false' },
    swingv:     { label: 'Vertikales Schwingen',       type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingv:val})',  readConv: 'val?JSON.parse(val).swingv===true:false' },
    swingh:     { label: 'Horizontales Schwingen',     type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingh:val})',  readConv: 'val?JSON.parse(val).swingh===true:false' },
    mode:       { label: 'Betriebsmodus (H/C/F/D/A)', type: 'mixed',   writeTopic: 'mode',           writeConv: null,                           readConv: 'val?JSON.parse(val).mode:null' },
    fan:        { label: 'Lüftermodus (z.B. 1-5/A/Q)',      type: 'mixed',   writeTopic: 'fan',            writeConv: null,                           readConv: 'val?JSON.parse(val).fan:null' },
    econo:      { label: 'Eco-Modus',                  type: 'boolean', writeTopic: 'econo',          writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).econo===true:false' },
    powerful:   { label: 'Powerful-Modus',             type: 'boolean', writeTopic: 'powerful',       writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).powerful===true:false' },
    demand:     { label: 'Bedarf/Kompressorleistung',         type: 'number',  writeTopic: 'demand',         writeConv: null,           unit: '%',       readConv: 'val?parseInt(JSON.parse(val).demand):null' },
    autot:      { label: 'Solltemperatur (Faikout)',   type: 'number',  writeTopic: 'setting:autot',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autot):null' },
    autor:      { label: 'Hysterese (Faikout)',        type: 'number',  writeTopic: 'setting:autor',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autor):null' },
    outside:    { label: 'Außentemperatur',            type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).outside):null' },
    home:       { label: 'Innentemperatur',            type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).home):null' },
    liquid:     { label: 'Kältemitteltemperatur',      type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).liquid):null' },
    inlet:      { label: 'Ansaugtemperatur',           type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).inlet):null' },
    temp:       { label: 'Sollwert (Daikin intern)',   type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).temp):null' },
    comp:       { label: 'Kompressordrehzahl',         type: 'number',  unit: 'Hz',    readConv: 'val?parseFloat(JSON.parse(val).comp):null' },
    fanrpm:     { label: 'Lüfterdrehzahl',             type: 'number',  unit: 'RPM',   readConv: 'val?parseFloat(JSON.parse(val).fanrpm):null' },
    consumption:{ label: 'Leistungsaufnahme',          type: 'number',  unit: 'W',     readConv: 'val?parseFloat(JSON.parse(val).consumption):null' },
    Whheating:  { label: 'Heizenergie (kumuliert)',    type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whheating):null' },
    Whcooling:  { label: 'Kühlenergie (kumuliert)',   type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whcooling):null' },
    Whoutside:  { label: 'Außengerät Energiezähler',  type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whoutside):null' },
    hum:        { label: 'Luftfeuchtigkeit',           type: 'number',  unit: '%',     readConv: 'val?parseFloat(JSON.parse(val).hum):null' },
    anglev:     { label: 'Vertikaler Luftwinkel',      type: 'number',  unit: '°',     readConv: 'val?JSON.parse(val).anglev:null' },
    comfort:    { label: 'Comfort-Modus',              type: 'boolean', writeTopic: 'comfort',   writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).comfort===true:false' },
    streamer:   { label: 'Luftreiniger (Streamer)',    type: 'boolean', writeTopic: 'streamer',  writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).streamer===true:false' },
    led:        { label: 'LED',                        type: 'boolean', writeTopic: 'led',       writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).led===true:false' },
    quiet:      { label: 'Quiet (Außengerät leise)',   type: 'boolean', writeTopic: 'quiet',     writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).quiet===true:false' },
    humidify:   { label: 'Befeuchter (z.B. X/L/S/H/C)', type: 'mixed', writeTopic: 'humidify', writeConv: null,      readConv: 'val?JSON.parse(val).humidify:null' },
    autoe:      { label: 'Auto-Funktion aktiv',        type: 'boolean', writeTopic: 'autoe',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autoe===true:false' },
    autop:      { label: 'Auto Ein/Aus aktiv',         type: 'boolean', writeTopic: 'autop',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autop===true:false' },
    auto0:      { label: 'Timer Ausschaltzeit',        type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto0:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto0:null' },
    auto1:      { label: 'Timer Einschaltzeit',        type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto1:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto1:null' },
    autob:      { label: 'BLE-Referenzgerät (MAC)',    type: 'mixed',   readConv: 'val?JSON.parse(val).autob:null', bleKey: true },
    antifreeze: { label: 'Frostschutz aktiv',          type: 'boolean', readConv: 'val?JSON.parse(val).antifreeze===true:false' },
    env:        { label: 'Raumtemperatur',                     type: 'number', unit: '°C', readConv: 'val?parseFloat(JSON.parse(val).env):null' },
    // env_set: Raumtemperatur an Faikout senden (Regelreferenz).
    // WICHTIG: Muss zyklisch gesendet werden – der Faikout verwirft den Wert
    // nach Ablauf von tcontrol Sekunden (Faikout-Einstellung "Control messages timeout",
    // Standard 600 s). Empfehlung: alle 30–60 s senden, damit der Wert nie abläuft.
    env_set:    { label: 'Raumtemperatur (Regelreferenz senden)', type: 'number', unit: '°C', writeTopic: 'control', writeConv: 'JSON.stringify({env:val})', writeOnly: true },
    // BLE-Sensor (optional, nur wenn Gerät BLE-Sensor meldet)
    'ble_temp': { label: 'BLE Temperatur',             type: 'number',  unit: '°C',    readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.temp):null', bleKey: true },
    'ble_hum':  { label: 'BLE Luftfeuchtigkeit',       type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.hum):null',  bleKey: true },
    'ble_bat':  { label: 'BLE Batteriestand',          type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.bat):null',   bleKey: true },
    'ble_volt': { label: 'BLE Batteriespannung',       type: 'number',  unit: 'V',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.volt):null',  bleKey: true },
};

// Felder die immer angelegt werden, auch wenn nicht in o.xyz erkannt
// (kommen aus dem MQTT-JSON oder sind synthetische Schreib-Datenpunkte)
const FIELD_WHITELIST = new Set(['comp', 'anglev', 'env_set']);

// ----------------------------------------------------------------
// Schritt 1: HTTP GET → Felder aus dem WebSocket-Handler extrahieren
//            + Extras-Seite prüfen ob optionale Features aktiv sind
// ----------------------------------------------------------------
function fetchDeviceFields(ip) {
    const fetchPage = (url) => new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => resolve(html));
        });
        req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
        req.on('error', reject);
    });

    return Promise.all([
        fetchPage(`http://${ip}/`),
        fetchPage(`http://${ip}/revk-settings?_page=-2`),
    ]).then(([mainHtml, extrasHtml]) => {
        const matches = mainHtml.match(/\bo\.([a-zA-Z]\w*)\b/g) || [];
        const found = new Set(matches.map(m => m.slice(2).toLowerCase()));

        // BLE: nur anlegen wenn bleenable aktiv ist
        const bleEnabled = /id="bleenable"[^>]*checked/.test(extrasHtml);
        if (bleEnabled && found.has('ble')) {
            found.add('ble_temp');
            found.add('ble_hum');
            found.add('ble_bat');
        } else {
            found.delete('ble');
        }

        // Optionale Features: deaktivierte Felder aus found entfernen
        for (const key of Object.keys(FIELDS)) {
            const disabled = new RegExp(`id="no${key}"[^>]*checked`).test(extrasHtml);
            if (disabled) found.delete(key);
        }

        // Whitelist-Felder immer hinzufügen
        for (const f of FIELD_WHITELIST) found.add(f);

        log(`Gerät ${ip} erreichbar – erkannte Felder: ${[...found].join(', ')}`);
        return found;
    });
}

// ----------------------------------------------------------------
// Schritt 2: GERAETE_ID direkt vom Gerät per HTTP holen (Settings-Seite)
// ----------------------------------------------------------------
function fetchGeraeteId(ip) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}/revk-settings?_page=0`, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                // Die Settings-Seite zeigt die Geräte-ID im <h1>-Tag: <h1>GERAETE_ID <b...
                const match = html.match(/<h1>([^\s<]+)/);
                if (!match) {
                    reject(new Error('GERAETE_ID nicht in Settings-Seite gefunden'));
                    return;
                }
                const geraeteId = match[1];
                log(`GERAETE_ID erkannt: ${geraeteId}`);
                resolve(geraeteId);
            });
        });
        req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout beim Lesen der Settings: ' + ip)); });
        req.on('error', reject);
    });
}

// ----------------------------------------------------------------
// mqtt-client Publish-Objekt erzeugen (command / setting Topic)
// ----------------------------------------------------------------
async function ensureMqttPublishObject(stateId, mqttTopic, valueType) {
    const common = {
        name:  mqttTopic,
        type:  valueType,
        read:  true,
        write: true,
    };

    if (IS_MQTT_CLIENT) {
        // mqtt-client braucht expliziten custom-Block mit publish:true
        common.custom = {
            [MQTT_INSTANCE]: {
                enabled:        true,
                topic:          mqttTopic,
                publish:        true,
                pubChangesOnly: false,
                pubAsObject:    false,
                qos:            0,
                retain:         false,
                subscribe:      false,
                subChangesOnly: false,
                subAsObject:    false,
                subQos:         0,
                setAck:         true,
            }
        };
    }
    // Standard mqtt-Adapter published alle State-Änderungen automatisch –
    // kein custom-Block nötig, native.topic reicht als Referenz

    await setObjectAsync(stateId, {
        type: 'state',
        common,
        native: { topic: mqttTopic }
    });
}

// ----------------------------------------------------------------
// Schritt 3: Alias-Objekte in ioBroker anlegen
// ----------------------------------------------------------------
async function buildAliases(geraeteId, deviceFields) {
    const readBase = `${MQTT_INSTANCE}.state.${geraeteId}.status`;
    const prefix   = `alias.0.${ALIAS_NAME}`;

    // Kanal (Ordner) anlegen
    await setObjectAsync(prefix, {
        type: 'channel',
        common: { name: `Faikout – ${ALIAS_NAME}` },
        native: {}
    });
    log(`Kanal angelegt: ${prefix}`);

    // Alle benötigten mqtt-client Publish-Objekte sammeln und anlegen
    const publishTargets = new Map(); // stateId → { mqttTopic, valueType }
    for (const [key, def] of Object.entries(FIELDS)) {
        if (!def.writeTopic) continue;
        if (!deviceFields.has(key) && !def.bleKey) continue;
        if (def.bleKey && !deviceFields.has('ble')) continue;
        let stateId, mqttTopic, valueType;
        if (def.writeTopic.startsWith('setting:')) {
            const field = def.writeTopic.split(':')[1];
            stateId   = `${MQTT_INSTANCE}.setting.${geraeteId}.${field}`;
            mqttTopic = `setting/${geraeteId}/${field}`;
            valueType = def.type;
        } else if (def.writeTopic === 'setting') {
            // Basis-Setting-Topic: setting/ID  (JSON-Payload, kein Feldsuffix)
            stateId   = `${MQTT_INSTANCE}.setting.${geraeteId}._json`;
            mqttTopic = `setting/${geraeteId}`;
            valueType = 'string';
        } else {
            stateId   = `${MQTT_INSTANCE}.command.${geraeteId}.${def.writeTopic}`;
            mqttTopic = `command/${geraeteId}/${def.writeTopic}`;
            valueType = def.writeTopic === 'control' ? 'string' : def.type;
        }
        publishTargets.set(stateId, { mqttTopic, valueType });
    }
    for (const [stateId, { mqttTopic, valueType }] of publishTargets) {
        await ensureMqttPublishObject(stateId, mqttTopic, valueType);
        log(`  ⬆ ${stateId}`);
    }

    let count = 0;
    const createdKeys = new Set();

    for (const [key, def] of Object.entries(FIELDS)) {
        // Feld nur anlegen wenn Gerät es meldet, BLE-fähig ist, oder es auf der Whitelist steht
        if (!deviceFields.has(key) && !def.bleKey) continue;
        if (def.bleKey && !deviceFields.has('ble')) continue;

        const writable = !!def.writeTopic;

        // Write-Ziel-ID bestimmen
        let writeId;
        if (writable) {
            if (def.writeTopic.startsWith('setting:')) {
                const settingField = def.writeTopic.split(':')[1];
                writeId = `${MQTT_INSTANCE}.setting.${geraeteId}.${settingField}`;
            } else if (def.writeTopic === 'setting') {
                writeId = `${MQTT_INSTANCE}.setting.${geraeteId}._json`;
            } else {
                writeId = `${MQTT_INSTANCE}.command.${geraeteId}.${def.writeTopic}`;
            }
        }

        const writeOnly = writable && !!def.writeOnly;
        const common = {
            name:  def.label,
            type:  def.type,
            read:  !writeOnly,
            write: writable,
            alias: {
                id:   writeOnly ? writeId : (writable ? { read: readBase, write: writeId } : readBase),
            }
        };
        if (!writeOnly)                  common.alias.read    = def.readConv;
        if (def.unit)                    common.unit          = def.unit;
        if (writable && def.writeConv)   common.alias.write   = def.writeConv;

        await setObjectAsync(`${prefix}.${key}`, {
            type: 'state',
            common,
            native: {}
        });
        log(`  ✓ ${prefix}.${key}  (${def.label})`);
        createdKeys.add(key);
        count++;
    }

    // Veraltete Datenpunkte entfernen – nur bekannte FIELDS-Keys, keine manuell ergänzten
    let removed = 0;
    for (const key of Object.keys(FIELDS)) {
        if (!createdKeys.has(key)) {
            try {
                await deleteObjectAsync(`${prefix}.${key}`);
                log(`  🗑 ${prefix}.${key} entfernt`);
                removed++;
            } catch (e) {
                // Objekt existiert nicht – kein Problem
            }
        }
    }

    log('');
    log(`✅ Fertig: ${count} Datenpunkte angelegt, ${removed} entfernt – alias.0.${ALIAS_NAME}`);
    log(`   Gerät:      http://${FAIKOUT_IP}/`);
    log(`   GERAETE_ID: ${geraeteId}`);
    log(`   Lese-Topic: ${readBase}`);
}

// ----------------------------------------------------------------
// Hauptprogramm
// ----------------------------------------------------------------
(async function main() {
    log('═══════════════════════════════════════════');
    log('Faikout Alias-Generator');
    log(`  Gerät:  http://${FAIKOUT_IP}/`);
    log(`  MQTT:   ${MQTT_INSTANCE}`);
    log(`  Alias:  alias.0.${ALIAS_NAME}`);
    log('═══════════════════════════════════════════');

    try {
        // Prüfen ob setObject im JavaScript-Adapter aktiviert ist
        const jsObj = await getObjectAsync(`system.adapter.javascript.${instance}`);
        if (!jsObj || !jsObj.native || !jsObj.native.enableSetObject) {
            log('❌ Voraussetzung nicht erfüllt: "Objekte anlegen" ist im JavaScript-Adapter deaktiviert.', 'error');
            log('   Admin → Instanzen → javascript.' + instance + ' → "Kommando setObject erlauben" = EIN', 'error');
            return;
        }

        // Felder und GERAETE_ID beide direkt vom Gerät per HTTP
        const [deviceFields, geraeteId] = await Promise.all([
            fetchDeviceFields(FAIKOUT_IP),
            fetchGeraeteId(FAIKOUT_IP),
        ]);

        // Energiezähler per MQTT-Status prüfen – nur anlegen wenn Gerät sie tatsächlich liefert
        const statusState = await getStateAsync(`${MQTT_INSTANCE}.state.${geraeteId}.status`);
        if (statusState && statusState.val) {
            try {
                const json = JSON.parse(statusState.val);
                for (const key of ['Whoutside', 'Whheating', 'Whcooling']) {
                    if (json[key] !== undefined) deviceFields.add(key);
                }
            } catch (e) { /* JSON-Fehler ignorieren */ }
        }

        await buildAliases(geraeteId, deviceFields);

    } catch (err) {
        log('❌ ' + err.message, 'error');
    }
})();

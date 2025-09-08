const mysql = require("mysql2/promise");
const amqp = require("amqplib");

// Configuración RabbitMQ
const rabbitMQUrl = "amqp://lightdata:QQyfVBKRbw6fBb@158.69.131.226:5672";
const queue = "enviosml_ia";

// Configuración MySQL
const con = mysql.createPool({
    host: "bhsws10.ticdns.com",
    user: "callback_u2u3",
    password: "7L35HWuw,8,i",
    database: "callback_incomesML",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

// Rangos de fecha (modificables)
const FECHA_INICIO = "2025-09-05 00:30:00";
const FECHA_FIN = "2025-09-020 16:50:00";

// Función principal
async function enviarMensajes() {
    let rabbitConnection;
    let rabbitChannel;

    try {
        console.log("Conectando a RabbitMQ...");
        rabbitConnection = await amqp.connect(rabbitMQUrl);
        rabbitChannel = await rabbitConnection.createChannel();
        await rabbitChannel.assertQueue(queue, { durable: true });
        console.log("✅ Conectado a RabbitMQ.");

        console.log("Consultando base de datos...");
        const [rows] = await con.query(
            `SELECT resource, seller_id, autofecha FROM db_shipments WHERE autofecha >= ? AND autofecha <= ? and seller_id = 91570351 `,
            [FECHA_INICIO, FECHA_FIN]
        );
        console.log(`🔍 Se encontraron ${rows.length} registros para enviar.`);
        let contador = 0;
        for (const row of rows) {


            const msg = {
                resource: row.resource,
                sellerid: row.seller_id,
                fecha: row.autofecha,
            };

            await rabbitChannel.sendToQueue(queue, Buffer.from(JSON.stringify(msg)), {
                persistent: true,
            });

            console.log("📤 Enviado:", msg);
            contador++;
        }
        console.log("✅ Todos los mensajes fueron enviados.");
    } catch (err) {
        console.error("❌ Error durante el procesamiento:", err);
    } finally {
        if (rabbitChannel) {
            try {
                await rabbitChannel.close();
            } catch (_) { }
        }
        if (rabbitConnection) {
            try {
                await rabbitConnection.close();
            } catch (_) { }
        }
        await con.end();
        console.log("🚪 Conexiones cerradas. Proceso finalizado.");
    }
}

// Ejecutar la función
enviarMensajes();

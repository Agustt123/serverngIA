// test-db.js
// Requiere: npm i mysql2
const mysql = require("mysql2/promise");

async function main() {
    const config = {
        host: "bhsmysql1.lightdata.com.ar",
        user: "lightdat_ucreadologistica",
        password: "mL}2,xGICAVw",
        database: "lightdat_tt_creadologistica",
        // port: 3306,
        // ssl: { rejectUnauthorized: true }, // activalo si el server lo pide
    };

    let conn;
    try {
        console.log("Conectando a:", {
            host: config.host,
            user: config.user,
            database: config.database,
        });

        conn = await mysql.createConnection(config);
        await conn.ping(); // valida conexión

        const [rows] = await conn.query("SELECT 'hola' AS saludo;");
        console.log(rows?.[0]?.saludo ?? "hola"); // -> "hola"
        console.log("Conexión OK ✅");
        process.exit(0);
    } catch (e) {
        console.error("Error de conexión ❌:", e?.message || e);
        process.exit(1);
    } finally {
        if (conn) { try { await conn.end(); } catch { } }
    }
}

main();

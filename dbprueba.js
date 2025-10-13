const mysql = require('mysql2/promise');

async function main() {
    const config = {
        host: 'bhsmysql1.lightdata.com.ar',   // o 'localhost' si corresponde
        user: 'preenvi2_upreenvios',
        password: 'eH[Us5;[y75#',
        database: 'preenvi2_preenvios',
        // port: 3306,
        connectTimeout: 8000
    };

    try {
        const conn = await mysql.createConnection(config);
        await conn.ping();           // prueba rápida
        console.log('OK');           // mensaje cortito si conectó bien
        await conn.end();
        process.exit(0);
    } catch (err) {
        console.error('NO OK:', err.message);
        process.exit(1);
    }
}

main();

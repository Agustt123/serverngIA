const amqp = require("amqplib");
const redis = require("redis");
const axios = require("axios"); // Para manejar solicitudes HTTP
const { exec } = require("child_process");
const fs = require("fs");

const pm2 = require("pm2"); // Importar PM2

async function reiniciarScript() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        console.error("Error al conectar a PM2:", err);
        return reject(err);
      }

      pm2.restart("serverng.js", (err) => {
        pm2.disconnect(); // Desconectar de PM2
        if (err) {
          console.error("Error al reiniciar el script:", err);
          return reject(err);
        }
        console.log("Script reiniciado correctamente.");
        resolve();
      });
    });
  });
}

let Atokens = [];
let AsellersData = [];
let Ausados = [];
let AusadosFF = [];

const redisClient = redis.createClient({
  socket: {
    host: "192.99.190.137",
    port: 50301,
  },
  password: "sdJmdxXC8luknTrqmHceJS48NTyzExQg",
});

redisClient.on("error", (err) => {
  console.error("Error al conectar con Redis:", err);
});

async function main() {
  try {
    await redisClient.connect();
    await getTokenRedis();
    await obtenerSellersActivos();
    await consumirMensajes();
    // console.log("termine");
  } catch (error) {
    await reiniciarScript();
    console.error("Error en la ejecución principal:", error);
  } finally {
    await redisClient.disconnect();
  }
}

async function obtenerDatosEnvioML(shipmentid, token) {
  //console.log(token);
  //console.log(shipmentid);
  // console.log("dataaa");

  try {
    const url = `https://api.mercadolibre.com/shipments/${shipmentid}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.data && response.data.id) {
      return response.data;
    } else {
      console.error(
        `No se encontraron datos válidos para el envío ${shipmentid}.`
      );
      return null;
    }
  } catch (error) {
    console.error(
      `Error al obtener datos del envío ${shipmentid} desde Mercado Libre:`,
      error.message
    );
    return null;
  }
}

async function obtenerDatosOrderML(shipmentid, token) {
  try {
    const url = `https://api.mercadolibre.com/orders/${shipmentid}`;
    // console.log(url);
    //console.log(token);
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.data && response.data.id) {
      return response.data;
    } else {
      console.error(
        `No se encontraron datos válidos para el envío ${shipmentid}.`
      );
      return null;
    }
  } catch (error) {
    console.error(
      `Error al obtener datos del envío ${shipmentid} desde Mercado Libre:`,
      error.message
    );
    return null;
  }
}

async function getTokenRedis() {
  try {
    const type = await redisClient.type("token");
    if (type !== "hash") {
      //console.error(La clave 'token' no es un hash, es de tipo: ${type});
      return; // O maneja el error según sea necesario
    }

    const data = await redisClient.hGetAll("token");
    // console.log(data);
    Atokens = data; // Asegúrate de que esto sea lo que necesitas
  } catch (error) {
    console.error("Error al obtener tokens de Redis:", error);
  }
}

async function getTokenForSeller(seller_id) {
  try {
    token = Atokens[seller_id];

    if (token) {
      return token;
    } else {
      return -1;
    }
  } catch (error) {
    console.error("Error al obtener el token de Redis:", error);
    return -1;
  }
}

function extractKey(resource) {
  const match = resource.match(/\/shipments\/(\d+)/);
  return match ? match[1] : null;
}

async function obtenerFechaActual() {
  const ahora = new Date();

  // Formato "YYYY-MM-DD"
  const fechaFormateada = ahora.toISOString().split("T")[0];

  // Formato Unix timestamp (segundos desde 1970)
  const timestampUnix = Math.floor(ahora.getTime() / 1000);

  return {
    fecha: fechaFormateada,
    unix: timestampUnix,
  };
}

async function armadojsonff(income) {

  /*
    [

      {"number": "XXXXXXXXXXX",
      "fecha_venta":"",
      "items":[
        //como los tenemos aahora los campos
      ]}, 
     {"number": "XXXXXXXXXXX",
      "fecha_venta":"",
      "items":[
        //como los tenemos aahora los campos
      ]}
    ]
  */

  const orderData = income.orderData;
  const envioML = income.envioML;
  const sellerid = income.sellerid;
  const fulfillment = 1; //income.fulfillment;
  let Aorders = [];

  shipping_items = envioML.shipping_items;
  order_items = orderData.order_items;

  tracking_method = envioML.tracking_method;
  receiver_address = envioML.receiver_address;
  tags = envioML.tags;
  turbo = tags.includes("turbo") ? 1 : 0;
  idorder = orderData.id;
  packid = orderData.pack_id;
  pesototal = 0;
  statusO = orderData.status;

  pref = "C";
  if (envioML.delivery_preference == "Residential") {
    pref = "R";
  }
  /*
   console.log("shipment", shipping_items);
   console.log("orderitems",order_items);
    */
  fechactual = await obtenerFechaActual();
  AenviosItems = [];
  if (fulfillment == 1) {
    for (n in order_items) {
      const linitems = order_items[n];

      dimensions = "";
      peso = 0;
      variacion = "";

      if (linitems.item.variation_id != null) {
        variacion = linitems.item.variation_id;
      }

      for (j in shipping_items) {
        const lineashipment = shipping_items[j];

        if (
          linitems.item.id == lineashipment.id &&
          linitems.quantity == lineashipment.quantity
        ) {
          let dimen = lineashipment.dimensions;
          const [medidasStr, pesoStr] = dimen.split(",");

          dimensions = medidasStr;
          pesototal += pesoStr * 1;
        }
      }

      a = {
        codigo: linitems.item.id,
        imagen: "",
        descripcion: linitems.item.title,
        ml_id: linitems.item.id,
        dimensions: dimensions,
        cantidad: linitems.quantity,
        variacion: variacion,
        seller_sku: linitems.item.seller_sku,
      };

      AenviosItems.push(a);
    }

    // process.exit(0);
  }

  let data = {
    didDeposito: 1,
    didEmpresa: income.didEmpresa,
    ff: income.ff,
    ia: income.ia,
    operador: "enviosMLIA",
    fulfillment: fulfillment,
    gtoken: "",
    flex: 1,
    turbo: turbo,
    status_order: statusO,
    fecha_inicio: fechactual.fecha,
    fechaunix: fechactual.unix,
    lote: "mlia",
    ml_shipment_id: orderData.shipping.id,
    ml_vendedor_id: sellerid,
    ml_venta_id: idorder,
    ml_pack_id: packid,
    ml_qr_seguridad: "",
    didCliente: income.didCliente,
    didCuenta: income.didCuenta,
    didServicio: 1,
    peso: pesototal,
    volumen: 0,
    bultos: 1,
    valor_declarado: orderData.paid_amount,
    monto_total_a_cobrar: 0,
    tracking_method: tracking_method,
    tracking_number: orderData.shipping.id,
    fecha_venta: orderData.date_created,
    destination_receiver_name: receiver_address.receiver_name,
    destination_receiver_phone: receiver_address.receiver_phone,
    destination_receiver_email: "",
    destination_comments: receiver_address.comment,
    delivery_preference: pref,
    quien: 0,
    enviosObservaciones: {
      observacion: receiver_address.comment,
    },
    enviosDireccionesDestino: {
      calle: receiver_address.street_name,
      numero: receiver_address.street_number,
      address_line: receiver_address.address_line,
      cp: receiver_address.zip_code,
      localidad: receiver_address.city.name,
      provincia: receiver_address.state.name,
      pais: receiver_address.country.name,
      latitud: receiver_address.latitude,
      longitud: receiver_address.longitude,
      quien: 0,
      destination_comments: receiver_address.comment,
      delivery_preference: pref,
    },
    enviosItems: AenviosItems,
    orders: Aorders
  };

  //console.log(data);

  return data;

}

async function armadojson(income) {
  const orderData = income.orderData;
  const envioML = income.envioML;
  const sellerid = income.sellerid;
  const fulfillment = 1; //income.fulfillment;

  shipping_items = envioML.shipping_items;
  order_items = orderData.order_items;

  tracking_method = envioML.tracking_method;
  receiver_address = envioML.receiver_address;
  tags = envioML.tags;
  turbo = tags.includes("turbo") ? 1 : 0;
  idorder = orderData.id;
  packid = orderData.pack_id;
  pesototal = 0;
  statusO = orderData.status;

  pref = "C";
  if (envioML.delivery_preference == "Residential") {
    pref = "R";
  }
  /*
   console.log("shipment", shipping_items);
   console.log("orderitems",order_items);
    */
  fechactual = await obtenerFechaActual();
  AenviosItems = [];
  if (fulfillment == 1) {
    for (n in order_items) {
      const linitems = order_items[n];

      dimensions = "";
      peso = 0;
      variacion = "";

      if (linitems.item.variation_id != null) {
        variacion = linitems.item.variation_id;
      }

      for (j in shipping_items) {
        const lineashipment = shipping_items[j];

        if (
          linitems.item.id == lineashipment.id &&
          linitems.quantity == lineashipment.quantity
        ) {
          let dimen = lineashipment.dimensions;
          const [medidasStr, pesoStr] = dimen.split(",");

          dimensions = medidasStr;
          pesototal += pesoStr * 1;
        }
      }

      a = {
        codigo: linitems.item.id,
        imagen: "",
        descripcion: linitems.item.title,
        ml_id: linitems.item.id,
        dimensions: dimensions,
        cantidad: linitems.quantity,
        variacion: variacion,
        seller_sku: linitems.item.seller_sku,
      };

      AenviosItems.push(a);
    }

    // process.exit(0);
  }

  let data = {
    didDeposito: 1,
    didEmpresa: income.didEmpresa,
    ff: income.ff,
    ia: income.ia,
    operador: "enviosMLIA",
    fulfillment: fulfillment,
    gtoken: "",
    flex: 1,
    turbo: turbo,
    status_order: statusO,
    fecha_inicio: fechactual.fecha,
    fechaunix: fechactual.unix,
    lote: "mlia",
    ml_shipment_id: orderData.shipping.id,
    ml_vendedor_id: sellerid,
    ml_venta_id: idorder,
    ml_pack_id: packid,
    ml_qr_seguridad: "",
    didCliente: income.didCliente,
    didCuenta: income.didCuenta,
    didServicio: 1,
    peso: pesototal,
    volumen: 0,
    bultos: 1,
    valor_declarado: orderData.paid_amount,
    monto_total_a_cobrar: 0,
    tracking_method: tracking_method,
    tracking_number: orderData.shipping.id,
    fecha_venta: orderData.date_created,
    destination_receiver_name: receiver_address.receiver_name,
    destination_receiver_phone: receiver_address.receiver_phone,
    destination_receiver_email: "",
    destination_comments: receiver_address.comment,
    delivery_preference: pref,
    quien: 0,
    enviosObservaciones: {
      observacion: receiver_address.comment,
    },
    enviosDireccionesDestino: {
      calle: receiver_address.street_name,
      numero: receiver_address.street_number,
      address_line: receiver_address.address_line,
      cp: receiver_address.zip_code,
      localidad: receiver_address.city.name,
      provincia: receiver_address.state.name,
      pais: receiver_address.country.name,
      latitud: receiver_address.latitude,
      longitud: receiver_address.longitude,
      quien: 0,
      destination_comments: receiver_address.comment,
      delivery_preference: pref,
    },
    enviosItems: AenviosItems
  };

  //console.log(data);

  return data;
}

async function obtenerSellersActivos() {
  try {
    const response = await axios.get(
      "https://callbackml.lightdata.app/sellersactivos.php?operador=showallV2"
    );
    AsellersData = response.data;
  } catch (error) {
    console.error("Error al obtener sellers activos:", error.message);
    throw error;
  }
}

async function enviarColaEnviosAlta(datajson) {
  const queue = "insertMLIA";
  const message = datajson;

  //console.log("mensaje a enviar:");
  //console.log(message);

  try {
    const connection = await amqp.connect({
      protocol: "amqp",
      hostname: "158.69.131.226",
      port: 5672,
      username: "lightdata",
      password: "QQyfVBKRbw6fBb",
      heartbeat: 30,
    });

    const channel = await connection.createChannel();
    await channel.assertQueue(queue, { durable: true });
    await channel.prefetch(20);

    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });

    console.log("Mensaje enviado a la cola insertMLIA:");

    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Error al enviar el mensaje a la cola:", error);
  }
}

async function consumirMensajes() {
  let connection;
  let channel;
  let retryCount = 0;
  const maxRetries = 2; // Límite de intentos
  const scriptName = "serverngIA.js"; // Cambia esto por el nombre de tu script

  const reconnect = async () => {
    try {
      // Verifica si la conexión y el canal están abiertos antes de cerrarlos
      if (connection && connection.isOpen) await connection.close();
      if (channel && channel.isOpen) await channel.close();

      // Conectar a RabbitMQ
      connection = await amqp.connect({
        protocol: "amqp",
        hostname: "158.69.131.226",
        port: 5672,
        username: "lightdata",
        password: "QQyfVBKRbw6fBb",
        heartbeat: 30,
      });

      // Crear un nuevo canal
      channel = await connection.createChannel();
      await channel.assertQueue("enviosml_ia", { durable: true });
      await channel.prefetch(20);

      //540009458 => [{"didEmpresa":"105","didCliente":"22","didCuenta":"131","clave":"105-22-131"}]

      // Consumir mensajes
      channel.consume(
        "enviosml_ia",
        async (mensaje) => {
          if (mensaje) {
            try {
              const data = JSON.parse(mensaje.content.toString());
              const shipmentid = extractKey(data["resource"]);
              const sellerid = data["sellerid"];

              if (AsellersData && AsellersData[sellerid]) {
                const sellerdata = AsellersData[sellerid];
                const didCliente = sellerdata[0]["didCliente"] * 1;
                const didCuenta = sellerdata[0]["didCuenta"] * 1;
                const didEmpresa = sellerdata[0]["didEmpresa"] * 1;
                const ff = sellerdata[0]["ff"] * 1;
                const ia = sellerdata[0]["ia"] * 1;

                const token = await getTokenForSeller(sellerid);

                if (token != -1) {
                  const envioML = await obtenerDatosEnvioML(shipmentid, token);

                  if (ff == 1) {

                    const orderid = envioML.order_id;
                    const orderData = await obtenerDatosOrderML(orderid, token);
                    const packid = orderData.pack_id; //fijarse si es null poner en vacio
                    const claveusada = `${sellerid}-${packid}-${orderid}-${shipmentid}`;

                    if (!AusadosFF.hasOwnProperty(claveusada)) {
                      let Aorders = [];
                      let AordersData = [];
                      if (packid != "") {

                        //busco en ML las orders del pack id
                        //agrego a cada 1 a Aorders

                      } else {
                        Aorders.push(orderid);
                      }

                      //recorro Aorders y me traigo los datos de la venta
                      for (j in Aorders) {

                        let orderPack = await obtenerDatosOrderML(Aorders[j], token);
                        //AordersData
                      }

                      const income = {
                        sellerid,
                        didEmpresa,
                        didCliente,
                        didCuenta,
                        orderData,
                        envioML,
                        ff,
                        ia,
                        AordersData
                      };

                      const dataEnviar = {
                        operador: "enviosmlia",
                        data: await armadojsonff(income),
                      };

                      await enviarColaEnviosAlta(dataEnviar);

                      AusadosFF[claveusada] = 1;
                    }

                    //uso otro armado jsonff
                    //insrtas el envio 

                  } else {

                    if (envioML && envioML.logistic_type == "self_service") {
                      const orderid = envioML.order_id;
                      const orderData = await obtenerDatosOrderML(orderid, token);

                      const claveusada = `${sellerid}-${orderid}-${shipmentid}`;
                      if (!Ausados.hasOwnProperty(claveusada)) {
                        const income = {
                          sellerid,
                          didEmpresa,
                          didCliente,
                          didCuenta,
                          orderData,
                          envioML,
                          ff,
                          ia
                        };

                        const dataEnviar = {
                          operador: "enviosmlia",
                          data: await armadojson(income),
                        };

                        await enviarColaEnviosAlta(dataEnviar);
                        Ausados[claveusada] = 1;
                      }
                    }

                  }




                }

              }
            } catch (err) {
              console.error("Error procesando mensaje:", err);
            } finally {
              channel.ack(mensaje); // ✅ SIEMPRE hacemos ACK
            }
          }
        },
        { noAck: false }
      );

      // Manejo de errores en el canal
      channel.on("error", handleError);
      channel.on("close", handleClose);

      // Manejo de errores en la conexión
      connection.on("error", handleError);
      connection.on("close", handleClose);

      retryCount = 0; // Reiniciar el contador de reintentos cuando la reconexión tiene éxito
    } catch (err) {
      console.error("Error al conectar a RabbitMQ:", err);
      handleReconnect();
    }
  };

  const handleError = (err) => {
    console.error("Error:", err);
    handleReconnect();
  };

  const handleClose = () => {
    console.error("Conexión cerrada. Intentando reconectar...");
    handleReconnect();
  };

  const handleReconnect = () => {
    if (retryCount < maxRetries) {
      retryCount++;
      setTimeout(reconnect, 5000); // Reintentar después de 5 segundos
    } else {
      console.error(
        "Se alcanzó el límite de reintentos de conexión. Reiniciando el script con PM2..."
      );
      exec(`pm2 restart ${scriptName}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error al reiniciar el script: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Error en stderr: ${stderr}`);
          return;
        }
        console.log(`Script reiniciado: ${stdout}`);
      });
    }
  };

  await reconnect();
}

// Llamar a la función principal
main();

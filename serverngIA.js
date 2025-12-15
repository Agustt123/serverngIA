const amqp = require("amqplib");
const redis = require("redis");
const axios = require("axios");
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
async function ensureRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
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
    //    await redisClient.disconnect();
  }
}

async function obtenerDatosEnvioML(shipmentid, token) {
  //console.log(token);
  //console.log(shipmentid);
  // console.log("dataaa");

  try {
    const url = `https://api.mercadolibre.com/shipments/${shipmentid}`;
    // console.log(url, "url");
    // console.log(token, "token");
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
    //  console.log(token);
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
    await ensureRedis();
    const data = await redisClient.hGetAll("token"); // devuelve { "208137579": "tok...", ... }
    Atokens = data || {};
  } catch (error) {
    console.error("Error al obtener tokens de Redis:", error);
    Atokens = {};
  }
}

async function getTokenForSeller(seller_id) {
  const key = String(seller_id);

  // 1) intento en cache
  if (Atokens[key]) {
    return Atokens[key];
  }

  // 2) refresco todo el hash
  await getTokenRedis();

  // 3) devuelvo el token o -1 si no existe
  return Atokens[key] || -1;
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

  const orderData = income.orderData;
  const envioML = income.envioML;
  const sellerid = income.sellerid;
  const fulfillment = 1; // income.fulfillment;
  let Aorders = [];
  let AenviosItems = [];
  let AfinalItems = [];

  const shipping_items = envioML.shipping_items;
  const order_items = orderData.order_items;

  const tracking_method = envioML.tracking_method;
  const receiver_address = envioML.receiver_address;
  const tags = envioML.tags;
  const turbo = tags.includes("turbo") ? 1 : 0;
  const idorder = orderData.id;
  const packid = orderData.pack_id;
  let pesototal = 0;
  const statusO = orderData.status;

  let pref = "C";
  if (envioML.delivery_preference === "Residential") {
    pref = "R";
  }

  const fechactual = await obtenerFechaActual();

  // Procesar cada orden en AordersData
  for (const order of income.AordersData) {
    AenviosItems = [];

    const order_items = order.order_items; // Obtener items de la orden actual

    if (fulfillment === 1) {
      for (const linitems of order_items) {
        let dimensions = "";
        let peso = 0;
        let variacion = "";

        if (linitems.item.variation_id != null) {
          variacion = linitems.item.variation_id;
        }

        for (const lineashipment of shipping_items) {
          if (
            linitems.item.id === lineashipment.id &&
            linitems.quantity === lineashipment.quantity
          ) {
            const dimen = lineashipment.dimensions;
            const [medidasStr, pesoStr] = dimen.split(",");

            dimensions = medidasStr;
            pesototal += pesoStr * 1;
          }
        }

        const item = {
          codigo: linitems.item.id,
          imagen: "",
          descripcion: linitems.item.title,
          ml_id: linitems.item.id,
          dimensions: dimensions,
          cantidad: linitems.quantity,
          variacion: variacion,
          seller_sku: linitems.item.seller_sku,
        };

        AenviosItems.push(item);
        AfinalItems.push(item);
      }
    }

    // Agregar la orden simplificada a Aorders
    Aorders.push({
      number: String(order.id), // Convertir a string si es necesario
      fecha_venta: order.date_created,
      items: AenviosItems,
    });
  }
  let didMetodoEnvio = 0
  if (income.envioML.logistic_type === "cross_docking") {
    didMetodoEnvio = 2;
  } if (income.envioML.logistic_type === "self_service") {
    didMetodoEnvio = 3;
  }


  let data = {
    didDeposito: 1,
    didEmpresa: income.didEmpresa,
    ff: income.ff,
    ia: income.ia,
    lote: "FFIA",
    operador: "enviosMLIA",
    fulfillment: fulfillment,
    gtoken: "",
    flex: 1,
    turbo: turbo,
    status_order: statusO,
    fecha_inicio: fechactual.fecha,
    fechaunix: fechactual.unix,
    ml_shipment_id: orderData.shipping.id,
    ml_vendedor_id: income.sellerid,
    ml_venta_id: orderData.id,
    ml_pack_id: orderData.pack_id,
    mode: income.envioML.logistic_type,
    didMetodoEnvio: didMetodoEnvio,


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
    enviosItems: AfinalItems,
    orders: Aorders, // Aquí se agrega la nueva estructura
  };

  //  console.log(data.mode, "dataaa");

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
  let didMetodoEnvio = 0
  if (income.envioML.logistic_type === "cross_docking") {
    didMetodoEnvio = 2;
  } if (income.envioML.logistic_type === "self_service") {
    didMetodoEnvio = 3;
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
    mode: income.envioML.logistic_type,
    didMetodoEnvio: didMetodoEnvio,
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
  };

  //console.log(data);

  return data;
}

async function obtenerSellersActivos() {
  try {
    const response = await axios.get(
      "https://callbackml.lightdata.app/sellersactivos.php?operador=showallV2"
    );

    if (response.data && Object.keys(response.data).length > 0) {
      AsellersData = response.data;
      console.log(`✅ AsellersData actualizado con ${Object.keys(AsellersData).length} sellers.`);
    } else {
      console.warn("⚠️ Datos vacíos. No se actualiza AsellersData.");

    }

  } catch (error) {
    console.error("❌ Error al obtener sellers activos:", error.message);

    throw error;
  }
}

async function obtenerSellersActivosV2() {
  try {
    const response = redisClient.hGet("sellersactivosV2");
    if (response.data && Object.keys(response.data).length > 0) {
      AsellersData = response.data;
      console.log(`✅ AsellersData actualizado con ${Object.keys(AsellersData).length} sellers.`);
    } else {
      console.warn("⚠️ Datos vacíos. No se actualiza AsellersData.");

    }

  } catch (error) {
    console.error("❌ Error al obtener sellers activos:", error.message);

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
async function enviarColaEnviosAltaFF(datajson) {
  const queue = "insertFF";
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

    console.log("Mensaje enviado a la cola insertFF:");

    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Error al enviar el mensaje a la cola:", error);
  }
}
async function enviarColaLogs(datajson) {
  const queue = "callback_logs";
  const message = datajson;

  console.log("mensaje a enviar:");
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

    console.log("Mensaje enviado a la cola de logs:");

    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Error al enviar el mensaje a la cola:", error);
  }
}

async function enviarColaLogsInfo(datajson, data, type) {
  const queue = "callback_logsInfo";
  const message = {
    datajson,
    data,
    type
  };

  //console.log("mensaje a enviar:", message);

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

    console.log("Mensaje enviado a la cola de logs.");

    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Error al enviar el mensaje a la cola:", error);
  }
}

async function getPackData(packId, token) {
  try {
    const url = `https://api.mercadolibre.com/packs//${packId}`;
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
async function verificarSiPaso(envioML, didEmpresa, sellerid) {
  const sellersValidos = [
    "1593590494",
    "298477234",
    "1433300659",
    "51990749",
    "746339074",
    "23598767",
    "135036152",
    "209906959",
    "2436413856",
    "1076740090",
    "190172442",
    "452306476",
    "440591558",
    "2617161769",
    "700634176",
    "1434981515",
    "161284628",
    "199919849",
    "206546555",
    "113436700",
    "251484997",
    "1104855194",
    "2352102716",
    "2244145",
    "113436700",
    "92182809",
    "1125463169",
    "2213235569",
    "2708091389",
    "1115144574",
    "1109347619"



  ];

  if (!envioML) return false;

  if (didEmpresa == 170 || didEmpresa == undefined) {
    console.log("Empresa 170, no se procesa el mensaje");
    // console.log(`Mensaje ignorado: ${JSON.stringify(envioML)}`);
    return false;
  }

  const tipo = envioML.logistic_type;

  if (tipo === "self_service") {
    return true;
  }

  // Reglas específicas por empresa y tipo
  if (sellersValidos.includes(sellerid) && (tipo == "cross_docking" || tipo == "drop_off" || tipo == "xd_drop_off")) {
    console.log("DSADADASDASDAASDASD");


    return true;
  }
  if (tipo === "xd_drop_off" && sellersValidos.includes(sellerid)) {
    return true;
  }
  if ((didEmpresa === 97 || didEmpresa === 130) && tipo === "drop_off" && sellersValidos.includes(sellerid)) {
    return true;
  }
  if (didEmpresa === 97 && tipo === "cross_docking" && sellersValidos.includes(sellerid)) {
    return true;
  }
  if (tipo === "fulfillment") {
    return false;
  }
  if (didEmpresa === 274 && tipo === "cross_docking" && sellersValidos.includes(sellerid)) {
    return true;
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
      await channel.prefetch(10000);

      //540009458 => [{"didEmpresa":"105","didCliente":"22","didCuenta":"131","clave":"105-22-131"}]

      // Consumir mensajes
      channel.consume(
        "enviosml_ia",

        async (mensaje) => {
          if (mensaje) {
            try {

              const data = JSON.parse(mensaje.content.toString());
              const shipmentid = extractKey(data["resource"]);
              const sellerid = String(data["sellerid"]);

              await enviarColaLogs(data);

              if (!AsellersData || !AsellersData[sellerid]) {
                await obtenerSellersActivos();
              }


              const sellerdata = AsellersData?.[sellerid];
              if (sellerdata && sellerdata.length > 0) {
                const didCliente = sellerdata[0]["didCliente"] * 1;
                const didCuenta = sellerdata[0]["didCuenta"] * 1;
                const didEmpresa = sellerdata[0]["didEmpresa"] * 1;
                let ff = sellerdata[0]["ff"] * 1;
                const ia = sellerdata[0]["ia"] * 1;

                if (didEmpresa == 274 && didCliente == 3 && didCuenta == 28) {
                  ff = 0;
                }




                const token = await getTokenForSeller(sellerid);





                if (token != -1) {
                  const envioML = await obtenerDatosEnvioML(shipmentid, token);

                  if (ff == 1) {

                    if (didEmpresa == 97 || sellerid == 2383221452) {

                      console.log("entramosssssssssss");

                    }


                    const paso = await verificarSiPaso(envioML, didEmpresa, sellerid);
                    if (paso) {


                      const orderid = envioML.order_id;

                      const orderData = await obtenerDatosOrderML(orderid, token);
                      //     console.log(orderData);

                      const packid = orderData.pack_id ?? ""; //fijarse si es null poner en vacio
                      const claveusada = `${sellerid}-${packid}-${orderid}-${shipmentid}`;

                      if (!AusadosFF.hasOwnProperty(claveusada)) {
                        let Aorders = [];
                        let AordersData = [];
                        if (packid != "") {

                          const datapack = await getPackData(packid, token);
                          const Aorderspack = datapack.orders;
                          Aorders = Aorderspack.map((order) => order.id);
                        } else {
                          Aorders.push(orderid);
                        }

                        //recorro Aorders y me traigo los datos de la venta
                        for (const orderId of Aorders) {


                          let orderPack = await obtenerDatosOrderML(
                            orderId,
                            token
                          );
                          AordersData.push(orderPack); // Agregar cada orden al array
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
                          AordersData,
                        };




                        const dataEnviar = {
                          operador: "enviosmlia",
                          data: await armadojsonff(income),
                        };




                        await enviarColaEnviosAltaFF(dataEnviar);


                        //  AusadosFF[claveusada] = 1;
                        return true;

                      }
                    }

                    //uso otro armado jsonff
                    //insrtas el envio
                  } else {


                    // didempresa=diazhome && logistic_type ==  "cross_docking"'
                    //const paso = await verificarSiPaso(envioML.logistic_type);
                    //if ( envioML && paso ){
                    //   console.log("hola");

                    const paso = await verificarSiPaso(envioML, didEmpresa, sellerid);
                    //   console.log("paso", paso);
                    //   console.log("hola");

                    if (paso) {
                      //   console.log("hola");


                      const orderid = envioML.order_id;
                      const orderData = await obtenerDatosOrderML(
                        orderid,
                        token
                      );


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
                          ia,
                        };

                        const dataEnviar = {
                          operador: "enviosmlia",
                          data: await armadojson(income),
                        };


                        await enviarColaEnviosAlta(dataEnviar);
                        await enviarColaLogsInfo(data, dataEnviar.data, envioML.logistic_type);
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
//
// Llamar a la función principal
main();

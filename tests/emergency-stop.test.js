const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const RAIZ_PROYECTO = path.resolve(__dirname, '..');
const ID_LINEA = '22222222-2222-4222-8222-222222222222';
const ID_LINEA_SIGUIENTE = '33333333-3333-4333-8333-333333333333';

function cargarBackendAislado(rutaDatos) {
    for (const carpeta of ['sesiones', 'programados', 'uploads', 'historial']) {
        const ruta = path.join(rutaDatos, carpeta);
        fs.mkdirSync(ruta, { recursive: true });
        fs.writeFileSync(path.join(ruta, '.prueba-interna'), '', 'utf8');
    }

    const archivo = path.join(RAIZ_PROYECTO, 'src', 'bot.js');
    const original = fs.readFileSync(archivo, 'utf8');
    const corte = original.indexOf('\napp.listen(');
    assert.ok(corte > 0, 'No se encontró el inicio del servidor');

    const nombreVariable = 'AUTOSTATUES_DATA_DIR';
    const valorAnterior = process.env[nombreVariable];
    process.env[nombreVariable] = rutaDatos;

    try {
        const fuente = original.slice(0, corte) + `
            module.exports = {
                ejecutarPublicacion,
                encolarPublicacion,
                solicitarAltoTotalPublicacion,
                registrarCorteDesconexion,
                solicitarEliminacionEstado,
                lineas,
                estadosActivos,
                obtenerProgreso: () => progresoPublicacion,
                establecerCola: valor => { colaPublicaciones = valor; },
                archivoEstadosActivos
            };
        `;
        const modulo = new Module(archivo, module);
        modulo.filename = archivo;
        modulo.paths = Module._nodeModulePaths(path.dirname(archivo));
        modulo._compile(fuente, archivo);
        return modulo.exports;
    } finally {
        if (valorAnterior === undefined) {
            delete process.env[nombreVariable];
        } else {
            process.env[nombreVariable] = valorAnterior;
        }
    }
}

function crearLinea(
    sendMessage,
    {
        id = ID_LINEA,
        nombre = 'Línea de prueba de Alto total',
        jidPropio = '595999999999@s.whatsapp.net',
        contacto = '595111111111@s.whatsapp.net'
    } = {}
) {
    const socket = {
        user: {
            id: jidPropio,
            phoneNumber: jidPropio
        },
        sendMessage
    };

    return {
        id,
        nombre,
        ordenConexion: 1,
        etiqueta: 'activa',
        estado: 'conectado',
        jid: jidPropio,
        socket,
        eliminando: false,
        iniciando: false,
        reconexionManualEnCurso: false,
        conexionEnVerificacion: false,
        reconexionBloqueada: false,
        requiereRevisionEnvio: false,
        fallosRecientes: 0,
        audienciaEstadosCargada: true,
        audienciaResincronizada: true,
        contactosEstado: new Set([contacto]),
        privacidadEstados: {
            modo: 2,
            usuarios: [],
            usuariosInvalidos: 0
        },
        promesaContactosEstado: Promise.resolve(),
        actividadContactosCargada: true,
        ultimaInteraccionContactos: new Map([[contacto, Date.now()]]),
        mapeosActividadContactos: new Map(),
        actividadContactosSucia: false,
        temporizadorActividadContactos: null,
        promesaActividadContactos: Promise.resolve(),
        tareasActividadPendientes: 0,
        fechaUltimaInteraccionContactos: Date.now(),
        ultimaSeleccionAudienciaEstado: null,
        revisionPriorizacionAudiencia: 0,
        cacheResumenPriorizacionAudiencia: null
    };
}

test('Alto total cancela la cola y conserva el ID del envío en curso', async () => {
    const rutaDatos = fs.mkdtempSync(
        path.join(os.tmpdir(), 'autostatues-alto-total-')
    );

    try {
        const backend = cargarBackendAislado(rutaDatos);
        let liberarCola;
        const bloqueoCola = new Promise(resolve => {
            liberarCola = resolve;
        });
        backend.establecerCola(bloqueoCola);
        const tareaEnCola = backend.encolarPublicacion({});
        const altoEnCola = backend.solicitarAltoTotalPublicacion();
        assert.equal(altoEnCola.activa, false);
        assert.equal(altoEnCola.pendientesCanceladas, 1);
        await assert.rejects(
            tareaEnCola,
            error => error?.codigo === 'CANCELADA_ALTO_TOTAL_EN_COLA'
        );
        liberarCola();
        await new Promise(resolve => setImmediate(resolve));

        let resolverEnvio;
        let avisarInicioEnvio;
        const envioIniciado = new Promise(resolve => {
            avisarInicioEnvio = resolve;
        });
        const promesaEnvio = new Promise(resolve => {
            resolverEnvio = resolve;
        });
        const linea = crearLinea(() => {
            avisarInicioEnvio();
            return promesaEnvio;
        });
        let enviosSegundaLinea = 0;
        const segundaLinea = crearLinea(
            () => {
                enviosSegundaLinea += 1;
                throw new Error('La segunda línea no debía comenzar.');
            },
            {
                id: ID_LINEA_SIGUIENTE,
                nombre: 'Línea que debe quedar sin iniciar',
                jidPropio: '595888888888@s.whatsapp.net',
                contacto: '595222222222@s.whatsapp.net'
            }
        );
        backend.lineas.set(linea.id, linea);
        backend.lineas.set(segundaLinea.id, segundaLinea);

        const rutaImagen = path.join(rutaDatos, 'imagen-prueba.png');
        fs.writeFileSync(
            rutaImagen,
            Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
                0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
            ])
        );

        const tarea = backend.ejecutarPublicacion({
            idsLineas: [linea.id, segundaLinea.id],
            rutaImagen,
            texto: 'Prueba interna',
            modoRitmo: 'secuencial',
            intervaloSegundos: 45,
            variacionSegundos: 0,
            lineasPorGrupo: 1,
            intervaloMinutos: 0,
            maximoDestinatariosPorEstado: 1000,
            origen: 'prueba interna'
        });

        await envioIniciado;
        const alto = backend.solicitarAltoTotalPublicacion();
        assert.equal(alto.habiaTrabajo, true);
        assert.equal(alto.activa, true);
        assert.equal(backend.obtenerProgreso().envioEnCurso, true);

        const resultadoTemprano = await Promise.race([
            tarea.then(
                () => 'resuelta',
                () => 'rechazada'
            ),
            new Promise(resolve => setTimeout(() => resolve('pendiente'), 30))
        ]);
        assert.equal(resultadoTemprano, 'pendiente');

        const idEstado = 'ID-ESTADO-ALTO-TOTAL';
        resolverEnvio({
            key: {
                remoteJid: 'status@broadcast',
                fromMe: true,
                id: idEstado
            },
            messageTimestamp: Math.floor(Date.now() / 1000)
        });

        await assert.rejects(
            tarea,
            error => error?.codigo === 'DETENIDA_ALTO_TOTAL'
        );

        assert.equal(backend.obtenerProgreso().estado, 'detenido_alto_total');
        assert.equal(backend.obtenerProgreso().correctas, 1);
        assert.equal(backend.obtenerProgreso().noProcesadas, 1);
        assert.equal(enviosSegundaLinea, 0);
        const grupos = [...backend.estadosActivos.values()];
        assert.equal(grupos.length, 1);
        assert.equal(grupos[0].lineas.length, 1);
        assert.equal(grupos[0].lineas[0].clave.id, idEstado);
        assert.equal(grupos[0].lineas[0].meta.id, idEstado);

        const guardados = JSON.parse(
            fs.readFileSync(backend.archivoEstadosActivos, 'utf8')
        );
        assert.equal(guardados[0].lineas[0].clave.id, idEstado);
        assert.equal(guardados[0].lineas[0].meta.id, idEstado);

        let idSolicitadoParaEliminar = null;
        linea.socket.sendMessage = async (jid, contenido, opciones) => {
            assert.equal(jid, 'status@broadcast');
            idSolicitadoParaEliminar = contenido?.delete?.id || null;
            assert.equal(opciones.broadcast, true);
            assert.ok(opciones.statusJidList.includes(linea.jid));

            return {
                key: {
                    remoteJid: 'status@broadcast',
                    fromMe: true,
                    id: 'ID-SOLICITUD-ELIMINACION'
                }
            };
        };

        await backend.solicitarEliminacionEstado(
            grupos[0],
            grupos[0].lineas[0]
        );
        assert.equal(idSolicitadoParaEliminar, idEstado);
        assert.equal(grupos[0].lineas[0].estado, 'solicitud_enviada');
    } finally {
        fs.rmSync(rutaDatos, { recursive: true, force: true });
    }
});

test('una desconexión simultánea conserva el ID devuelto por sendMessage', async () => {
    const rutaDatos = fs.mkdtempSync(
        path.join(os.tmpdir(), 'autostatues-desconexion-resultado-')
    );

    try {
        const backend = cargarBackendAislado(rutaDatos);
        let resolverEnvio;
        let avisarInicioEnvio;
        const envioIniciado = new Promise(resolve => {
            avisarInicioEnvio = resolve;
        });
        const promesaEnvio = new Promise(resolve => {
            resolverEnvio = resolve;
        });
        const linea = crearLinea(() => {
            avisarInicioEnvio();
            return promesaEnvio;
        });
        let enviosSegundaLinea = 0;
        const segundaLinea = crearLinea(
            () => {
                enviosSegundaLinea += 1;
                throw new Error('La segunda línea no debía comenzar.');
            },
            {
                id: ID_LINEA_SIGUIENTE,
                nombre: 'Línea posterior al corte',
                jidPropio: '595888888888@s.whatsapp.net',
                contacto: '595222222222@s.whatsapp.net'
            }
        );
        backend.lineas.set(linea.id, linea);
        backend.lineas.set(segundaLinea.id, segundaLinea);

        const rutaImagen = path.join(rutaDatos, 'imagen-desconexion.png');
        fs.writeFileSync(
            rutaImagen,
            Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
                0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
            ])
        );

        const tarea = backend.ejecutarPublicacion({
            idsLineas: [linea.id, segundaLinea.id],
            rutaImagen,
            texto: 'Confirmación simultánea',
            modoRitmo: 'secuencial',
            intervaloSegundos: 10,
            variacionSegundos: 0,
            lineasPorGrupo: 1,
            intervaloMinutos: 0,
            maximoDestinatariosPorEstado: 1000,
            origen: 'prueba interna'
        });

        await envioIniciado;
        backend.registrarCorteDesconexion(
            linea,
            'La sesión se cerró mientras se esperaba el resultado.',
            401
        );

        const resultadoTemprano = await Promise.race([
            tarea.then(
                () => 'resuelta',
                () => 'rechazada'
            ),
            new Promise(resolve => setTimeout(() => resolve('pendiente'), 30))
        ]);
        assert.equal(resultadoTemprano, 'pendiente');

        const idEstado = 'ID-ESTADO-DEVUELTO-ANTES-DEL-CORTE';
        resolverEnvio({
            key: {
                remoteJid: 'status@broadcast',
                fromMe: true,
                id: idEstado
            },
            messageTimestamp: Math.floor(Date.now() / 1000)
        });

        await assert.rejects(
            tarea,
            error => error?.codigo === 'DETENIDA_DESCONEXION'
        );

        assert.equal(backend.obtenerProgreso().estado, 'detenido_desconexion');
        assert.equal(backend.obtenerProgreso().correctas, 1);
        assert.equal(enviosSegundaLinea, 0);
        const grupos = [...backend.estadosActivos.values()];
        assert.equal(grupos.length, 1);
        assert.equal(grupos[0].lineas[0].clave.id, idEstado);
    } finally {
        fs.rmSync(rutaDatos, { recursive: true, force: true });
    }
});

test('una línea en reconexión espera y publica al recuperar el socket', async () => {
    const rutaDatos = fs.mkdtempSync(
        path.join(os.tmpdir(), 'autostatues-recuperacion-linea-')
    );

    try {
        const backend = cargarBackendAislado(rutaDatos);
        let cantidadEnvios = 0;
        const idEstado = 'ID-ESTADO-DESPUES-DE-RECUPERAR';
        const linea = crearLinea(async () => {
            cantidadEnvios += 1;
            return {
                key: {
                    remoteJid: 'status@broadcast',
                    fromMe: true,
                    id: idEstado
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };
        });
        const socketRecuperado = linea.socket;
        linea.socket = null;
        linea.jid = null;
        linea.estado = 'reconectando';
        linea.etiqueta = 'caida';
        linea.iniciando = true;
        backend.lineas.set(linea.id, linea);

        const rutaImagen = path.join(rutaDatos, 'imagen-recuperacion.png');
        fs.writeFileSync(
            rutaImagen,
            Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
                0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
            ])
        );

        const tarea = backend.ejecutarPublicacion({
            idsLineas: [linea.id],
            rutaImagen,
            texto: 'Publicación tras recuperar',
            modoRitmo: 'secuencial',
            intervaloSegundos: 10,
            variacionSegundos: 0,
            lineasPorGrupo: 1,
            intervaloMinutos: 0,
            maximoDestinatariosPorEstado: 1000,
            origen: 'prueba interna'
        });

        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(cantidadEnvios, 0);
        assert.equal(backend.obtenerProgreso().estado, 'esperando_reconexion');

        linea.socket = socketRecuperado;
        linea.jid = socketRecuperado.user.id;
        linea.estado = 'conectado';
        linea.etiqueta = 'activa';
        linea.iniciando = false;
        linea.conexionEnVerificacion = false;

        const resultado = await tarea;
        assert.deepEqual(resultado, { correctas: 1, fallidas: 0 });
        assert.equal(cantidadEnvios, 1);
        assert.equal(backend.obtenerProgreso().estado, 'completado');
        const grupos = [...backend.estadosActivos.values()];
        assert.equal(grupos[0].lineas[0].clave.id, idEstado);
    } finally {
        fs.rmSync(rutaDatos, { recursive: true, force: true });
    }
});

test('repite la preparación si el socket cambia antes de sendMessage', async () => {
    const rutaDatos = fs.mkdtempSync(
        path.join(os.tmpdir(), 'autostatues-reintento-preparacion-')
    );

    try {
        const backend = cargarBackendAislado(rutaDatos);
        const contactoLid = '595111111111@lid';
        const contactoNumero = '595111111111@s.whatsapp.net';
        let cantidadEnvios = 0;
        let cambioIniciado = false;
        let linea;

        linea = crearLinea(
            async () => {
                cantidadEnvios += 1;
                return {
                    key: {
                        remoteJid: 'status@broadcast',
                        fromMe: true,
                        id: 'ID-ESTADO-TRAS-REPETIR-PREPARACION'
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                };
            },
            { contacto: contactoLid }
        );

        const socketInicial = linea.socket;
        const socketRecuperado = {
            ...socketInicial,
            signalRepository: {
                lidMapping: {
                    getPNForLID: async () => contactoNumero
                }
            }
        };
        socketInicial.signalRepository = {
            lidMapping: {
                getPNForLID: async () => {
                    if (!cambioIniciado) {
                        cambioIniciado = true;
                        linea.socket = null;
                        linea.jid = null;
                        linea.estado = 'reconectando';
                        linea.etiqueta = 'caida';
                        linea.iniciando = true;

                        setTimeout(() => {
                            linea.socket = socketRecuperado;
                            linea.jid = socketRecuperado.user.id;
                            linea.estado = 'conectado';
                            linea.etiqueta = 'activa';
                            linea.iniciando = false;
                            linea.conexionEnVerificacion = false;
                        }, 25);
                    }

                    await new Promise(resolve => setTimeout(resolve, 5));
                    return contactoNumero;
                }
            }
        };
        backend.lineas.set(linea.id, linea);

        const rutaImagen = path.join(rutaDatos, 'imagen-reintento.png');
        fs.writeFileSync(
            rutaImagen,
            Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
                0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
            ])
        );

        const resultado = await backend.ejecutarPublicacion({
            idsLineas: [linea.id],
            rutaImagen,
            texto: 'Reintento seguro de preparación',
            modoRitmo: 'secuencial',
            intervaloSegundos: 10,
            variacionSegundos: 0,
            lineasPorGrupo: 1,
            intervaloMinutos: 0,
            maximoDestinatariosPorEstado: 1000,
            origen: 'prueba interna'
        });

        assert.equal(cambioIniciado, true);
        assert.deepEqual(resultado, { correctas: 1, fallidas: 0 });
        assert.equal(cantidadEnvios, 1);
        assert.equal(backend.obtenerProgreso().procesadas, 1);
    } finally {
        fs.rmSync(rutaDatos, { recursive: true, force: true });
    }
});

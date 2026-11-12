# Instalar DataDB (macOS, Apple Silicon)

El `.dmg` no está firmado ni notarizado con una cuenta de Apple, así que macOS lo marcará como
«app de un desarrollador no identificado». Es normal: la app se firma *ad-hoc* y el código es el de
este repositorio.

## Instalación normal

1. Descarga el `.dmg` más reciente de
   [Releases](https://github.com/bit-armando/datadb/releases/latest).
2. Ábrelo y arrastra **DataDB** a **Aplicaciones**.
3. La primera vez, **no hagas doble clic**: clic derecho sobre DataDB ▸ **Abrir** ▸ **Abrir**.
   Con eso macOS recuerda la excepción y las siguientes veces ya abre con doble clic.

En versiones recientes de macOS puede que tengas que ir a **Ajustes del Sistema ▸ Privacidad y
seguridad** y pulsar **Abrir de todos modos** después del primer intento.

## Si macOS dice «está dañada» o no deja abrirla

Es el atributo de cuarentena que se pone al descargar un archivo de internet. Se quita con:

```bash
xattr -dr com.apple.quarantine /Applications/DataDB.app
```

Y después abres la app normalmente.

## Actualizar

Descarga el `.dmg` nuevo y reemplaza la app en **Aplicaciones**. Tus conexiones y preferencias se
conservan (viven fuera de la app).

## Qué necesita

- **macOS 12 o superior, Apple Silicon (arm64).** No hay build para Intel.
- Nada más: Electron y las librerías van dentro del `.dmg`. No hace falta Node ni Homebrew.
- Para conectarte a una base **no hace falta abrirla a internet**: DataDB habla con el host y puerto
  que le digas, igual que `psql` o DataGrip (y también a través de un túnel SSH).

## Dónde guarda tus datos

- Conexiones: `~/Library/Application Support/DataDB/connections.json`
  (sin contraseñas: solo dice si hay una guardada).
- Contraseñas y clave de IA: cifradas con el Llavero de macOS (`safeStorage`), en `secrets.json` con
  permisos `0600`. Si cambias de Mac, las contraseñas **no viajan**: hay que volver a escribirlas.
- Historial, consolas guardadas y preferencias de tema: en el mismo directorio.

## Limitaciones conocidas

- SQL Server funciona, pero está menos probado contra servidores reales que PostgreSQL y MySQL.
- No hay firma notarizada, así que la primera apertura es la del clic derecho.

Si algo falla, el log de la app sale por la consola si la abres desde terminal:

```bash
/Applications/DataDB.app/Contents/MacOS/DataDB
```

y puedes reportarlo en [Issues](https://github.com/bit-armando/datadb/issues).

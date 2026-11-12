# Contribuir a DataDB

¡Gracias por querer mejorar DataDB! Cualquier aporte suma: reportes de bugs, ideas, documentación o
código.

## Reportar un bug o pedir una feature

Abre un [issue](https://github.com/bit-armando/datadb/issues) con:

- Qué hiciste, qué esperabas y qué pasó (capturas ayudan mucho).
- Motor y versión de la base (PostgreSQL 16, MySQL 8.4, SQL Server 2022, MongoDB 7…).
- Versión de DataDB y de macOS.

**No pegues contraseñas, hosts privados ni datos reales** en los issues.

## Flujo para un PR

1. Haz fork y crea una rama desde `main`: `git checkout -b feat/mi-feature`.
2. `npm install` y `npm run dev` para trabajar con la app abierta.
3. Si tu cambio tiene lógica, agrega o ajusta tests junto al código (`*.test.ts`).
4. Antes de abrir el PR, que pase todo:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```

5. Abre el PR describiendo **qué cambia, por qué y cómo lo probaste**. Si toca la interfaz, agrega
   una captura.

Commits al estilo [Conventional Commits](https://www.conventionalcommits.org/es/) (`feat:`, `fix:`,
`docs:`, `refactor:`…), con el alcance entre paréntesis cuando ayude: `fix(rejilla): …`.

## Reglas del proyecto

- **Ninguna credencial en texto plano**: ni en disco, ni en logs, ni en lo que se manda a la IA. Las
  contraseñas solo pasan por `electron/secrets.ts` (cifradas con `safeStorage`).
- **El SQL generado por IA nunca se ejecuta sin confirmación explícita** del usuario. Hay un test que
  lo vigila (`src/lib/ai-never-executes.test.ts`).
- **`main` no toca bases de datos**: todo acceso va por el `db-worker` a través del broker IPC, con
  canales en lista blanca.
- Para probar contra bases reales usa un directorio de datos aislado
  (`DATADB_DATA_DIR=/ruta/absoluta npm run dev`) y bases desechables (por ejemplo, contenedores
  Docker), nunca producción.
- El código y los comentarios están en español; mantén el estilo de los archivos vecinos.

## Publicar una versión (mantenedores)

1. Sube la versión en `package.json`.
2. `npm run dist` genera `release/DataDB-<versión>-arm64.dmg`.
3. Crea el release en GitHub con el `.dmg` adjunto:

   ```bash
   gh release create v<versión> release/DataDB-<versión>-arm64.dmg --title "DataDB <versión>" --notes "…"
   ```

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la [licencia MIT](LICENSE) del proyecto.

# Sincronización de Mi Cole con Notion

La app estática de GitHub Pages guarda sus tareas en el navegador. Este Worker actúa como puente privado entre la app y la base **Mi Cole — Tareas sincronizadas** de Notion. No guarda tareas en GitHub ni incluye claves en el código público.

## Requisitos

- Una cuenta de Cloudflare para publicar un Worker.
- Una integración interna de Notion con acceso a la base de tareas.
- Node.js y npm para usar Wrangler.

## 1. Preparar la integración de Notion

1. Crea una integración interna en la configuración de integraciones de Notion y copia su token. No lo pegues en GitHub ni en un chat.
2. Comparte la base **Mi Cole — Tareas sincronizadas** con esa integración. Está dentro de la página **Prioridades actuales — agenda escolar y otros frentes**.
3. Conserva el token para guardarlo como secreto del Worker en el paso de despliegue.

La base tiene las columnas Name, Mi Cole ID, Día, Materia, Fecha de entrega, Nota, Prioridad, Completada y Eliminada.

## 2. Publicar el Worker

Desde la raíz del repositorio:

```powershell
npx wrangler login
npx wrangler secret put NOTION_TOKEN --config worker/wrangler.toml
npx wrangler secret put SYNC_TOKEN --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Wrangler te pedirá cada valor de forma interactiva. Para NOTION_TOKEN usa el secreto de la integración de Notion. Para SYNC_TOKEN genera una clave aleatoria larga, por ejemplo en PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Guarda SYNC_TOKEN en un gestor de contraseñas: lo vas a introducir en la app del celular y en cualquier otro navegador que quieras sincronizar. No lo subas al repositorio. El archivo wrangler.toml contiene únicamente el ID de la base de datos y el origen público permitido.

Al finalizar, Wrangler mostrará la URL del Worker, normalmente similar a `https://mi-cole-notion-sync.<tu-cuenta>.workers.dev`.

## 3. Conectar la app

En Mi Cole, abre **Configuración → Sincronización con Notion**:

1. Ingresa la URL del Worker.
2. Ingresa el mismo SYNC_TOKEN configurado en Cloudflare.
3. Pulsa **Guardar conexión** y luego **Sincronizar ahora**.

Hazlo en el celular y en cada navegador que deba compartir las tareas. Una vez configurada, la app sincroniza los cambios al guardar, sincroniza al abrir y vuelve a comprobar cada minuto mientras la página está visible. Si un navegador estuvo sin conexión, pulsa **Sincronizar ahora** cuando vuelva a estar conectado.

## Comportamiento

- Las tareas se guardan en Notion y se descargan a los dispositivos conectados.
- Cuando hay cambios concurrentes, gana el registro editado más recientemente según la hora de última edición de Notion y la marca local de la app.
- Eliminar una tarea se sincroniza como eliminación lógica mediante la columna **Eliminada**; la fila no se borra definitivamente.
- La app mantiene su almacenamiento local y la exportación/importación JSON.
- Las tareas y fechas escolares no se publican en GitHub Pages. La sincronización necesita el Worker desplegado y los secretos configurados.

La app no puede conectarse hasta completar los pasos de Notion y Cloudflare. El código del Worker y esta guía dejan esa configuración preparada, pero no despliegan el servicio por sí solos.

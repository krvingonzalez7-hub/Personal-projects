const API_VERSION = "2026-03-11";
const MAX_TASKS = 200;

function response(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "vary": "Origin"
    }
  });
}

function jsonError(message, status, origin) {
  return response({ error: message }, status, origin);
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(left)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(right)));
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function readText(property) {
  const value = property && (property.title || property.rich_text);
  return Array.isArray(value) ? value.map(function (part) { return part.plain_text || ""; }).join("") : "";
}

function pageToTask(page) {
  const p = page.properties || {};
  const priority = p.Prioridad && p.Prioridad.select ? p.Prioridad.select.name : "Normal";
  const id = readText(p["Mi Cole ID"]) || "notion-" + page.id;
  return {
    id: id,
    day: readText(p["Día"]),
    subject: readText(p.Materia),
    name: readText(p.Name),
    date: p["Fecha de entrega"] && p["Fecha de entrega"].date ? p["Fecha de entrega"].date.start : "",
    note: readText(p.Nota),
    priority: priority,
    done: Boolean(p.Completada && p.Completada.checkbox),
    deleted: Boolean(p.Eliminada && p.Eliminada.checkbox),
    createdAt: page.created_time || "",
    updatedAt: page.last_edited_time || "",
    notionPageId: page.id
  };
}

function textValue(value) {
  return [{ text: { content: String(value || "").slice(0, 2000) } }];
}

function taskProperties(task, deleted) {
  const priority = ["Alta", "Normal", "Baja"].indexOf(task.priority) >= 0 ? task.priority : "Normal";
  const props = {
    "Name": { title: textValue(task.name) },
    "Mi Cole ID": { rich_text: textValue(task.id) },
    "Día": { rich_text: textValue(task.day) },
    "Materia": { rich_text: textValue(task.subject) },
    "Fecha de entrega": { date: task.date ? { start: task.date } : null },
    "Nota": { rich_text: textValue(task.note) },
    "Prioridad": { select: { name: priority } },
    "Completada": { checkbox: Boolean(task.done) },
    "Eliminada": { checkbox: Boolean(deleted) }
  };
  return props;
}

async function notionRequest(env, path, method, body) {
  const result = await fetch("https://api.notion.com/v1/" + path, {
    method: method,
    headers: {
      "authorization": "Bearer " + env.NOTION_TOKEN,
      "notion-version": API_VERSION,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await result.json().catch(function () { return {}; });
  if (!result.ok) {
    const error = new Error("Notion API request failed with status " + result.status);
    error.status = result.status;
    throw error;
  }
  return data;
}

async function listAllTasks(env) {
  let cursor = undefined;
  let pages = [];
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await notionRequest(env, "data_sources/" + env.NOTION_DATA_SOURCE_ID + "/query", "POST", body);
    pages = pages.concat(result.results || []);
    cursor = result.has_more ? result.next_cursor : undefined;
    if (pages.length > 2000) throw new Error("Notion database exceeds the 2000-row safety limit.");
  } while (cursor);
  return pages;
}

function isSameTask(left, right) {
  return left.name === right.name &&
    left.day === right.day &&
    left.subject === right.subject &&
    left.date === right.date &&
    left.note === right.note &&
    left.priority === right.priority &&
    left.done === right.done;
}

async function saveTask(env, task, page) {
  const properties = taskProperties(task, false);
  if (page) {
    return notionRequest(env, "pages/" + page.id, "PATCH", { properties: properties });
  }
  return notionRequest(env, "pages", "POST", {
    parent: { data_source_id: env.NOTION_DATA_SOURCE_ID },
    properties: properties
  });
}

async function softDelete(env, page) {
  return notionRequest(env, "pages/" + page.id, "PATCH", {
    properties: { "Eliminada": { checkbox: true } }
  });
}

async function handleSync(request, env, origin) {
  const body = await request.json().catch(function () { return null; });
  if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.deletedIds)) {
    return jsonError("Se esperaba tasks y deletedIds como listas.", 400, origin);
  }
  if (body.tasks.length > MAX_TASKS || body.deletedIds.length > MAX_TASKS) {
    return jsonError("La sincronización acepta hasta " + MAX_TASKS + " elementos por envío.", 413, origin);
  }

  const pages = await listAllTasks(env);
  const byId = new Map();
  pages.forEach(function (page) {
    const task = pageToTask(page);
    if (task.id && task.notionPageId) byId.set(task.id, { page: page, task: task });
  });

  const deleted = new Set(body.deletedIds.map(String));
  for (const id of deleted) {
    const found = byId.get(id);
    if (found && !found.task.deleted) {
      const page = await softDelete(env, found.page);
      found.page = page;
      found.task = pageToTask(page);
    }
  }

  const resultById = new Map();
  const incomingIds = new Set();
  for (const incoming of body.tasks) {
    if (!incoming || !incoming.id || !incoming.name || !incoming.subject || !incoming.date) continue;
    const id = String(incoming.id).slice(0, 200);
    incomingIds.add(id);
    const local = {
      id: id,
      day: String(incoming.day || ""),
      subject: String(incoming.subject),
      name: String(incoming.name),
      date: String(incoming.date),
      note: String(incoming.note || ""),
      priority: String(incoming.priority || "Normal"),
      done: Boolean(incoming.done),
      createdAt: String(incoming.createdAt || ""),
      updatedAt: String(incoming.updatedAt || incoming.createdAt || "")
    };

    const found = byId.get(id);
    if (found && found.task.deleted) continue;
    if (!found) {
      const created = await saveTask(env, local, null);
      resultById.set(id, pageToTask(created));
      continue;
    }

    const remote = found.task;
    const remoteTime = Date.parse(remote.updatedAt || remote.createdAt || "") || 0;
    const localTime = Date.parse(local.updatedAt || local.createdAt || "") || 0;
    if (remoteTime >= localTime) {
      resultById.set(id, remote);
      continue;
    }

    if (isSameTask(local, remote)) {
      resultById.set(id, remote);
      continue;
    }

    const updated = await saveTask(env, local, found.page);
    resultById.set(id, pageToTask(updated));
  }

  pages.forEach(function (page) {
    const task = pageToTask(page);
    if (task.deleted || deleted.has(task.id) || resultById.has(task.id)) return;
    if (!incomingIds.has(task.id)) resultById.set(task.id, task);
  });

  return response({
    tasks: Array.from(resultById.values()).filter(function (task) { return !task.deleted; }),
    syncedAt: new Date().toISOString()
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";
    if (!allowedOrigin || origin !== allowedOrigin) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": allowedOrigin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return response({ ok: true }, 200, allowedOrigin);
    }

    const supplied = request.headers.get("Authorization") || "";
    const token = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
    if (!env.SYNC_TOKEN || !token || !(await constantTimeEqual(token, env.SYNC_TOKEN))) {
      return jsonError("No autorizado.", 401, allowedOrigin);
    }

    if (url.pathname === "/tasks" && request.method === "GET") {
      try {
        const pages = await listAllTasks(env);
        return response({
          tasks: pages.map(pageToTask).filter(function (task) { return !task.deleted; })
        }, 200, allowedOrigin);
      } catch (error) {
        return jsonError("No se pudo leer la base de Notion.", 502, allowedOrigin);
      }
    }

    if (url.pathname === "/sync" && request.method === "POST") {
      try {
        return await handleSync(request, env, allowedOrigin);
      } catch (error) {
        return jsonError("No se pudo completar la sincronización con Notion.", 502, allowedOrigin);
      }
    }

    return jsonError("Ruta no encontrada.", 404, allowedOrigin);
  }
};

import { google } from 'googleapis';

/**
 * Creates a Google Tasks API client from an authenticated OAuth2 client.
 * Cached per auth object to avoid recreating on every call.
 */
const serviceCache = new WeakMap();
function getService(auth) {
  let service = serviceCache.get(auth);
  if (!service) {
    service = google.tasks({ version: 'v1', auth });
    serviceCache.set(auth, service);
  }
  return service;
}

// --- Task Lists ---

export async function getTaskLists(auth) {
  const service = getService(auth);
  const items = [];
  let pageToken;

  do {
    const res = await service.tasklists.list({ maxResults: 100, pageToken });
    if (res.data.items) items.push(...res.data.items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}

export async function createTaskList(auth, title) {
  const service = getService(auth);
  const res = await service.tasklists.insert({ requestBody: { title } });
  return res.data;
}

export async function updateTaskList(auth, taskListId, title) {
  const service = getService(auth);
  const res = await service.tasklists.update({
    tasklist: taskListId,
    requestBody: { title },
  });
  return res.data;
}

export async function deleteTaskList(auth, taskListId) {
  const service = getService(auth);
  await service.tasklists.delete({ tasklist: taskListId });
}

// --- Tasks ---

export async function getTasks(auth, taskListId) {
  const service = getService(auth);
  const items = [];
  let pageToken;

  do {
    const res = await service.tasks.list({
      tasklist: taskListId,
      maxResults: 100,
      showCompleted: true,
      showHidden: true,
      pageToken,
    });
    if (res.data.items) items.push(...res.data.items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}

export async function createTask(auth, taskListId, { title, status, due, parent, notes }) {
  const service = getService(auth);
  const requestBody = { title, status: status || 'needsAction' };
  if (due) requestBody.due = due;
  if (notes) requestBody.notes = notes;

  const params = { tasklist: taskListId, requestBody };
  if (parent) params.parent = parent;

  const res = await service.tasks.insert(params);
  return res.data;
}

export async function updateTask(auth, taskListId, taskId, { title, status, due, notes }) {
  const service = getService(auth);
  const requestBody = { id: taskId };
  if (title !== undefined) requestBody.title = title;
  if (status !== undefined) requestBody.status = status;
  if (due !== undefined) requestBody.due = due;
  if (notes !== undefined) requestBody.notes = notes;

  const res = await service.tasks.update({
    tasklist: taskListId,
    task: taskId,
    requestBody,
  });
  return res.data;
}

export async function deleteTask(auth, taskListId, taskId) {
  const service = getService(auth);
  await service.tasks.delete({ tasklist: taskListId, task: taskId });
}

export async function clearCompleted(auth, taskListId) {
  const service = getService(auth);
  await service.tasks.clear({ tasklist: taskListId });
}

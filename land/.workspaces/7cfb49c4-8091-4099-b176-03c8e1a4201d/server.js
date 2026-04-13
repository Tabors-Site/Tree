import http from 'http';
import { parse } from 'url';
import { Todo } from './lib/todo.js';
import { loadFromStorage, saveToStorage } from './lib/storage.js';

// Initialize Todo instance with saved data
const todo = new Todo();
const savedData = loadFromStorage();
if (savedData) {
  todo.fromJSON(savedData);
}

// Save on exit
process.on('SIGINT', () => {
  saveToStorage(todo.toJSON());
  process.exit(0);
});
const PORT = process.env.PORT || 3000;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleRequest(req, res) {
  const url = parse(req.url, true);
  const pathname = url.pathname;
  const method = req.method;

  // GET /tasks - list all
  if (method === 'GET' && pathname === '/tasks') {
    sendJSON(res, 200, todo.getAll());
    return;
  }

  // POST /tasks - create
  if (method === 'POST' && pathname === '/tasks') {
    parseBody(req).then(body => {
      const { title, description } = body;
      if (!title) {
        sendJSON(res, 400, { error: 'title is required' });
        return;
      }
      const id = todo.add(title, description || '');
      saveToStorage(todo.toJSON());
      sendJSON(res, 201, { id, title, description, completed: false });
    }).catch(() => {
      sendJSON(res, 400, { error: 'invalid JSON body' });
    });
    return;
  }

  // PUT /tasks/:id - toggle completion
  if (method === 'PUT') {
    const match = pathname.match(/^\/tasks\/(\d+)$/);
    if (match) {
      const id = parseInt(match[1], 10);
      const task = todo.toggle(id);
      if (!task) {
        sendJSON(res, 404, { error: 'task not found' });
        return;
      }
      saveToStorage(todo.toJSON());
      sendJSON(res, 200, task);
    } else {
      sendJSON(res, 404, { error: 'not found' });
    }
    return;
  }

  // DELETE /tasks/:id - remove
  if (method === 'DELETE') {
    const match = pathname.match(/^\/tasks\/(\d+)$/);
    if (match) {
      const id = parseInt(match[1], 10);
      if (!todo.remove(id)) {
        sendJSON(res, 404, { error: 'task not found' });
        return;
      }
      saveToStorage(todo.toJSON());
      sendJSON(res, 204, {});
      return;
    }
    sendJSON(res, 404, { error: 'not found' });
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Todo API server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET    /tasks        - list all tasks');
  console.log('  POST   /tasks        - create a task');
  console.log('  PUT    /tasks/:id    - toggle task completion');
  console.log('  DELETE /tasks/:id    - remove a task');
});

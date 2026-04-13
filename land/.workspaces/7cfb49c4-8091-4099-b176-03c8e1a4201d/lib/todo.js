class Todo {
  constructor() {
    this.tasks = new Map();
    this.nextId = 1;
  }

  add(title, description = '') {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      title,
      description,
      completed: false
    });
    return id;
  }

  remove(id) {
    return this.tasks.delete(id);
  }

  toggle(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.completed = !task.completed;
      return task;
    }
    return null;
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  getAll() {
    return Array.from(this.tasks.values());
  }

  toJSON() {
    return {
      tasks: this.getAll(),
      nextId: this.nextId
    };
  }

  fromJSON(data) {
    if (!data || !Array.isArray(data.tasks)) return;
    this.tasks = new Map();
    for (const task of data.tasks) {
      this.tasks.set(task.id, task);
    }
    if (data.nextId) {
      this.nextId = data.nextId;
    }
  }
}

export { Todo };

import { describe, it, expect, beforeEach } from 'vitest';
import { Todo } from '../lib/todo.js';

describe('Todo class', () => {
  let todo;

  beforeEach(() => {
    todo = new Todo();
  });

  it('adds a task and returns an id', () => {
    const id = todo.add('Buy milk');
    expect(id).toBe(1);
  });

  it('adds multiple tasks with incrementing ids', () => {
    const id1 = todo.add('Task 1');
    const id2 = todo.add('Task 2');
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('adds a task with description', () => {
    const id = todo.add('Call mom', 'Discuss dinner plans');
    const task = todo.get(id);
    expect(task.title).toBe('Call mom');
    expect(task.description).toBe('Discuss dinner plans');
    expect(task.completed).toBe(false);
  });

  it('returns null for non-existent task', () => {
    expect(todo.get(999)).toBeNull();
  });

  it('gets all tasks', () => {
    todo.add('Task 1');
    todo.add('Task 2');
    expect(todo.getAll().length).toBe(2);
  });

  it('removes a task', () => {
    const id = todo.add('Task to remove');
    expect(todo.remove(id)).toBe(true);
    expect(todo.get(id)).toBeNull();
  });

  it('removing non-existent task returns false', () => {
    expect(todo.remove(999)).toBe(false);
  });

  it('toggles task completion', () => {
    const id = todo.add('Task to toggle');
    const task = todo.toggle(id);
    expect(task.completed).toBe(true);
  });

  it('toggles back to incomplete', () => {
    const id = todo.add('Task to toggle');
    todo.toggle(id);
    const task = todo.toggle(id);
    expect(task.completed).toBe(false);
  });

  it('toggling non-existent task returns null', () => {
    expect(todo.toggle(999)).toBeNull();
  });

  it('serializes to JSON', () => {
    todo.add('Task 1');
    todo.toggle(todo.nextId - 1);
    const json = todo.toJSON();
    expect(json.tasks.length).toBe(1);
    expect(json.tasks[0].completed).toBe(true);
    expect(json.nextId).toBe(2);
  });

  it('restores from JSON', () => {
    const data = {
      tasks: [
        { id: 1, title: 'Task 1', description: 'desc', completed: true },
        { id: 5, title: 'Task 2', description: '', completed: false }
      ],
      nextId: 6
    };
    todo.fromJSON(data);
    expect(todo.get(1)).toBeDefined();
    expect(todo.get(1).completed).toBe(true);
    expect(todo.nextId).toBe(6);
  });
});

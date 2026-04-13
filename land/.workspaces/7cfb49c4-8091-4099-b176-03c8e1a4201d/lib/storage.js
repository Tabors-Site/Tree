import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'todo-data.json');

export function loadFromStorage() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load from storage:', e.message);
  }
  return null;
}

export function saveToStorage(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Failed to save to storage:', e.message);
    return false;
  }
}

export function clearStorage() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      fs.unlinkSync(DATA_FILE);
      return true;
    }
    return true;
  } catch (e) {
    console.error('Failed to clear storage:', e.message);
    return false;
  }
}

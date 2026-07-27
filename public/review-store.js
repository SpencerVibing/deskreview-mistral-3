const databaseName = 'deskreview-mistral-3';
const storeName = 'reviews';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function saveReview(review) { return withStore('readwrite', (store) => store.put(review)); }
export function loadReview(id) { return withStore('readonly', (store) => store.get(id)); }
export function removeReview(id) { return withStore('readwrite', (store) => store.delete(id)); }
export async function listReviews() {
  const reviews = await withStore('readonly', (store) => store.getAll());
  return reviews.sort((first, second) => String(second.savedAt || '').localeCompare(String(first.savedAt || '')));
}

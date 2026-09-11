const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
const DB_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const APP_ID = import.meta.env.VITE_FIREBASE_APP_ID;

export const isChatConfigured = Boolean(API_KEY && DB_URL);

export const CHAT_TTL_MS = 20 * 60 * 1000;
export const MAX_KEPT = 100;
export const NAME_MAX = 24;
export const TEXT_MAX = 240;

let dbPromise = null;

async function database() {
  if (!dbPromise) {
    dbPromise = Promise.all([import("firebase/app"), import("firebase/database")]).then(([app, database]) => {
      const firebaseApp = app.initializeApp({
        apiKey: API_KEY,
        databaseURL: DB_URL,
        appId: APP_ID || undefined,
      });
      return database.getDatabase(firebaseApp);
    });
  }
  return dbPromise;
}

export async function subscribeChat(onMessages, onError) {
  const dbApi = await import("firebase/database");
  const db = await database();
  const messagesRef = dbApi.ref(db, "messages");
  const q = dbApi.query(messagesRef, dbApi.orderByChild("ts"), dbApi.limitToLast(MAX_KEPT));
  return dbApi.onValue(
    q,
    (snap) => {
      const cutoff = Date.now() - CHAT_TTL_MS;
      const list = [];
      snap.forEach((child) => {
        const m = child.val();
        if (m && typeof m.text === "string" && typeof m.ts === "number" && m.ts >= cutoff) {
          list.push({ key: child.key, name: m.name || "anons", text: m.text, ts: m.ts });
        }
      });
      onMessages(list);
    },
    (err) => onError?.(err)
  );
}

export async function sendChat(name, text) {
  const dbApi = await import("firebase/database");
  const db = await database();
  await dbApi.push(dbApi.ref(db, "messages"), {
    name: name.trim().slice(0, NAME_MAX) || "anons",
    text: text.trim().slice(0, TEXT_MAX),
    ts: dbApi.serverTimestamp(),
  });
}

export async function pruneChat() {
  const dbApi = await import("firebase/database");
  const db = await database();
  const q = dbApi.query(
    dbApi.ref(db, "messages"),
    dbApi.orderByChild("ts"),
    dbApi.endAt(Date.now() - CHAT_TTL_MS - 60_000)
  );
  const snap = await dbApi.get(q);
  const removals = [];
  snap.forEach((child) => removals.push(dbApi.remove(child.ref)));
  await Promise.all(removals);
}

export const fetchName = () => localStorage.getItem("racks.chat.name") || "";
export const saveName = (name) => localStorage.setItem("racks.chat.name", name);

function timeLabel(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function chatTime(ts) {
  const age = Date.now() - ts;
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  return timeLabel(ts);
}
import admin from "firebase-admin";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  // Ожидает переменную окружения GOOGLE_APPLICATION_CREDENTIALS
  // либо FIREBASE_SERVICE_ACCOUNT_JSON с содержимым service account JSON.
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  initialized = true;
}

export async function verifyFirebaseToken(token: string): Promise<{ uid: string }> {
  ensureInit();
  const decoded = await admin.auth().verifyIdToken(token);
  return { uid: decoded.uid };
}

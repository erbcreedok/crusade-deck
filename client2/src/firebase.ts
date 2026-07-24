import { initializeApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";

// Заполни своими ключами из консоли Firebase (Project settings → General → Your apps)
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// Пока ключи не подставлены — не инициализируем Firebase вообще.
// useAuth.ts в этом случае переключается на локальный dev-режим гостевого входа.
export const isFirebaseConfigured = firebaseConfig.apiKey !== "REPLACE_ME";

const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth: Auth | null = isFirebaseConfigured ? getAuth(firebaseApp!) : null;

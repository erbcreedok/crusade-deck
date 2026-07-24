import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { auth, isFirebaseConfigured } from "./firebase";
import { useAccount } from "./account";

interface AccountUser {
  uid: string;
  name: string;
  recoveryHash: string;
  isAnonymous: true;
  getIdToken: () => Promise<undefined>;
}

// Свои аккаунты (без Firebase): сервер выдаёт accountId + recoveryHash,
// клиент хранит их локально. Совпадает с CardRoom.onAuth на сервере, который
// принимает accountId напрямую. См. [[feedback-no-firebase-for-local-dev]].
function useAccountAuth() {
  const { account, loading, createNew, restore, rename, regenerateCode, logout, recentAccounts, forgetAccount } =
    useAccount();

  const user: AccountUser | null = account
    ? {
        uid: account.id,
        name: account.name,
        recoveryHash: account.recoveryHash,
        isAnonymous: true,
        getIdToken: async () => undefined,
      }
    : null;

  return {
    user,
    loading,
    account,
    createAccount: createNew,
    restoreAccount: restore,
    renameAccount: rename,
    regenerateCode,
    signInGuest: () => createNew(),
    signInEmail: async () => {
      throw new Error("Email/password вход недоступен без настроенного Firebase (client/src/firebase.ts)");
    },
    signUpEmail: async () => {
      throw new Error("Регистрация недоступна без настроенного Firebase (client/src/firebase.ts)");
    },
    logout,
    recentAccounts,
    forgetAccount,
  };
}

function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth!, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return {
    user,
    loading,
    account: null as null,
    createAccount: async (_name?: string) => undefined,
    restoreAccount: async (_recoveryHash: string) => undefined,
    renameAccount: async (_name: string) => undefined,
    regenerateCode: async () => undefined,
    signInGuest: () => signInAnonymously(auth!),
    signInEmail: (email: string, password: string) => signInWithEmailAndPassword(auth!, email, password),
    signUpEmail: (email: string, password: string) => createUserWithEmailAndPassword(auth!, email, password),
    logout: () => signOut(auth!),
    // Быстрый вход по недавним аккаунтам — фича своих аккаунтов; у Firebase своя сессия.
    recentAccounts: [] as import("./recentAccounts").RecentAccount[],
    forgetAccount: (_id: string) => {},
    // Google/Apple/magic-link — добавляются сюда следующим шагом,
    // структура для них уже готова (просто новые функции по этому же образцу)
  };
}

export function useAuth() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return isFirebaseConfigured ? useFirebaseAuth() : useAccountAuth();
}

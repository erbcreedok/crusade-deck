import { useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import { joinByInviteCode } from "./colyseus";
import {
  clearActiveRoom,
  loadActiveRoom,
  parseRoomCode,
  pushLobbyUrl,
  pushRoomUrl,
  saveActiveRoom,
} from "./roomRoute";

// Соединение с комнатой и адресная строка как одно целое: куда мы хотим попасть
// (targetCode), живое соединение (room) и синхронизация того и другого с URL.

export interface RoomConnection {
  room: Room | null;
  /** Комната, куда мы хотим попасть: из URL (/room/<код>) или из персиста сессии. */
  targetCode: string | null;
  /** Вошли в комнату (через лобби): запомнить её как активную. */
  onJoined: (room: Room) => void;
  /** Выход в лобби: закрыть соединение и забыть активную комнату. */
  leaveToLobby: () => void;
  /** Забыть активную комнату, не закрывая её (отмена возврата). */
  forget: () => void;
}

export function useRoomConnection(accountId?: string, accountName?: string): RoomConnection {
  const [room, setRoom] = useState<Room | null>(null);
  const [targetCode, setTargetCode] = useState<string | null>(() => parseRoomCode() ?? loadActiveRoom());

  // Вошли в комнату: запоминаем её код (URL + персист) для бесшовного возврата. Код
  // приходит из состояния комнаты (inviteCode) — если его ещё нет, ждём первый стейт.
  function onJoined(r: Room): void {
    setRoom(r);
    const apply = () => {
      const code = (r.state as { inviteCode?: string })?.inviteCode;
      if (!code) return;
      saveActiveRoom(code);
      pushRoomUrl(code);
      setTargetCode(code);
    };
    apply();
    r.onStateChange(apply); // идемпотентно: как только придёт inviteCode — проставим
  }

  // Явный выход/отмена возврата. Серверная «последняя комната» для кнопки в лобби при
  // этом сохраняется — забываем только СВОЮ метку активной комнаты.
  function forget(): void {
    setRoom(null);
    setTargetCode(null);
    clearActiveRoom();
    pushLobbyUrl();
  }

  function leaveToLobby(): void {
    room?.leave();
    forget();
  }

  // Обрыв связи (свернул вкладку, сон iOS, сеть) — роняем room, но НЕ забываем targetCode:
  // эффект ниже переподключится бесшовно (сервер держит игрока на паузе).
  useEffect(() => {
    if (!room) return;
    const drop = () => setRoom(null);
    room.onLeave(drop);
    room.onError(drop);
  }, [room]);

  // Бесшовное подключение к targetCode (первый вход по URL, персист, реконнект после
  // обрыва). ВАЖНО: ровно ОДНО соединение на один targetCode. Раньше здесь стоял флаг
  // cancelled, и двойной прогон эффекта (StrictMode в деве, быстрый ре-рендер) открывал
  // ДВА сокета одним аккаунтом. Сервер держит одного игрока на аккаунт, поэтому вход,
  // доехавший вторым, забирал запись себе — и выжившее соединение оставалось без игрока
  // («я не дилер»). Порядок прибытия недетерминирован, отсюда «то так, то эдак».
  const joiningRef = useRef<string | null>(null);
  const wantedRef = useRef<string | null>(targetCode);
  wantedRef.current = targetCode;
  useEffect(() => {
    if (!accountId || !accountName || room || !targetCode) return;
    if (joiningRef.current === targetCode) return; // уже подключаемся к этой комнате
    joiningRef.current = targetCode;
    joinByInviteCode(targetCode, { accountId, name: accountName })
      .then((r) => {
        joiningRef.current = null;
        // Пока подключались, цель могла смениться (вышли/ушли в другую комнату).
        if (wantedRef.current !== targetCode) return void r.leave();
        onJoined(r);
      })
      .catch(() => {
        joiningRef.current = null;
        if (wantedRef.current !== targetCode) return;
        // Комнаты уже нет (или код неверный) — уходим на начальный экран.
        clearActiveRoom();
        pushLobbyUrl();
        setTargetCode(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, accountName, targetCode, room]);

  // Кнопки назад/вперёд браузера: синхронизируем targetCode с адресом.
  useEffect(() => {
    const onPop = () => {
      const code = parseRoomCode();
      if (code) {
        setTargetCode(code);
        return;
      }
      setTargetCode(null);
      clearActiveRoom();
      if (room) {
        room.leave();
        setRoom(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [room]);

  return { room, targetCode, onJoined, leaveToLobby, forget };
}

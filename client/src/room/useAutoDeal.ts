import { useEffect, useRef } from "react";
import type { Room } from "colyseus.js";
import { autoDealPlan, dealOrder, AUTO_DEAL_INTERVAL_MS } from "../game/dealing";
import { topCard } from "../game/topCard";
import type { RoomPlayer } from "./readState";

// Автораздача: с соседа слева по часовой, по две карты каждому, 2 карты/сек, пока колода
// не пуста или пока не нажали STOP. Берём верхнюю карту и ЖДЁМ эхо колоды, иначе
// следующий тик возьмёт ту же карту второй раз.

export interface AutoDealOptions {
  room: Room;
  /** Идёт ли автораздача. */
  active: boolean;
  /** Остановить (кончились карты/цели, или права пропали). */
  stop: () => void;
  amIDealer: boolean;
  dealMode: boolean;
  deck: string[];
  players: RoomPlayer[];
  /** Круг мест (серверный seatOrder). */
  tableOrder: string[];
  nextRev: () => number;
}

export function useAutoDeal(o: AutoDealOptions): void {
  const { room, active, amIDealer, dealMode } = o;
  // Живой снимок стола для таймера. Через ref, а не через зависимости эффекта: колода и
  // игроки меняются на КАЖДЫЙ патч состояния (каждая розданная карта — это патч), и эффект
  // пересоздавал бы интервал по нескольку раз в секунду. Тогда отсчёт всё время начинался
  // заново, и темп раздачи плавал бы вместе с сетью вместо заявленных 2 карт/с.
  const snapRef = useRef(o);
  snapRef.current = o;

  const planRef = useRef<{ plan: string[]; i: number } | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      planRef.current = null;
      pendingRef.current = null;
      return;
    }
    if (!amIDealer || !dealMode) {
      snapRef.current.stop();
      return;
    }

    // Кому раздаём: круг seatOrder, только готовые (+ дилер: он готов всегда).
    const targets = (): string[] => {
      const { players, tableOrder } = snapRef.current;
      const ids = tableOrder.filter((id) => {
        const p = players.find((x) => x.id === id);
        return !!p?.connected && (p.isReady || p.isDealer || id === room.sessionId);
      });
      return dealOrder(ids, room.sessionId);
    };
    const accepts = (id: string): boolean => {
      if (id === room.sessionId) return true;
      const p = snapRef.current.players.find((x) => x.id === id);
      return !!p?.isReady || !!p?.isDealer;
    };

    const timer = setInterval(() => {
      const st = planRef.current ?? { plan: [] as string[], i: 0 };
      planRef.current = st;
      const live = snapRef.current.deck;
      const stop = snapRef.current.stop;

      // Ждём, пока предыдущая карта исчезнет из колоды (эхо сервера).
      if (pendingRef.current) {
        if (live.includes(pendingRef.current)) return;
        pendingRef.current = null;
      }
      if (live.length === 0) return stop();

      // План кончился, а карты ещё есть — достраиваем ещё круг.
      if (st.i >= st.plan.length) {
        const extra = autoDealPlan(targets(), live.length);
        if (extra.length === 0) return stop();
        st.plan.push(...extra);
      }
      // Снял «Готов» посреди автораздачи — пропускаем его.
      while (st.i < st.plan.length && !accepts(st.plan[st.i]!)) st.i += 1;
      if (st.i >= st.plan.length) return stop();

      const card = topCard(live);
      if (!card) return stop();

      room.send("deal_card", { card, to: st.plan[st.i]!, rev: snapRef.current.nextRev() });
      pendingRef.current = card;
      st.i += 1;
    }, AUTO_DEAL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, amIDealer, dealMode, room]);
}

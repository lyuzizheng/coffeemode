"use client";

import { useCallback, useMemo, useState } from "react";
import type { CheckInScores } from "@/types/checkins";

export interface CheckinScoresState {
  wifi: number | null;
  setWifi: (val: number | null) => void;
  outlets: number | null;
  setOutlets: (val: number | null) => void;
  seats: number | null;
  setSeats: (val: number | null) => void;
  temp: number | null;
  setTemp: (val: number | null) => void;
  coffee: number | null;
  setCoffee: (val: number | null) => void;
  overall: number | null;
  setOverall: (val: number | null) => void;
  applyScores: (scores: CheckInScores) => void;
  scores: CheckInScores;
}

export function useCheckinScoresState(initialScores?: CheckInScores): CheckinScoresState {
  const [wifi, setWifi] = useState<number | null>(initialScores?.wifi ?? null);
  const [outlets, setOutlets] = useState<number | null>(initialScores?.outlets ?? null);
  const [seats, setSeats] = useState<number | null>(initialScores?.seats ?? null);
  const [temp, setTemp] = useState<number | null>(initialScores?.temp ?? null);
  const [coffee, setCoffee] = useState<number | null>(initialScores?.coffee ?? null);
  const [overall, setOverall] = useState<number | null>(initialScores?.overall ?? null);

  const applyScores = useCallback((scores: CheckInScores) => {
    setWifi(scores.wifi ?? null);
    setOutlets(scores.outlets ?? null);
    setSeats(scores.seats ?? null);
    setTemp(scores.temp ?? null);
    setCoffee(scores.coffee ?? null);
    setOverall(scores.overall ?? null);
  }, []);

  const scores = useMemo(() => {
    const res: CheckInScores = {};
    if (wifi !== null) res.wifi = wifi;
    if (outlets !== null) res.outlets = outlets;
    if (seats !== null) res.seats = seats;
    if (temp !== null) res.temp = temp;
    if (coffee !== null) res.coffee = coffee;
    if (overall !== null) res.overall = overall;
    return res;
  }, [wifi, outlets, seats, temp, coffee, overall]);

  return {
    wifi,
    setWifi,
    outlets,
    setOutlets,
    seats,
    setSeats,
    temp,
    setTemp,
    coffee,
    setCoffee,
    overall,
    setOverall,
    applyScores,
    scores,
  };
}

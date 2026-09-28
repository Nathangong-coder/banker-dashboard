"use client";

import { useId, useMemo } from "react";
import { useStore } from "@/lib/store";
import { locationTeamOptions } from "@/lib/locationTeam";
import { Field, Input } from "./ui";

export function useLocationTeamOptions() {
  const contacts = useStore((s) => s.contacts);
  return useMemo(() => locationTeamOptions(contacts), [contacts]);
}

/** Location + Team as "semi-dropdowns": pick a suggestion or type a new value (it joins the list once used). */
export function LocationTeamFields({
  location,
  team,
  onLocation,
  onTeam,
}: {
  location: string;
  team: string;
  onLocation: (v: string) => void;
  onTeam: (v: string) => void;
}) {
  const id = useId();
  const { locations, teams } = useLocationTeamOptions();
  return (
    <>
      <Field label="Location">
        <Input list={`${id}-loc`} value={location} onChange={(e) => onLocation(e.target.value)} placeholder="SF, NY, LA…" />
        <datalist id={`${id}-loc`}>
          {locations.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </Field>
      <Field label="Team">
        <Input list={`${id}-team`} value={team} onChange={(e) => onTeam(e.target.value)} placeholder="Tech, Healthcare, RX…" />
        <datalist id={`${id}-team`}>
          {teams.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </Field>
    </>
  );
}

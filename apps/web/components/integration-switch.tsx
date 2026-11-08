"use client";
import { useOptimistic, useTransition, useState } from "react";
import type { IntegrationKey, IntegrationStatus } from "@tether/core";
import { toggleIntegration } from "@/app/w/[id]/actions";

const statusText: Record<IntegrationStatus, string> = { connected: "Connected", off: "Disconnected", needs_setup: "On, needs setup" };
const statusColor: Record<IntegrationStatus, string> = { connected: "var(--ok)", off: "var(--muted)", needs_setup: "var(--wait)" };

export function IntegrationSwitch({ orgId, kind, label, status, canEdit }: {
  orgId: string; kind: IntegrationKey; label: string; status: IntegrationStatus; canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [shown, setShown] = useOptimistic(status, (_: IntegrationStatus, on: boolean) => (on ? "connected" : "off") as IntegrationStatus);
  const on = shown !== "off";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="status" style={{ color: statusColor[shown] }}>{statusText[shown]}</span>
      <button
        type="button" role="switch" aria-checked={on} aria-label={`${label} ${on ? "connected" : "disconnected"}`}
        className="switch" disabled={!canEdit || pending}
        title={canEdit ? undefined : "Only organizers can change integrations"}
        onClick={() => start(async () => {
          setError(undefined);
          setShown(!on);
          const r = await toggleIntegration(orgId, kind, !on);
          if (r?.error) setError(r.error);
        })}
      />
      {error && <span className="sr-only" role="alert">{error}</span>}
    </div>
  );
}

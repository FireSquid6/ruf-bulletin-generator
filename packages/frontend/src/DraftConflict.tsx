import React, { useState } from "react";
import "./draft-conflict.css";

export type DraftSnapshot = {
  id: string;
  gatheringDate: string;
  revision: number;
  composition: { cover: Array<{ type: string; role?: string }>; flow: Array<{ type: string; role?: string }> };
};

type LocalDraft = Pick<DraftSnapshot, "gatheringDate" | "composition">;

function Version({ title, date, composition }: { title: string; date: string; composition: LocalDraft["composition"] }) {
  return <section className="conflict-version" aria-label={title}>
    <h3>{title}</h3>
    <p><strong>Gathering date</strong> {date}</p>
    {(["cover", "flow"] as const).map((area) => <div key={area}>
      <h4>{area === "cover" ? "Cover" : "Reading order"}</h4>
      {composition[area].length === 0 ? <p>No blocks</p> : <ol>{composition[area].map((block, index) => <li key={index}>
        <strong>{block.type === "scripture" ? block.role === "sermon" ? "Sermon passage" : "Scripture reading" : block.type}</strong>
        <pre>{JSON.stringify(block, null, 2)}</pre>
      </li>)}</ol>}
    </div>)}
  </section>;
}

export function DraftConflict({ latest, local, saving, error, onUseLatest, onOverwrite }: {
  latest: DraftSnapshot;
  local: LocalDraft;
  saving: boolean;
  error?: string;
  onUseLatest: () => void;
  onOverwrite: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  return <section className="draft-conflict" aria-labelledby="conflict-title">
    <h2 id="conflict-title">A newer draft was saved</h2>
    <p role="alert">Your edits are still here and have not been saved. The newer version is revision {latest.revision} for {latest.gatheringDate}; your edited gathering date is {local.gatheringDate || "not set"}. Review both before choosing what to keep.</p>
    <button type="button" aria-expanded={reviewing} onClick={() => setReviewing(!reviewing)}>{reviewing ? "Hide comparison" : "Review both versions"}</button>
    {reviewing && <div className="conflict-versions"><Version title="Your unsaved edits" date={local.gatheringDate} composition={local.composition} /><Version title={`Newer saved draft · Revision ${latest.revision}`} date={latest.gatheringDate} composition={latest.composition} /></div>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="conflict-actions">
      <button type="button" disabled={saving} onClick={onUseLatest}>Use newer saved draft</button>
      <button type="button" disabled={saving} onClick={onOverwrite}>{saving ? "Saving…" : "Overwrite newer draft with my edits"}</button>
    </div>
    <p className="conflict-note">Neither choice merges changes. You can continue editing before deciding; overwriting checks the revision again.</p>
  </section>;
}

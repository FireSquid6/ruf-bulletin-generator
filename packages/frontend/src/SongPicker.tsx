import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "./api";

export function SongPicker({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const selected = useQuery({ queryKey: ["song", value], enabled: !!value, retry: false, queryFn: async () => {
    const response = await api.api.songs({ key: value! }).get();
    if (response.status === 404) return null;
    if (response.error || !response.data || !("song" in response.data)) throw new Error("Could not check this song key. Try again.");
    return response.data.song;
  } });
  const songs = useQuery({ queryKey: ["songs", search], retry: false, queryFn: async () => {
    const response = await api.api.songs.get({ query: { search } });
    if (response.error || !response.data || !("songs" in response.data)) throw new Error("Could not search songs. Try again.");
    return response.data.songs;
  } });
  const missing = !!value && selected.isSuccess && selected.data === null;
  const choices = songs.data ?? [];
  const selectedInResults = choices.some((song) => song.key === value);
  return <div className="song-picker">
    {value && <div className={missing ? "song-selection missing" : "song-selection"}>
      {selected.isPending ? <p>Checking song key “{value}”…</p> : selected.isError ? <p role="alert" className="error">{selected.error.message} <button type="button" onClick={() => selected.refetch()}>Try again</button></p> : missing ? <>
        <p role="status">Missing song key <strong>“{value}”</strong>. This draft can still be saved; choose another song or add one under this key.</p>
        <Link to={`/songs?new=1&key=${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer">Add song under this key (new tab)</Link>
      </> : <p>Selected: <strong>{selected.data?.title}</strong> · {value} <Link to={`/songs?key=${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer">Edit in song store (new tab)</Link></p>}
    </div>}
    <label>Find a song<input aria-label="Find a song" type="search" value={search} placeholder="Search by key or title" onChange={(event) => setSearch(event.target.value)} /></label>
    {songs.isPending ? <p>Searching songs…</p> : songs.isError ? <p role="alert" className="error">{songs.error.message} <button type="button" onClick={() => songs.refetch()}>Try again</button></p> : <>
      <label>Select song<select aria-label="Select song" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a song…</option>
        {value && !selectedInResults && <option value={value}>{selected.data?.title ? `${selected.data.title} · ${value}` : `Current key · ${value}`}</option>}
        {choices.map((song) => <option key={song.key} value={song.key}>{song.title} · {song.key}</option>)}
      </select></label>
      {choices.length === 0 && <p className="song-search-empty">{search ? "No songs match. Try a title or key, or enter a key below." : "No songs in the store yet. Enter a key or add a song."}</p>}
    </>}
    <label>Song key<input aria-label="Song key" value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Enter a key or select a song" /></label>
  </div>;
}

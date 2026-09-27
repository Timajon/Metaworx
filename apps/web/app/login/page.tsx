"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Login failed");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="shell">
      <form className="panel" style={{ maxWidth: 420, margin: "12vh auto" }} onSubmit={submit}>
        <h1>SignalForge</h1>
        <p className="muted">Enter the server access token. It stays in an httpOnly cookie and is not stored as a Luno or xAI key.</p>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Access token" />
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit">Continue</button>
      </form>
    </main>
  );
}

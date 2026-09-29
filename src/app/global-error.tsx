"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0, background: "#f5f6f8", color: "#12161f" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#4f5968", fontSize: 14 }}>The application hit an unexpected error. Please try again.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 6, border: 0, background: "#2557e8", color: "white", fontSize: 14, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main>
      <header>RUF Bulletin Studio</header>
      <section>
        <h1>Bulletin workspace</h1>
        <p>The bulletin editor is being built. The YAML generator remains available from the command line.</p>
      </section>
    </main>
  </React.StrictMode>,
);

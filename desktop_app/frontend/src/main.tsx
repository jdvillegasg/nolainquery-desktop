import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./tailwind.css";
import "./views/query/QuerySidebar.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

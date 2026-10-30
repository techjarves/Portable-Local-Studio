import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
// Shared styles load before App's components so each screen's own stylesheet
// (src/styles/*.css) comes later in the cascade and can refine the shared classes
import "./App.css";
import App from "./App";
import WorkIntegration from "./components/WorkIntegration";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <WorkIntegration />
  </React.StrictMode>,
);

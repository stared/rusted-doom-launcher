import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";

// Initialize MCP plugin listeners for AI debugging (dev builds only, optional dependency)
if (import.meta.env.DEV) {
  // @ts-ignore - tauri-plugin-mcp is optional, may not exist in CI
  import("tauri-plugin-mcp")
    .then(({ setupPluginListeners }: { setupPluginListeners: () => Promise<void> }) => {
      setupPluginListeners().then(() => {
        console.log("MCP plugin listeners initialized for AI debugging");
      });
    })
    .catch(() => {
      // MCP plugin not available (e.g., CI build) - this is fine
    });
}

createApp(App).mount("#app");
